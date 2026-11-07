import { type Options, query as sdkQuery, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { JsonSchema, Llm, LlmInput } from "../types.ts";
import { assertIsolated, assertLogin, checkLogin, loginOptions } from "./claude-login.ts";

export type Query = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;

// The SDK delivers the answer through this tool, which it adds itself.
const STRUCTURED_TOOL = "StructuredOutput";

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

export function createLlm(query: Query = sdkQuery as Query, login: () => Promise<void> = checkLogin): Llm {
  return {
    async structured<T>(input: LlmInput, jsonSchema: JsonSchema): Promise<T> {
      const validate = compile(jsonSchema);
      const abortController = new AbortController();
      let output: unknown;
      // A boolean, because an error can arrive with an empty message.
      let failed = false;
      let reason = "";
      let sawInit = false;
      try {
        await login();
        const messages = query({
          prompt: input.images?.length ? withImages(input) : input.prompt,
          options: {
            ...loginOptions(),
            abortController,
            tools: [],
            outputFormat: { type: "json_schema", schema: jsonSchema },
            ...(input.system ? { systemPrompt: input.system } : {}),
          },
        });
        for await (const message of messages) {
          if (message.type === "system" && message.subtype === "init") {
            assertLogin(message);
            assertIsolated(message, { tools: [STRUCTURED_TOOL], agents: [] });
            sawInit = true;
          } else if (message.type === "rate_limit_event" && message.rate_limit_info.status === "rejected") {
            failed = true;
            reason = "Claude plan rate limit reached";
          } else if ((message.type === "assistant" || message.type === "auth_status") && message.error) {
            failed = true;
            reason ||= message.error;
          } else if (message.type === "result") {
            if (message.subtype !== "success") {
              failed = true;
              reason ||= message.errors.join("; ") || message.subtype;
            } else if (message.is_error) {
              failed = true;
              reason ||= message.result;
            } else output = message.structured_output;
          }
        }
        // Without init, the login and isolation checks above never ran.
        if (!sawInit) throw new Error("Refusing to run: the run reported no init, so the login was not checked");
      } catch (error) {
        failed = true;
        reason ||= error instanceof Error ? error.message : String(error);
      } finally {
        abortController.abort();
      }
      if (failed) throw new Error(`Llm.structured failed: ${reason || "the run reported an error with no message"}`);
      if (output === undefined) throw new Error("Llm.structured failed: the result had no structured output");
      if (!validate(output)) throw new Error(`Llm.structured failed: output does not match the schema: ${JSON.stringify(validate.errors)}`);
      return output as T;
    },
  };
}

export default createLlm();
