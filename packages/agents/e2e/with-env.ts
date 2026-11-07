export async function withEnv<T>(name: string, value: string, run: () => Promise<T>): Promise<T> {
  const original = process.env[name];
  process.env[name] = value;
  try {
    return await run();
  } finally {
    // Assigning undefined to process.env stores the string "undefined".
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}
