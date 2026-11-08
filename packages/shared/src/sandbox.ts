// The public judge sandbox (SANDBOX=1): every visitor watches a recorded run, so nothing real may start. Each door calls
// assertNotSandbox in code, so a missed button in the UI still cannot reach a model, a phone, a mailbox or Stripe.

export const isSandbox = (env: NodeJS.ProcessEnv = process.env) => env.SANDBOX === "1";

export class SandboxRefused extends Error {}

export function assertNotSandbox(what: string, env: NodeJS.ProcessEnv = process.env) {
  if (isSandbox(env)) throw new SandboxRefused(`The sandbox does not ${what}: it only replays a recorded audit`);
}
