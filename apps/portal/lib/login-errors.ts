// A Map, not an object: `error` comes from the URL, and `__proto__` on an object returns something React cannot render.
const ERRORS = new Map([
  ["wrong", "Username or password is incorrect. Check both and try again."],
  ["setup", "Sign-in is not set up yet. Run scripts/seed-portal-credentials.ts, then try again."],
]);

export const loginError = (error: unknown): string | undefined =>
  typeof error === "string" ? ERRORS.get(error) : undefined;
