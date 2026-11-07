import { type Options, query as sdkQuery, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { JsonSchema, Llm, LlmInput } from "../types.ts";
import { assertIsolated, assertLogin, loginOptions } from "./claude-login.ts";

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

export function createLlm(query: Query = sdkQuery as Query): Llm {
  return {
    async structured<T>(input: LlmInput, jsonSchema: JsonSchema): Promise<T> {
      const schema = z.fromJSONSchema(jsonSchema);
      const abortController = new AbortController();
      let output: unknown;
      let failure: string | undefined;
      try {
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
          } else if (message.type === "rate_limit_event" && message.rate_limit_info.status === "rejected") {
            failure = "Claude plan rate limit reached";
          } else if (message.type === "result") {
            if (message.subtype !== "success") failure ??= message.errors.join("; ") || message.subtype;
            else if (message.is_error) failure ??= message.result;
            else output = message.structured_output;
          }
        }
      } catch (error) {
        failure ??= error instanceof Error ? error.message : String(error);
      } finally {
        abortController.abort();
      }
      if (failure) throw new Error(`Llm.structured failed: ${failure}`);
      if (output === undefined) throw new Error("Llm.structured failed: the result had no structured output");
      const parsed = schema.safeParse(output);
      if (!parsed.success) throw new Error(`Llm.structured failed: output does not match the schema: ${parsed.error.message}`);
      return output as T;
    },
  };
}

export default createLlm();
