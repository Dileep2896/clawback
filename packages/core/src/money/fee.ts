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

export const customerKeepsCents = ({ refundCents, annualSavingsCents, feeCents: fee }: { refundCents: number; annualSavingsCents: number; feeCents: number }) =>
  refundCents + annualSavingsCents - fee;
