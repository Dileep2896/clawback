export const findingTotals = (findings: { refundCents: number; annualSavingsCents: number }[]) => ({
  refundCents: findings.reduce((sum, f) => sum + f.refundCents, 0),
  annualSavingsCents: findings.reduce((sum, f) => sum + f.annualSavingsCents, 0),
});

export function totalsByKind<K extends string>(rows: { kind: K; amountCents: number }[]): Map<K, number> {
  const totals = new Map<K, number>();
  for (const { kind, amountCents } of rows) totals.set(kind, (totals.get(kind) ?? 0) + amountCents);
  return totals;
}
