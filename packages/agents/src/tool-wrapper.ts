import type { Audit, RunEvent, ToolContext, ToolDef } from "@bill-fighter/platform/types";
import {
  type Allowlist,
  isAllowedCallNumber,
  isAllowedEmail,
  isAllowedPortalUrl,
} from "@bill-fighter/shared/allowlist";

export type Target = { kind: "email" | "phone" | "portal"; value: string };

/** targets is required, so a tool author must say who it contacts. A tool that contacts nobody returns []. */
export type AgentTool<I = unknown> = ToolDef<I> & { targets(input: I): Target[] | Promise<Target[]> };

export const defineTool = <I>(tool: AgentTool<I>) => tool as unknown as AgentTool;

const IS_ALLOWED = { email: isAllowedEmail, phone: isAllowedCallNumber, portal: isAllowedPortalUrl };

const textOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function refusalOf(tool: AgentTool, input: unknown, allowlist: Allowlist): Promise<string | null> {
  try {
    const off = (await tool.targets(input)).find(({ kind, value }) => !IS_ALLOWED[kind](allowlist, value));
    return off ? `${tool.name} refused: ${off.kind} target ${off.value} is not on the allowlist` : null;
  } catch (error) {
    return `${tool.name} refused: could not read its targets: ${textOf(error)}`;
  }
}

/**
 * Checks targets and writes audit_log around a tool. No approval logic: the runtime's gate has already passed by the
 * time it calls this handler.
 */
export function wrapTool(tool: AgentTool, { audit, allowlist }: { audit: Audit; allowlist: Allowlist }): ToolDef {
  const { name, description, inputSchema } = tool;
  return {
    name,
    description,
    inputSchema,
    async handler(input, ctx: ToolContext) {
      // Returns text rather than throwing, so a failed audit write never hides what happened to the tool.
      const record = async (output: unknown) => {
        try {
          await audit.record({ runId: ctx.runId, agent: ctx.agent, tool: name, input, output });
          return "";
        } catch (error) {
          return ` Its audit row could not be written: ${textOf(error)}`;
        }
      };

      const refused = await refusalOf(tool, input, allowlist);
      if (refused) throw new Error(refused + (await record({ refused })));

      let output: unknown;
      try {
        output = await tool.handler(input, ctx);
      } catch (error) {
        const message = textOf(error);
        throw new Error(message + (await record({ error: message })), { cause: error });
      }
      const failed = await record(output);
      if (failed) throw new Error(`${name} ran, so do not retry it.${failed}`);
      return output;
    },
  };
}

/** The runtime refuses these calls before any handler, so the wrapper never sees them. Run-trigger wraps runtime.run(). */
export async function* auditDenied(
  events: AsyncIterable<RunEvent>,
  runId: string,
  audit: Audit,
): AsyncGenerator<RunEvent> {
  for await (const event of events) {
    if (event.type === "denied") {
      await audit.record({ runId, agent: event.agent, tool: event.tool, output: { denied: event.reason } });
    }
    yield event;
  }
}
