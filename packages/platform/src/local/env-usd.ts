/** A dollar limit from the environment. Unset uses the fallback; anything else invalid throws, so a typo never means no limit. */
export function usdFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) throw new Error(`${name} must be a positive number of dollars, got "${raw}"`);
  return usd;
}
