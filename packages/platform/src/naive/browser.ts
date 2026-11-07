// The local Playwright browser, on purpose: naïve's browser refuses private hosts (our replica portal) and needs
// computers:write, which our key does not have. Logins still come from the vault by name. See docs/plan/naive-notes.md, Blocker 3.
export { default } from "../local/browser.ts";
