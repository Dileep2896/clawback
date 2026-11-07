const FAKE = {
  ANTHROPIC_API_KEY: "sk-ant-api03-not-a-real-key",
  ANTHROPIC_AUTH_TOKEN: "not-a-real-token",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  CLAUDE_CODE_USE_BEDROCK: "1",
  // The checks only prove behaviour, so they run on the cheapest model.
  CLAUDE_MODEL: "haiku",
};

/** For checks: if anything here reached Claude the run would fail, so a success can only have used the login. */
export async function withFakeCredentials(run: () => Promise<void>): Promise<void> {
  const saved = Object.keys(FAKE).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, FAKE);
  try {
    await run();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
