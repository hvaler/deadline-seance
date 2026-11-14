// ---- number provenance -------------------------------------------------------------------------------------------------
//
// Every integer in a sentence must be a fact the sentence was built from. Facts are the numbers found anywhere inside the objects the
// sentence function received (and the absolute value of a negative one, which is how a loss is shown). Keys ("HB-112") and the clock labels
// of the candle ("Fri 18:00") carry digits that are names, not numbers, so they are taken out first.

export function numbersIn(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    into.add(value);
    into.add(Math.abs(value));
  } else if (Array.isArray(value)) {
    for (const item of value) numbersIn(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) numbersIn(item, into);
  }
  return into;
}

export function integersInText(text: string): number[] {
  const withoutNames = text.replace(/[A-Za-z]+-\d+/g, ' ').replace(/\b\d{2}:\d{2}\b/g, ' ');
  // "1,000" is the integer 1000: a comma between groups of three digits is formatting, not two numbers.
  const joined = withoutNames.replace(/\d{1,3}(?:,\d{3})+/g, (group) => group.replace(/,/g, ''));
  return (joined.match(/\d+/g) ?? []).map(Number);
}

export function unexplained(text: string, ...sources: unknown[]): number[] {
  const facts = new Set<number>();
  for (const source of sources) numbersIn(source, facts);
  return integersInText(text).filter((n) => !facts.has(n));
}