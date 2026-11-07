// The local encrypted vault, on purpose: a naïve vault holds only MCP bearer and OAuth tokens and has no reveal route,
// so it cannot hold the portal logins fillSecret reads by name. See docs/plan/naive-notes.md, Blocker 3.
export { default } from "../local/vault.ts";
