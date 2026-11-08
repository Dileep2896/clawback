// Packs the dashboard into one plain npm project for the judge sandbox's hosted App (naïve Apps build it on Vercel with
// `npm run build`, and know nothing of pnpm workspaces). The workspace packages it imports ride along as file: dependencies.
// Usage: pnpm exec tsx scripts/sandbox-bundle.ts <out-dir>. Writes <out-dir>/files (the tree) and <out-dir>/deploy.json.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGES = ["core", "db", "shared"];
// Only for the seed's PDF rendering and the parser's tests, which the dashboard never loads.
const DROP_DEPENDENCIES = ["playwright", "@fontsource/ibm-plex-sans"];
// Tests, checks, build output and env files (local credentials) never ship.
const SKIP = /(^|\/)(node_modules|\.next|e2e)(\/|$)|(^|\/)\.env[^/]*$|\.(test|check)\.ts$|(^|\/)next-env\.d\.ts$|tsconfig\.tsbuildinfo$/;

type Manifest = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>; [key: string]: unknown };
const readJson = (path: string) => JSON.parse(readFileSync(join(ROOT, path), "utf8")) as Manifest;
const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const installed = (name: string, from: string) => (JSON.parse(readFileSync(join(ROOT, from, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;

/** workspace:* becomes a file: path inside the bundle, everything else is pinned to the version this repo has installed. */
function rewrite(deps: Record<string, string> = {}, from: string, prefix: string) {
  return Object.fromEntries(
    Object.keys(deps)
      .filter((name) => !DROP_DEPENDENCIES.includes(name))
      .map((name) => [name, name.startsWith("@bill-fighter/") ? `file:${prefix}${name.split("/")[1]}` : installed(name, from)]),
  );
}

function copyTree(from: string, to: string) {
  cpSync(join(ROOT, from), to, { recursive: true, filter: (source) => !SKIP.test(relative(join(ROOT, from), source)) });
}

function files(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, base) : [relative(base, path)];
  });
}

export function bundle(out: string) {
  const tree = join(out, "files");
  rmSync(tree, { recursive: true, force: true });
  copyTree("apps/dashboard", tree);
  rmSync(join(tree, "AGENTS.md"), { force: true });
  for (const name of PACKAGES) {
    copyTree(`packages/${name}/src`, join(tree, "packages", name, "src"));
    const manifest = readJson(`packages/${name}/package.json`);
    writeJson(join(tree, "packages", name, "package.json"), {
      name: `@bill-fighter/${name}`,
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { "./*": "./src/*.ts" },
      dependencies: rewrite(manifest.dependencies, `packages/${name}`, "../"),
    });
  }
  mkdirSync(join(tree, "data", "replay"), { recursive: true });
  cpSync(join(ROOT, "data/replay/run.jsonl"), join(tree, "data/replay/run.jsonl"));
  cpSync(join(ROOT, "data/replay/usage.json"), join(tree, "data/replay/usage.json"));
  cpSync(join(ROOT, "tsconfig.base.json"), join(tree, "tsconfig.base.json"));

  const app = readJson("apps/dashboard/package.json");
  writeJson(join(tree, "package.json"), {
    ...app,
    scripts: { build: "next build", start: "next start" },
    engines: { node: ">=22.12" },
    dependencies: {
      ...rewrite(app.dependencies, "apps/dashboard", "./packages/"),
      // next build compiles and type-checks TypeScript, so its tools are build dependencies here.
      ...rewrite(app.devDependencies, "apps/dashboard", "./packages/"),
      typescript: installed("typescript", "."),
      "@types/node": installed("@types/node", "."),
      "@types/pg": installed("@types/pg", "packages/db"),
    },
    devDependencies: undefined,
  });
  // Type-check the app and what it imports, not every package file (some load tools the app never ships).
  const tsconfig = JSON.parse(readFileSync(join(tree, "tsconfig.json"), "utf8")) as Record<string, unknown>;
  writeJson(join(tree, "tsconfig.json"), {
    ...tsconfig,
    extends: "./tsconfig.base.json",
    include: ["next-env.d.ts", "app/**/*.ts", "app/**/*.tsx", "components/**/*.tsx", "components/**/*.ts", "lib/**/*.ts", "lib/**/*.tsx", "proxy.ts", "next.config.ts", ".next/types/**/*.ts"],
  });

  const map = Object.fromEntries(files(tree).sort().map((path) => [path, readFileSync(join(tree, path)).toString("base64")]));
  const contentHash = createHash("sha256").update(JSON.stringify(map)).digest("hex");
  writeJson(join(out, "deploy.json"), { files: map, content_hash: contentHash });
  return { count: Object.keys(map).length, bytes: statSync(join(out, "deploy.json")).size, contentHash };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) throw new Error("Usage: pnpm exec tsx scripts/sandbox-bundle.ts <out-dir>");
  if (!existsSync(dirname(out))) throw new Error(`No such directory: ${dirname(out)}`);
  console.info(bundle(out));
}
