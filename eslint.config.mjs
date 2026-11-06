import tseslint from "typescript-eslint";

const PLAYWRIGHT = ["playwright", "playwright-core", "@playwright/[^/]+"];
const OTHER_PLATFORM_SDKS = [
  "@anthropic-ai/claude-agent-sdk",
  "nodemailer",
  "node-cron",
  // shortcut: guessed naive package names, correct them in naive-recon (phase 12).
  "naive",
  "@naive/[^/]+",
  "@usenaive/[^/]+",
];

// One rule covers every import form. no-restricted-imports misses import() and require().
// shortcut: computed specifiers such as import(name) cannot be caught statically.
function boundary(packages) {
  // esquery regex literals cannot contain a slash, hence \x2F.
  const names = packages.join("|").replaceAll("/", "\\x2F");
  const re = `/^(${names})(\\x2F|$)/`;
  const message = "Platform SDKs may only be imported inside packages/platform (project.md section 5).";
  return [
    "error",
    ...[
      `ImportDeclaration[source.value=${re}]`,
      `ExportNamedDeclaration[source.value=${re}]`,
      `ExportAllDeclaration[source.value=${re}]`,
      `ImportExpression[source.value=${re}]`,
      `CallExpression[callee.name='require'][arguments.0.value=${re}]`,
      `TSImportEqualsDeclaration[moduleReference.expression.value=${re}]`,
    ].map((selector) => ({ selector, message })),
  ];
}

export default [
  { ignores: ["**/node_modules/", "**/.next/", "**/dist/", "**/coverage/", "**/next-env.d.ts", "data/"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}"],
    rules: { "no-restricted-syntax": boundary([...PLAYWRIGHT, ...OTHER_PLATFORM_SDKS]) },
  },
  {
    // Build and test tools only; runtime browser use still goes through Browser (schedule.md decision 10).
    files: ["scripts/**", "packages/db/src/seed/**", "apps/portal/e2e/**"],
    rules: { "no-restricted-syntax": boundary(OTHER_PLATFORM_SDKS) },
  },
  {
    files: ["packages/platform/**"],
    rules: { "no-restricted-syntax": "off" },
  },
];
