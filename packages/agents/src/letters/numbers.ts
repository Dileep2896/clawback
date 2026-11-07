const RULE_NAMES = ["Rule 17.1", "Rule 12"];

const MONEY = /\$[\d,]+(?:\.\d{2})?/g;

export const amountsIn = (text: string) => text.match(MONEY) ?? [];

/**
 * Model wording may not carry its own numbers, because code fills in every figure. allowed lists exact strings it may quote.
 * shortcut: spelled-out numbers ("twelve thousand") pass, upgrade if a run ever shows one.
 */
export function assertNoOwnNumbers(text: string, allowed: string[] = []) {
  let rest = text;
  for (const quoted of [...RULE_NAMES, ...allowed]) rest = rest.replaceAll(quoted, "");
  const found = /[^\s]*[\d$][^\s]*/.exec(rest)?.[0];
  if (found) throw new Error(`Wording may not hold numbers, the tool fills them in. Remove "${found}" and call again.`);
}
