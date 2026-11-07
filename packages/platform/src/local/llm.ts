import { type Options, query as sdkQuery, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { LlmOutputError } from "@bill-fighter/shared/llm-output-error";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JsonSchema, Llm, LlmInput } from "../types.ts";
import { assertInit, checkLogin, loginOptions, runOutcome } from "./claude-login.ts";

export type Query = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;

// The SDK delivers the answer through this tool, which it adds itself.
const ALLOWED_INIT = { tools: ["StructuredOutput"], agents: [] };

async function* withImages({ prompt, images = [] }: LlmInput): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    parent_tool_use_id: null,
    session_id: "",
    message: {
      role: "user",
      content: [
        ...images.map(({ mediaType, base64 }) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: mediaType as "image/png", data: base64 },
        })),
        { type: "text" as const, text: prompt },
      ],
    },
  };
}

// Validates against the schema itself: converting it to Zod silently drops constraints.
// strictSchema stays on, so a keyword Ajv cannot enforce throws instead of being ignored.
function compile(jsonSchema: JsonSchema) {
  const ajv = new Ajv2020({ strictTypes: false, strictTuples: false });
  addFormats(ajv);
  const validate = ajv.compile(jsonSchema);
  // An async validator returns a Promise, which reads as valid. A nested $async already throws in compile.
  if (validate.schemaEnv.$async) throw new Error("Llm.structured failed: a schema with $async cannot be validated");
  return validate;
}

const gaveUp = (message: SDKMessage) => message.type === "result" && message.subtype === "error_max_structured_output_retries";

// The SDK's own schema check gave up. Only if nothing else failed: a rate limit or login error in the same run must still throw.
const onlyGaveUp = (messages: SDKMessage[]) =>
  messages.some(gaveUp) &&
  runOutcome(
    messages.map((message) => (gaveUp(message) ? ({ ...message, subtype: "success", is_error: false, terminal_reason: "completed" } as unknown as SDKMessage) : message)),
    ALLOWED_INIT,
  ).finished;

export function createLlm(query: Query = sdkQuery as Query, login: () => Promise<void> = checkLogin): Llm {
  return {
    async structured<T>(input: LlmInput, jsonSchema: JsonSchema): Promise<T> {
      const validate = compile(jsonSchema);
      // The CLI rejects the 2020-12 $schema URL that z.toJSONSchema emits. Ajv above still validates to that draft.
      const sentSchema = { ...jsonSchema };
      delete sentSchema.$schema;
      const abortController = new AbortController();
      const messages: SDKMessage[] = [];
      const thrown: unknown[] = [];
      let output: unknown;
      let costUsd: number | undefined;
      let timedOut: Error | undefined;
      let timer: NodeJS.Timeout | undefined;
      // A race, not only the abort: a hung stream may never react to the abort.
      const limit = new Promise<never>((_, reject) => {
        if (input.timeoutMs === undefined) return;
        const seconds = input.timeoutMs / 1000;
        timer = setTimeout(() => reject((timedOut = new DOMException(`The model did not answer within ${seconds} s`, "TimeoutError"))), input.timeoutMs);
      });
      try {
        await Promise.race([login(), limit]);
        const stream = query({
          prompt: input.images?.length ? withImages(input) : input.prompt,
          options: {
            ...loginOptions(),
            abortController,
            tools: [],
            outputFormat: { type: "json_schema", schema: sentSchema },
            ...(input.system ? { systemPrompt: input.system } : {}),
          },
        })[Symbol.asyncIterator]();
        for (;;) {
          const next = await Promise.race([stream.next(), limit]);
          if (next.done) break;
          const message = next.value;
          messages.push(message);
          if (message.type === "system" && message.subtype === "init") assertInit(message, ALLOWED_INIT);
          if (message.type === "result") costUsd = message.total_cost_usd;
          if (message.type === "result" && message.subtype === "success") output = message.structured_output;
        }
      } catch (error) {
        thrown.push(error);
      } finally {
        clearTimeout(timer);
        abortController.abort();
      }
      if (costUsd !== undefined) input.onCost?.(costUsd);
      if (timedOut) throw timedOut;
      const { finished, reason } = runOutcome(messages, ALLOWED_INIT, thrown);
      // An SDK exception is operational even after a give-up result, whose text would otherwise take over `reason`.
      if (thrown.length > 0 && onlyGaveUp(messages)) throw thrown[0];
      if (!finished && onlyGaveUp(messages)) throw new LlmOutputError(`Llm.structured failed: ${reason}`);
      if (!finished) throw new Error(`Llm.structured failed: ${reason}`);
      if (output === undefined) throw new LlmOutputError("Llm.structured failed: the result had no structured output");
      if (!validate(output)) throw new LlmOutputError(`Llm.structured failed: output does not match the schema: ${JSON.stringify(validate.errors)}`);
      return output as T;
    },
  };
}

export default createLlm();
