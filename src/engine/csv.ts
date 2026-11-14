import { findCycles } from './chain';
import { compareKeys } from './keys';
import { validateBoard } from './validate';
import { DEFAULT_FOG_SEED, SCALE, err, ok } from './types';
import type { Cost, Key, Person, Result, Ticket, ValidBoard } from './types';

/**
 * Jira CSV: reading and writing CSV text (RFC 4180), importing tickets from a Jira export with every error as data, and exporting the board as a CSV
 * Jira can import. Pure: no clock, no DOM, no network. See `docs/rule.md` (2026-11-16) and `.kiro/specs/jira-csv`.
 *
 * Row numbers are the ones a spreadsheet shows: the header is row 1, a cell with line breaks does not make more rows, and blank rows count.
 */

// ---- limits and errors -------------------------------------------------------------------------------------------------------

export const CSV_LIMITS = {
  /** The size of the file. */
  bytes: 1_048_576,
  /** Rows (records), the header included. */
  rows: 2000,
  columns: 300,
  /** Open tickets: the size the solver and the fog stay fast at (measured, see the spec). */
  tickets: 60,
  errors: 100,
  key: 100,
  summary: 1000,
} as const;

export type CsvErrorCode =
  | 'empty-file'
  | 'no-tickets'
  | 'unterminated-quote'
  | 'missing-column'
  | 'duplicate-column'
  | 'missing-value'
  | 'bad-key'
  | 'too-long'
  | 'not-integer'
  | 'negative-number'
  | 'off-scale'
  | 'cost-incomplete'
  | 'cost-both'
  | 'cost-missing'
  | 'bad-flag'
  | 'duplicate-key'
  | 'unknown-dependency'
  | 'self-dependency'
  | 'dependency-cycle'
  | 'too-many-rows'
  | 'too-many-tickets'
  | 'too-many-columns'
  | 'file-too-large'
  | 'board-too-large'
  | 'too-many-errors';

export interface CsvColumn {
  /** Position in the header, from 0. */
  readonly index: number;
  /** A, B, ..., Z, AA, ... as a spreadsheet names it. */
  readonly letter: string;
  /** The header text as the file has it. */
  readonly header: string;
}

export interface CsvError {
  readonly code: CsvErrorCode;
  /** The spreadsheet row, or null for the whole file. */
  readonly row: number | null;
  readonly column: CsvColumn | null;
  /** The offending text, or what the error needs to say (the header expected, the first row of a duplicate, the limit's name). */
  readonly value?: string;
  readonly keys?: readonly Key[];
  readonly limit?: number;
  /** For `too-many-errors`: how many errors there were in all. */
  readonly total?: number;
}

export type CsvWarning = 'replacement-characters';

// ---- the accepted headers ----------------------------------------------------------------------------------------------------

export type Meaning = 'key' | 'title' | 'points' | 'value' | 'urgency' | 'risk' | 'cod' | 'mustHave' | 'dependsOn' | 'blockedBy' | 'blocks' | 'past' | 'resolution';

export interface HeaderSpec {
  readonly meaning: Meaning;
  /** The name shown in the README and in errors. */
  readonly label: string;
  readonly repeatable: boolean;
  /** Lower case, as `normalizeHeader` leaves a header. `Custom field (X)` is matched as `X`. */
  readonly names: readonly string[];
}

/** The one table of accepted headers: the importer reads it, and the README prints it. */
export const ACCEPTED_HEADERS: readonly HeaderSpec[] = [
  { meaning: 'key', label: 'Issue key', repeatable: false, names: ['issue key', 'key'] },
  { meaning: 'title', label: 'Summary', repeatable: false, names: ['summary'] },
  { meaning: 'points', label: 'Story Points', repeatable: false, names: ['story points', 'story point estimate', 'story point'] },
  { meaning: 'value', label: 'Value', repeatable: false, names: ['value'] },
  { meaning: 'urgency', label: 'Urgency', repeatable: false, names: ['urgency'] },
  { meaning: 'risk', label: 'Risk', repeatable: false, names: ['risk'] },
  { meaning: 'cod', label: 'Cost of Delay', repeatable: false, names: ['cost of delay', 'cod'] },
  { meaning: 'mustHave', label: 'Must Have', repeatable: false, names: ['must have', 'must-have'] },
  { meaning: 'dependsOn', label: 'Depends On', repeatable: true, names: ['depends on'] },
  { meaning: 'blockedBy', label: 'Inward issue link (Blocks)', repeatable: true, names: ['inward issue link (blocks)'] },
  { meaning: 'blocks', label: 'Outward issue link (Blocks)', repeatable: true, names: ['outward issue link (blocks)'] },
  { meaning: 'past', label: 'Times Postponed', repeatable: false, names: ['times postponed'] },
  { meaning: 'resolution', label: 'Resolution', repeatable: false, names: ['resolution'] },
];

function normalizeHeader(header: string): string {
  const spaced = header.trim().replace(/\s+/g, ' ').toLowerCase();
  const custom = /^custom field \((.+)\)$/.exec(spaced);
  return custom === null ? spaced : (custom[1] as string).trim();
}

const SPEC_BY_NAME: ReadonlyMap<string, HeaderSpec> = new Map(ACCEPTED_HEADERS.flatMap((spec) => spec.names.map((name) => [name, spec] as const)));

/** A, B, ..., Z, AA, AB, ... */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---- reading CSV -------------------------------------------------------------------------------------------------------------

export type Delimiter = ',' | ';';

export interface ParsedCsv {
  readonly delimiter: Delimiter;
  /** Every row as a spreadsheet shows it; row `i` of the sheet is `records[i - 1]`. A blank line is `['']`. */
  readonly records: readonly (readonly string[])[];
}

function detectDelimiter(text: string): Delimiter {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted) {
      if (ch === ',') commas++;
      else if (ch === ';') semicolons++;
      else if (ch === '\n' || ch === '\r') break;
    }
  }
  return semicolons > commas ? ';' : ',';
}

/**
 * Reads CSV text by RFC 4180. A byte order mark at the start is dropped; a first line `sep=;` (or `sep=,`) sets the delimiter and is not a row;
 * otherwise the delimiter is the one of `,` and `;` that the first row has more of outside quotes (a tie is a comma). Never throws.
 */
export function parseCsv(input: string, forced?: Delimiter): Result<ParsedCsv, CsvError> {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  let delimiter: Delimiter | null = forced ?? null;
  const hint = /^sep=([,;])(?:\r\n|\n|\r|$)/i.exec(text);
  if (hint !== null) {
    if (delimiter === null) delimiter = hint[1] as Delimiter;
    text = text.slice(hint[0].length);
  }
  const chosen: Delimiter = delimiter ?? detectDelimiter(text);

  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let started = false; // something belongs to the current record
  let atFieldStart = true;
  let quoted = false;
  let quoteRow = 0;
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      quoteRow = records.length + 1;
      started = true;
      atFieldStart = false;
      i++;
    } else if (ch === chosen) {
      record.push(field);
      field = '';
      started = true;
      atFieldStart = true;
      i++;
    } else if (ch === '\n' || ch === '\r') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      started = false;
      atFieldStart = true;
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      started = true;
      atFieldStart = false;
      i++;
    }
  }
  if (quoted) return err({ code: 'unterminated-quote', row: quoteRow, column: null });
  if (started) {
    record.push(field);
    records.push(record);
  }
  return ok({ delimiter: chosen, records });
}

// ---- writing CSV -------------------------------------------------------------------------------------------------------------

function wellFormed(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text.slice(i, i + 2);
        i++;
      } else out += '\ufffd';
    } else if (code >= 0xdc00 && code <= 0xdfff) out += '\ufffd';
    else out += text.charAt(i);
  }
  return out;
}

/** Replaces every lone UTF-16 surrogate with U+FFFD, so the string is what a UTF-8 file would hold. */
export function toWellFormed(text: string): string {
  return wellFormed(text);
}

/**
 * Writes records as CSV: a field is quoted when it holds a comma, a semicolon, a quote, CR or LF, or starts or ends with a space (or looks like the
 * `sep=` hint at the very start); every record ends with CRLF. Lone surrogates become U+FFFD.
 */
export function serializeCsv(records: readonly (readonly string[])[], delimiter: Delimiter): string {
  let out = '';
  records.forEach((record, r) => {
    out += record
      .map((raw, c) => {
        const field = wellFormed(raw);
        const hint = r === 0 && c === 0 && /^sep=/i.test(field);
        const special = /[,;"\r\n]/.test(field) || field.startsWith(' ') || field.endsWith(' ') || hint;
        return special ? `"${field.replace(/"/g, '""')}"` : field;
      })
      .join(delimiter);
    out += '\r\n';
  });
  return out;
}

// ---- spreadsheet formulas ----------------------------------------------------------------------------------------------------

/** One leading apostrophe on a text that a spreadsheet would read as a formula: `=`, `+`, `-`, `@`, tab or CR, after any apostrophes. */
export function guardCell(text: string): string {
  return /^'*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Takes back exactly the apostrophe `guardCell` adds. */
export function unguardCell(text: string): string {
  return /^'+[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}

// ---- importing ---------------------------------------------------------------------------------------------------------------

/** What an import takes from the board the app started with: the team, the calendar and the rule's settings. */
export interface ImportBase {
  readonly people: readonly Person[];
  readonly timeZone: string;
  readonly nextReleaseWeeks: number;
  readonly zombieThreshold: number;
}

export interface Imported {
  readonly board: ValidBoard;
  /** Open tickets. */
  readonly ticketCount: number;
  /** Keys closed as Won't Do in the file. */
  readonly putDown: readonly Key[];
  /** The same tickets with the data the file has for them (title, points, cost, links, past), by key. They are not on the board; an export writes them back. */
  readonly putDownTickets: readonly Ticket[];
  /** Rows that were already finished (a resolution other than Won't Do): skipped. */
  readonly skipped: { readonly count: number; readonly byResolution: readonly { readonly resolution: string; readonly count: number }[] };
  readonly warnings: readonly CsvWarning[];
}

const SCALE_SET: ReadonlySet<number> = new Set(SCALE);

function isWontDo(resolution: string): boolean {
  return resolution.replace(/\u2019/g, "'").trim().toLowerCase() === "won't do";
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 40 ? `${flat.slice(0, 40)}\u2026` : flat;
}

function splitKeys(cell: string): string[] {
  return unguardCell(cell)
    .split(/[;,\s]+/)
    .map((k) => k.trim())
    .filter((k) => k !== '');
}

/** Sorting of errors: the whole file first, then by row, column, code and value. */
function compareErrors(a: CsvError, b: CsvError): number {
  const rowA = a.row ?? -1;
  const rowB = b.row ?? -1;
  if (rowA !== rowB) return rowA - rowB;
  const colA = a.column?.index ?? -1;
  const colB = b.column?.index ?? -1;
  if (colA !== colB) return colA - colB;
  return compareKeys(a.code, b.code) || compareKeys(a.value ?? '', b.value ?? '') || compareKeys((a.keys ?? []).join(' '), (b.keys ?? []).join(' '));
}

function finish(errors: CsvError[]): Result<never, readonly CsvError[]> {
  const sorted = [...errors].sort(compareErrors);
  if (sorted.length <= CSV_LIMITS.errors) return err(sorted);
  const kept = sorted.slice(0, CSV_LIMITS.errors);
  kept.push({ code: 'too-many-errors', row: null, column: null, total: sorted.length, limit: CSV_LIMITS.errors });
  return err(kept);
}

interface Row {
  readonly number: number;
  readonly cells: readonly string[];
}

type CountResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly code: CsvErrorCode; readonly text: string };

/** A whole number written with digits; `5.0` is 5; `0.5`, `2,5`, `abc`, an exponent and anything past the safe range are not. */
function readCount(raw: string): CountResult {
  const text = raw.trim();
  if (text === '') return { ok: false, code: 'missing-value', text };
  const whole = /^(\d+)(?:\.0+)?$/.exec(text);
  if (whole !== null) {
    const value = Number(whole[1]);
    return Number.isSafeInteger(value) ? { ok: true, value } : { ok: false, code: 'not-integer', text };
  }
  if (/^-\d+(?:\.0+)?$/.test(text)) return { ok: false, code: 'negative-number', text };
  return { ok: false, code: 'not-integer', text };
}

/**
 * Imports the tickets of a Jira CSV export. Errors are data: all of them are returned, sorted, up to 100; nothing is thrown. A problem with the
 * header (a missing or repeated column) is returned alone, because without the column every row would fail the same way.
 */
export function importCsv(text: string, base: ImportBase): Result<Imported, readonly CsvError[]> {
  if (text.length > CSV_LIMITS.bytes) return err([{ code: 'file-too-large', row: null, column: null, limit: CSV_LIMITS.bytes }]);
  if (text.trim() === '') return err([{ code: 'empty-file', row: null, column: null }]);

  const parsed = parseCsv(text);
  if (!parsed.ok) return err([parsed.error]);
  const records = parsed.value.records;
  if (records.length > CSV_LIMITS.rows) return err([{ code: 'too-many-rows', row: null, column: null, value: String(records.length), limit: CSV_LIMITS.rows }]);
  const headerRecord = records[0] ?? [];
  if (headerRecord.length > CSV_LIMITS.columns) {
    return err([{ code: 'too-many-columns', row: 1, column: null, value: String(headerRecord.length), limit: CSV_LIMITS.columns }]);
  }

  // ---- the header ----
  const columns = new Map<Meaning, CsvColumn[]>();
  const headerErrors: CsvError[] = [];
  headerRecord.forEach((header, index) => {
    const spec = SPEC_BY_NAME.get(normalizeHeader(header));
    if (spec === undefined) return;
    const column: CsvColumn = { index, letter: columnLetter(index), header };
    const seen = columns.get(spec.meaning) ?? [];
    if (seen.length > 0 && !spec.repeatable) {
      headerErrors.push({ code: 'duplicate-column', row: 1, column, value: (seen[0] as CsvColumn).letter });
      return;
    }
    seen.push(column);
    columns.set(spec.meaning, seen);
  });
  const has = (m: Meaning): boolean => columns.has(m);
  const missing = (m: Meaning): void => {
    const spec = ACCEPTED_HEADERS.find((s) => s.meaning === m) as HeaderSpec;
    headerErrors.push({ code: 'missing-column', row: null, column: null, value: spec.label });
  };
  for (const m of ['key', 'title', 'points'] as const) if (!has(m)) missing(m);
  const anyPart = has('value') || has('urgency') || has('risk');
  if (!has('cod')) {
    if (!anyPart) missing('cod');
    else for (const m of ['value', 'urgency', 'risk'] as const) if (!has(m)) missing(m);
  }
  if (headerErrors.length > 0) return finish(headerErrors);

  const col = (m: Meaning): CsvColumn | null => columns.get(m)?.[0] ?? null;
  const cellOf = (row: Row, c: CsvColumn | null): string => (c === null ? '' : (row.cells[c.index] ?? ''));

  // ---- the rows ----
  const errors: CsvError[] = [];
  const at = (row: Row, code: CsvErrorCode, column: CsvColumn | null, extra: Partial<CsvError> = {}): void => {
    errors.push({ code, row: row.number, column, ...extra });
  };
  const rows: Row[] = [];
  records.forEach((cells, i) => {
    if (i === 0) return;
    if (cells.every((c) => c.trim() === '')) return;
    rows.push({ number: i + 1, cells });
  });
  if (rows.length === 0) return err([{ code: 'no-tickets', row: null, column: null }]);

  const keyCol = col('key') as CsvColumn;
  const titleCol = col('title') as CsvColumn;
  const pointsCol = col('points') as CsvColumn;
  const resolutionCol = col('resolution');

  type Kind = 'open' | 'putDown' | 'closed';
  const kindOf = new Map<Key, { kind: Kind; row: number }>();
  const classified: { row: Row; kind: Kind; key: Key; resolution: string }[] = [];
  const skippedBy = new Map<string, { resolution: string; count: number }>();
  for (const row of rows) {
    const key = unguardCell(cellOf(row, keyCol)).trim();
    const resolution = cellOf(row, resolutionCol).trim();
    const kind: Kind = resolution === '' ? 'open' : isWontDo(resolution) ? 'putDown' : 'closed';
    if (kind === 'closed') {
      const group = skippedBy.get(resolution.toLowerCase());
      if (group === undefined) skippedBy.set(resolution.toLowerCase(), { resolution, count: 1 });
      else group.count++;
    }
    if (key === '') {
      if (kind !== 'closed') at(row, 'missing-value', keyCol);
      continue;
    }
    if (kind !== 'closed' && (/[\s,;]/.test(key) || key.length > CSV_LIMITS.key)) {
      at(row, 'bad-key', keyCol, { value: shorten(key), limit: CSV_LIMITS.key });
      continue;
    }
    const first = kindOf.get(key);
    if (first !== undefined) {
      at(row, 'duplicate-key', keyCol, { keys: [key], value: String(first.row) });
      continue;
    }
    kindOf.set(key, { kind, row: row.number });
    classified.push({ row, kind, key, resolution });
  }

  const openRows = classified.filter((c) => c.kind === 'open');
  const putDownKeys = classified.filter((c) => c.kind === 'putDown').map((c) => c.key);
  if (openRows.length > CSV_LIMITS.tickets) {
    errors.push({ code: 'too-many-tickets', row: null, column: null, value: String(openRows.length), limit: CSV_LIMITS.tickets });
  }

  const valueCols = { value: col('value'), urgency: col('urgency'), risk: col('risk') };
  const codCol = col('cod');
  const mustCol = col('mustHave');
  const pastCol = col('past');
  const linkCols: { column: CsvColumn; inverse: boolean }[] = [
    ...(columns.get('dependsOn') ?? []).map((column) => ({ column, inverse: false })),
    ...(columns.get('blockedBy') ?? []).map((column) => ({ column, inverse: false })),
    ...(columns.get('blocks') ?? []).map((column) => ({ column, inverse: true })),
  ];

  const draft = new Map<Key, { ticket: Omit<Ticket, 'dependsOn'>; deps: Set<Key> }>();
  const order: Key[] = [];
  for (const { row, key } of openRows) {
    const title = unguardCell(cellOf(row, titleCol));
    if (title.trim() === '') at(row, 'missing-value', titleCol);
    else if (title.length > CSV_LIMITS.summary) at(row, 'too-long', titleCol, { value: shorten(title), limit: CSV_LIMITS.summary });

    const count = (column: CsvColumn | null, allowEmpty: boolean): number | null => {
      if (column === null) return allowEmpty ? 0 : null;
      const r = readCount(cellOf(row, column));
      if (r.ok) return r.value;
      if (allowEmpty && r.code === 'missing-value') return 0;
      at(row, r.code, column, r.text === '' ? {} : { value: shorten(r.text) });
      return null;
    };
    const effort = count(pointsCol, false);
    const past = count(pastCol, true);

    // the cost of delay
    let cost: Cost | null = null;
    const codText = cellOf(row, codCol).trim();
    const partCols = [valueCols.value, valueCols.urgency, valueCols.risk];
    const partTexts = partCols.map((c) => cellOf(row, c).trim());
    const filled = partTexts.filter((t) => t !== '').length;
    if (codText !== '' && filled > 0) at(row, 'cost-both', codCol);
    else if (codText !== '') {
      const cod = count(codCol, false);
      if (cod !== null) cost = { kind: 'imported', cod };
    } else if (filled === 3) {
      const parts = partCols.map((c) => count(c, false));
      if (parts.every((p) => p !== null)) {
        const bad = parts.findIndex((p) => !SCALE_SET.has(p as number));
        if (bad >= 0) at(row, 'off-scale', partCols[bad] as CsvColumn, { value: partTexts[bad] as string });
        else cost = { kind: 'formula', value: parts[0] as number, urgency: parts[1] as number, risk: parts[2] as number };
      }
    } else if (filled > 0) {
      const names = ['Value', 'Urgency', 'Risk'].filter((_, i) => partTexts[i] === '');
      const firstMissing = partCols[partTexts.findIndex((t) => t === '')] as CsvColumn;
      at(row, 'cost-incomplete', firstMissing, { value: names.join(', ') });
    } else at(row, 'cost-missing', codCol ?? valueCols.value);

    // must-have
    let mustHave = false;
    const flag = cellOf(row, mustCol).trim().toLowerCase();
    if (flag !== '') {
      if (['yes', 'true', 'y', '1'].includes(flag)) mustHave = true;
      else if (!['no', 'false', 'n', '0'].includes(flag)) at(row, 'bad-flag', mustCol, { value: shorten(flag) });
    }

    if (effort !== null && past !== null && cost !== null) {
      draft.set(key, { ticket: { key, title, effort, cost, mustHave, past }, deps: new Set() });
      order.push(key);
    }
  }

  // ---- dependencies ----
  const putDownDeps = new Map<Key, Set<Key>>(putDownKeys.map((k) => [k, new Set<Key>()] as const));
  for (const { row, key, kind } of classified) {
    if (kind !== 'open') continue; // a put-down row is read leniently below; a closed one not at all
    for (const { column, inverse } of linkCols) {
      for (const target of splitKeys(cellOf(row, column))) {
        if (target === key) {
          at(row, 'self-dependency', column, { keys: [key] });
          continue;
        }
        const known = kindOf.get(target);
        if (known === undefined) {
          at(row, 'unknown-dependency', column, { keys: [target] });
          continue;
        }
        if (known.kind === 'closed') continue; // already finished: it no longer blocks anything
        if (inverse) {
          if (known.kind === 'open') draft.get(target)?.deps.add(key);
          else if (known.kind === 'putDown') putDownDeps.get(target)?.add(key); // this ticket blocks a put-down one
        } else draft.get(key)?.deps.add(target);
      }
    }
  }

  // The tickets put down in the file keep their data, so that an export writes them back as they were. They are read leniently: they are not
  // on the board, so a cell that is missing or wrong is not an error, it takes a plain default.
  const putDownTickets: Ticket[] = [];
  for (const { row, key, kind } of classified) {
    if (kind !== 'putDown') continue;
    const count = (column: CsvColumn | null): number | null => {
      const r = readCount(cellOf(row, column));
      return r.ok ? r.value : null;
    };
    const parts = [valueCols.value, valueCols.urgency, valueCols.risk].map((c) => count(c));
    const onScale = parts.every((p) => p !== null && SCALE_SET.has(p));
    const cost: Cost = onScale ? { kind: 'formula', value: parts[0] as number, urgency: parts[1] as number, risk: parts[2] as number } : { kind: 'imported', cod: count(codCol) ?? 0 };
    const flag = cellOf(row, mustCol).trim().toLowerCase();
    const title = unguardCell(cellOf(row, titleCol));
    const deps = new Set<Key>(putDownDeps.get(key));
    for (const { column, inverse } of linkCols) {
      if (inverse) continue;
      for (const target of splitKeys(cellOf(row, column))) {
        const known = kindOf.get(target);
        if (target !== key && known !== undefined && known.kind !== 'closed') deps.add(target);
      }
    }
    putDownTickets.push({
      key,
      title: title.trim() === '' ? key : title,
      effort: count(pointsCol) ?? 0,
      cost,
      mustHave: ['yes', 'true', 'y', '1'].includes(flag),
      past: count(pastCol) ?? 0,
      dependsOn: [...deps].sort(compareKeys),
    });
  }
  putDownTickets.sort((a, b) => compareKeys(a.key, b.key));

  const tickets: Ticket[] = order.map((key) => {
    const d = draft.get(key) as { ticket: Omit<Ticket, 'dependsOn'>; deps: Set<Key> };
    return { ...d.ticket, dependsOn: [...d.deps].sort(compareKeys) };
  });
  for (const cycle of findCycles(tickets)) {
    const smallest = cycle[0] as Key;
    errors.push({ code: 'dependency-cycle', row: kindOf.get(smallest)?.row ?? null, column: null, keys: cycle });
  }

  if (errors.length > 0) return finish(errors);
  if (tickets.length === 0) return err([{ code: 'no-tickets', row: null, column: null }]);

  const wontDo = [...putDownKeys].sort(compareKeys);
  const checked = validateBoard({
    tickets,
    people: base.people,
    timeZone: base.timeZone,
    nextReleaseWeeks: base.nextReleaseWeeks,
    zombieThreshold: base.zombieThreshold,
    wontDo,
    fogSeed: DEFAULT_FOG_SEED,
  });
  if (!checked.ok) {
    // Everything the engine checks was checked above, except that the arithmetic must be exact.
    const first = checked.error[0];
    return err([{ code: 'board-too-large', row: null, column: null, value: first?.code ?? 'board-too-large' }]);
  }

  const byResolution = [...skippedBy.values()].sort((a, b) => b.count - a.count || compareKeys(a.resolution, b.resolution));
  return ok({
    board: checked.value,
    ticketCount: tickets.length,
    putDown: wontDo,
    putDownTickets,
    skipped: { count: byResolution.reduce((sum, g) => sum + g.count, 0), byResolution },
    warnings: text.includes('\ufffd') ? ['replacement-characters'] : [],
  });
}

// ---- exporting ---------------------------------------------------------------------------------------------------------------

export interface ExportInput {
  /** The current board: exhumes and put-downs applied. */
  readonly board: ValidBoard;
  /** The board as loaded: the data of the tickets that were put down from the board. */
  readonly home: ValidBoard;
  /** Tickets put down that home does not have (the ones a file said were Won't Do): their data is written back too. */
  readonly closed?: readonly Ticket[];
  /** The keys the current cut keeps, or null when the freeze is impossible (then `Fix Version/s` is left empty). */
  readonly kept: ReadonlySet<Key> | null;
  readonly release: string;
  readonly nextRelease: string;
}

export const EXPORT_HEADERS: readonly string[] = [
  'Issue key',
  'Summary',
  'Story Points',
  'Value',
  'Urgency',
  'Risk',
  'Cost of Delay',
  'Must Have',
  'Depends On',
  'Times Postponed',
  'Fix Version/s',
  'Resolution',
];

/** One row of the export: the import columns, then the version and the resolution. */
function ticketRow(t: Ticket, fixVersion: string, resolution: string): string[] {
  const cost = t.cost;
  return [
    guardCell(t.key),
    guardCell(t.title),
    String(t.effort),
    cost.kind === 'formula' ? String(cost.value) : '',
    cost.kind === 'formula' ? String(cost.urgency) : '',
    cost.kind === 'formula' ? String(cost.risk) : '',
    cost.kind === 'imported' ? String(cost.cod) : '',
    t.mustHave ? 'yes' : 'no',
    guardCell([...new Set(t.dependsOn)].sort(compareKeys).join(';')),
    String(t.past),
    guardCell(fixVersion),
    resolution,
  ];
}

/**
 * The board as a CSV for Jira's importer, and for this app: the import columns, `Fix Version/s` (the release for what the cut keeps, the next one for
 * what stays outside) and `Resolution` = `Won't Do` for the tickets put down, with all the data the app has for them (from home, or from closed). Comma, CRLF, UTF-8 text with no byte order mark.
 */
export function exportCsv(input: ExportInput): string {
  const { board, home, kept } = input;
  const records: string[][] = [[...EXPORT_HEADERS]];
  for (const t of board.tickets) {
    const fix = kept === null ? '' : kept.has(t.key) ? input.release : input.nextRelease;
    records.push(ticketRow(t, fix, ''));
  }
  const known = new Map<Key, Ticket>([...(input.closed ?? []).map((t) => [t.key, t] as const), ...home.tickets.map((t) => [t.key, t] as const)]);
  for (const key of [...board.wontDo].sort(compareKeys)) {
    const t = known.get(key);
    records.push(t === undefined ? [guardCell(key), guardCell(key), '', '', '', '', '', '', '', '', '', "Won't Do"] : ticketRow(t, '', "Won't Do"));
  }
  return serializeCsv(records, ',');
}
