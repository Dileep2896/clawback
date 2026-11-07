// Which statuses make a finding count, by type. A type not named here never counts, so a new rule fails closed.
const COUNTED = new Map<string, string[]>([
  ["meterMultiplierJump", ["filed", "won"]],
  ["rateOptimization", ["filed", "won"]],
  // Only a rep can confirm these, so a filed letter or an approval is not enough.
  ["unusedLines", ["won"]],
  ["promoExpiry", ["won"]],
]);

export const countsInLedger = ({ type, status }: { type: string; status: string }) => COUNTED.get(type)?.includes(status) ?? false;

export function feeCents({ refundCents, annualSavingsCents, sharePct }: { refundCents: number; annualSavingsCents: number; sharePct: number }) {
  if (!Number.isInteger(sharePct) || sharePct < 0 || sharePct > 100) throw new Error(`Invalid savings share ${sharePct}: expected a whole percent from 0 to 100`);
  return Math.round(((refundCents + annualSavingsCents) * sharePct) / 100);
}

/** Due now is the share of won amounts, and the rest is what remains of the recorded fee, so the parts always add up to it to the cent. */
export function splitFee({ totalFeeCents, wonCents, sharePct }: { totalFeeCents: number; wonCents: number; sharePct: number }) {
  const dueNowCents = feeCents({ refundCents: wonCents, annualSavingsCents: 0, sharePct });
  if (dueNowCents > totalFeeCents) throw new Error(`Fee of ${totalFeeCents} cents is less than the ${dueNowCents} cents due on won findings, so the fee row is out of date`);
  return { dueNowCents, dueWhenGrantedCents: totalFeeCents - dueNowCents };
}

export const customerKeepsCents =({ refundCents, annualSavingsCents, feeCents: fee }: { refundCents: number; annualSavingsCents: number; feeCents: number }) =>
  refundCents + annualSavingsCents - fee;
