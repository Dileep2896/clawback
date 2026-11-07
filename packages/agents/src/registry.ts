import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AgentTool } from "./tool-wrapper.ts";

const TOOLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "tools");

const isToolFile = (file: string) => file.endsWith(".ts") && !/\.(test|check|d)\.ts$/.test(file);

/**
 * Every tool file default-exports a list of defineTool() results, so adding a file never edits a shared list.
 * shortcut: finds tools on disk, so it will not work inside a Next.js bundle, the same limit as platform's factory.
 * Upgrade to an explicit import map if a bundled app ever needs tools.
 */
export async function loadTools(dir: string = TOOLS_DIR): Promise<AgentTool[]> {
  const tools = new Map<string, AgentTool>();
  for (const file of (await readdir(dir)).filter(isToolFile).sort()) {
    const loaded: unknown = (await import(/* @vite-ignore */ pathToFileURL(join(dir, file)).href)).default;
    if (!Array.isArray(loaded)) throw new Error(`tools/${file}: must default-export a list of tools`);
    for (const tool of loaded as AgentTool[]) {
      if (typeof tool?.targets !== "function") throw new Error(`tools/${file}: ${tool?.name} has no targets function`);
      if (tools.has(tool.name)) throw new Error(`tools/${file}: tool ${tool.name} is already defined`);
      tools.set(tool.name, tool);
    }
  }
  return [...tools.values()];
}
