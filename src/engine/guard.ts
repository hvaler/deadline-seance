/**
 * The number guard: every number in a text must be a fact the text was given. Pure and deterministic; no state survives between calls.
 *
 * It finds *tokens* (dates, times, ticket keys, weekdays, decimals, integers with or without a sign, and number words) and checks each one against
 * the facts. It returns the offending tokens with their place in the text, not just a verdict. See `docs/rule.md` (2026-11-15) and
 * `.kiro/specs/death-certificate`.
 *
 * Limits, on purpose:
 * - It proves provenance, not meaning: a wrong number that happens to be another fact passes. Golden notes and equality tests cover meaning.
 * - It reads ASCII digits only, and the number words listed below. "twice", "half", ordinals in letters and Roman numerals are not read.
 * - A bare web address inside text is not neutralised (that is a Markdown matter).
 */

export type TokenKind = 'date' | 'time' | 'key' | 'weekday' | 'decimal' | 'number' | 'signed' | 'word';

export interface Token {
  readonly kind: TokenKind;
  /** Exactly the characters of the text that make the token (a percent sign and its space are part of it). */
  readonly text: string;
  /** Offset of the first character in the text. */
  readonly at: number;
  /** The integer, for `number`, `signed` and `word`. */
  readonly value?: number;
  readonly sign?: '+' | '-';
  /** True when the number is followed by `%`. The sign does not change the value. */
  readonly percent?: boolean;
}

export type OffendingReason = 'not-in-facts' | 'wrong-sign' | 'decimal' | 'unknown-key' | 'unknown-date' | 'unknown-time' | 'unknown-weekday';

export interface Offending extends Token {
  readonly reason: OffendingReason;
}

/** What a text may say: numbers (with their sign), strings that are dates, times or weekdays, and the keys that exist. */
export interface GuardFacts {
  readonly numbers: ReadonlySet<number>;
  readonly words: ReadonlySet<string>;
  readonly keys: readonly string[];
}

/** `[start, end)` offsets of the text that is data from the board (titles, names): not checked. */
export type Span = readonly [number, number];

export interface GuardResult {
  readonly ok: boolean;
  readonly offending: readonly Offending[];
}

const WEEKDAYS: ReadonlySet<string> = new Set([
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
]);

const WORD_VALUES: ReadonlyMap<string, number> = new Map([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10],
  ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['seventeen', 17], ['eighteen', 18],
  ['nineteen', 19], ['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90],
  ['hundred', 100], ['thousand', 1000], ['million', 1_000_000], ['dozen', 12],
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= '0' && ch <= '9';
const isLetter = (ch: string | undefined): boolean => ch !== undefined && /\p{L}/u.test(ch);
const isAlnum = (ch: string | undefined): boolean => isDigit(ch) || isLetter(ch);
const SIGNS = new Set(['-', '\u2212', '\u2013', '+']);

export interface ExtractOptions {
  readonly ignore?: readonly Span[];
  /** Keys that exist. A known key is recognised first, whole, so a key such as `A3` leaves no stray `3`. */
  readonly keys?: readonly string[];
}

/** The tokens of a text, in order. Never throws. */
export function extractTokens(text: string, options: ExtractOptions = {}): Token[] {
  // Fresh expressions on every call: nothing (such as `lastIndex`) survives between calls.
  const date = /\d{4}-\d{2}-\d{2}/y;
  const time = /\d{1,2}:\d{2}/y;
  const keyShaped = /[A-Z][A-Z0-9]*-\d+/y;
  const decimal = /\d+\.\d+/y;
  const grouped = /\d{1,3}(?:,\d{3})+(?!\d)/y;
  const plain = /\d+/y;

  const known = [...new Set(options.keys ?? [])].filter((k) => k.length > 0).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  const spans = [...(options.ignore ?? [])].sort((a, b) => a[0] - b[0]);
  let spanIndex = 0;
  const tokens: Token[] = [];

  const at = (re: RegExp, i: number): string | null => {
    re.lastIndex = i;
    const m = re.exec(text);
    return m === null ? null : m[0];
  };

  let i = 0;
  while (i < text.length) {
    // Skip data text.
    while (spanIndex < spans.length && (spans[spanIndex] as Span)[1] <= i) spanIndex++;
    const span = spans[spanIndex];
    if (span !== undefined && span[0] <= i && i < span[1]) {
      i = span[1];
      continue;
    }
    const ch = text[i] as string;
    const prev = i > 0 ? text[i - 1] : undefined;

    // 1. A known key, whole.
    if (!isAlnum(prev) && (isAlnum(ch) || ch === '_')) {
      let matched: string | null = null;
      for (const key of known) {
        if (text.startsWith(key, i) && !isAlnum(text[i + key.length])) {
          matched = key;
          break;
        }
      }
      // A known key that is only the start of a longer key-shaped word ("T" in "T-7") is not that key.
      const shaped = isLetter(ch) ? at(keyShaped, i) : null;
      if (matched !== null && (shaped === null || shaped.length <= matched.length || isAlnum(text[i + shaped.length]))) {
        tokens.push({ kind: 'key', text: matched, at: i });
        i += matched.length;
        continue;
      }
    }

    if (isDigit(ch) && !isDigit(prev)) {
      // 2. A date, then a time.
      const d = at(date, i);
      if (d !== null && !isDigit(text[i + d.length])) {
        tokens.push({ kind: 'date', text: d, at: i });
        i += d.length;
        continue;
      }
      const t = at(time, i);
      if (t !== null && !isDigit(text[i + t.length])) {
        tokens.push({ kind: 'time', text: t, at: i });
        i += t.length;
        continue;
      }
      // 5. A decimal.
      const dec = at(decimal, i);
      if (dec !== null) {
        tokens.push({ kind: 'decimal', text: dec, at: i });
        i += dec.length;
        continue;
      }
    }

    // 3. A key-shaped word, 4. a weekday or a number word: they start at the beginning of a run of letters.
    if (isLetter(ch) && !isLetter(prev)) {
      if (!isAlnum(prev)) {
        const k = at(keyShaped, i);
        if (k !== null && !isAlnum(text[i + k.length])) {
          tokens.push({ kind: 'key', text: k, at: i });
          i += k.length;
          continue;
        }
      }
      let end = i;
      while (end < text.length && isLetter(text[end])) end++;
      const word = text.slice(i, end);
      if (WEEKDAYS.has(word)) tokens.push({ kind: 'weekday', text: word, at: i });
      else {
        const value = WORD_VALUES.get(word.toLowerCase());
        if (value !== undefined) tokens.push({ kind: 'word', text: word, at: i, value });
      }
      i = end;
      continue;
    }
    if (isLetter(ch)) {
      i++;
      continue;
    }

    // 6. An integer, with an optional sign in front and an optional percent sign after.
    let start = i;
    let sign: '+' | '-' | undefined;
    if (SIGNS.has(ch) && isDigit(text[i + 1]) && !isAlnum(prev) && prev !== '.') {
      sign = ch === '+' ? '+' : '-';
      i++;
    }
    if (isDigit(text[i]) && (sign !== undefined || !isDigit(prev))) {
      const digits = (!isDigit(prev) ? at(grouped, i) : null) ?? at(plain, i);
      if (digits !== null) {
        let end = i + digits.length;
        let percent = false;
        let p = end;
        if (text[p] === ' ') p++;
        if (text[p] === '%') {
          percent = true;
          end = p + 1;
        }
        const value = Number(digits.replace(/,/g, ''));
        const token: Token = { kind: sign === undefined ? 'number' : 'signed', text: text.slice(start, end), at: start, value, ...(sign === undefined ? {} : { sign }), ...(percent ? { percent } : {}) };
        tokens.push(token);
        i = end;
        continue;
      }
    }
    i = start + 1;
    start = i;
  }
  return tokens;
}

// ---- facts ------------------------------------------------------------------------------------------------------------------

function walk(value: unknown, numbers: Set<number>, words: Set<string>, seen: WeakSet<object>): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) numbers.add(value);
  } else if (typeof value === 'string') {
    if (DATE_RE.test(value) || TIME_RE.test(value) || WEEKDAYS.has(value)) words.add(value);
  } else if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of value) walk(item, numbers, words, seen);
  } else if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return;
    seen.add(value);
    for (const item of Object.values(value)) walk(item, numbers, words, seen);
  }
}

/**
 * The facts of one or more sources: every finite number found anywhere in their values, every string value that is a date, a time or a
 * weekday, and the keys given. It reads values only, never property names.
 */
export function guardFacts(sources: readonly unknown[], options: { readonly keys?: readonly string[] } = {}): GuardFacts {
  const numbers = new Set<number>();
  const words = new Set<string>();
  const seen = new WeakSet<object>();
  for (const source of sources) walk(source, numbers, words, seen);
  return { numbers, words, keys: [...new Set(options.keys ?? [])] };
}

// ---- the check --------------------------------------------------------------------------------------------------------------

function judge(token: Token, facts: GuardFacts, keys: ReadonlySet<string>): OffendingReason | null {
  switch (token.kind) {
    case 'date':
      return facts.words.has(token.text) ? null : 'unknown-date';
    case 'time':
      return facts.words.has(token.text) ? null : 'unknown-time';
    case 'weekday':
      return facts.words.has(token.text) ? null : 'unknown-weekday';
    case 'key':
      return keys.has(token.text) ? null : 'unknown-key';
    case 'decimal':
      return 'decimal';
    case 'number':
    case 'word': {
      const n = token.value as number;
      return facts.numbers.has(n) || facts.numbers.has(-n) ? null : 'not-in-facts';
    }
    case 'signed': {
      const n = token.value as number;
      if (token.sign === '-') {
        if (facts.numbers.has(-n)) return null;
        return facts.numbers.has(n) ? 'wrong-sign' : 'not-in-facts';
      }
      if (n > 0 ? facts.numbers.has(n) : facts.numbers.has(0)) return null;
      return facts.numbers.has(-n) ? 'wrong-sign' : 'not-in-facts';
    }
  }
}

/** Checks every token of `text`. `ok` is true exactly when `offending` is empty; `offending` is in the order of the text. */
export function checkNumbers(text: string, facts: GuardFacts, options: { readonly ignore?: readonly Span[] } = {}): GuardResult {
  const keys = new Set(facts.keys);
  const tokens = extractTokens(text, { ignore: options.ignore ?? [], keys: facts.keys });
  const offending: Offending[] = [];
  for (const token of tokens) {
    const reason = judge(token, facts, keys);
    if (reason !== null) offending.push({ ...token, reason });
  }
  return { ok: offending.length === 0, offending };
}
