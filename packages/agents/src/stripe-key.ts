/** Called at a run's start and at each use, never at import: one throwing tool file would break the whole tool scan. */
export function stripeTestKey() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new Error("Stripe runs in test mode only: STRIPE_SECRET_KEY must begin with sk_test_");
  return key;
}
