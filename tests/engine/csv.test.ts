import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import {
  ACCEPTED_HEADERS,
  CSV_LIMITS,
  columnLetter,
  exportCsv,
  guardCell,
  importCsv,
  parseCsv,
  serializeCsv,
  toWellFormed,
  unguardCell,
} from '../../src/engine/csv';
import type { CsvError, ImportBase } from '../../src/engine/csv';
import { solveWithCapacity } from '../../src/engine/solver';
import type { Board, Ticket, ValidBoard } from '../../src/engine/types';
import { compareKeys } from '../../src/engine/keys';
import { makeBoard, ticket, valid } from './fixtures';
import { arbCost, arbCsvBoard, arbCsvTitle, canonicalBoard } from './generators';

// Jira CSV: reading and writing CSV text, importing with every error as data, exporting, and the round trip (P13, P26).

const fixtures = import.meta.glob('./fixtures/*.csv', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fixture = (name: string): string => fixtures[`./fixtures/${name}`] as string;

const BASE: ImportBase = {
  people: [{ name: 'Solo', pointsPerHalfDay: 5, daysOff: [] }],
  timeZone: 'Europe/Madrid',
  nextReleaseWeeks: 2,
  zombieThreshold: 3,
};

const HEADER = 'Issue key,Summary,Story Points,Cost of Delay';
const file = (...rows: string[]): string => [HEADER, ...rows].join('\n') + '\n';
const imported = (text: string) => importCsv(text, BASE);
const recordsOf = (text: string): string[][] => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error('parse failed');
  return r.value.records.map((x) => [...x]);
};
const errorList = (r: ReturnType<typeof importCsv>): CsvError[] => (r.ok ? [] : [...r.error]);
const errorsOf = (text: string): CsvError[] => {
  const r = imported(text);
  if (r.ok) throw new Error('expected errors');
  return [...r.error];
};
const summary = (e: CsvError): string => `${e.row ?? '-'}:${e.column?.letter ?? '-'}:${e.code}`;
const board = (text: string): ValidBoard => {
  const r = imported(text);
  if (!r.ok) throw new Error(`unexpected errors ${JSON.stringify(r.error)}`);
  return r.value.board;
};

describe('reading CSV (Requirement 1)', () => {
  const records = (text: string): string[][] => {
    const r = parseCsv(text);
    if (!r.ok) throw new Error('parse failed');
    return r.value.records.map((x) => [...x]);
  };

  test('fields, records, CRLF, LF and a lone CR', () => {
    expect(records('a,b\r\nc,d\ne,f\rg,h')).toEqual([['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']]);
  });

  test('quotes: a comma, a doubled quote and line breaks inside a field', () => {
    expect(records('"a,b","say ""hi""","x\r\ny\nz"\n')).toEqual([['a,b', 'say "hi"', 'x\r\ny\nz']]);
  });

  test('a quote inside an unquoted field is text, and text after a closing quote is kept', () => {
    expect(records('ab"c,d\n"e"f,g')).toEqual([['ab"c', 'd'], ['ef', 'g']]);
  });

  test('empty fields, a trailing delimiter and a final line end', () => {
    expect(records('a,,c,\n,\n')).toEqual([['a', '', 'c', ''], ['', '']]);
    expect(records('a\n')).toEqual([['a']]);
    expect(records('')).toEqual([]);
  });

  test('a blank line is a record, so row numbers stay true', () => {
    expect(records('a\n\nb')).toEqual([['a'], [''], ['b']]);
  });

  test('the byte order mark is dropped', () => {
    expect(records('\ufeffa,b\n')).toEqual([['a', 'b']]);
  });

  test('the delimiter is the one the first row has more of outside quotes; a tie is a comma', () => {
    const d = (t: string) => (parseCsv(t) as { value: { delimiter: string } }).value.delimiter;
    expect(d('a;b;c\n1,2,3')).toBe(';');
    expect(d('a,b,c;d\n')).toBe(',');
    expect(d('a,b;c\n')).toBe(',');
    expect(d('"a;b;c",d\n')).toBe(',');
    expect(d('single\n')).toBe(',');
  });

  test('a first line sep=; sets the delimiter and is not a row', () => {
    expect(parseCsv('sep=;\na;b\n1;2\n')).toEqual({ ok: true, value: { delimiter: ';', records: [['a', 'b'], ['1', '2']] } });
    expect((parseCsv('SEP=,\r\na,b') as { value: { delimiter: string } }).value.delimiter).toBe(',');
  });

  test('an unterminated quote is an error that names the row where it opened', () => {
    expect(parseCsv('a,b\nc,"d\ne')).toEqual({ ok: false, error: { code: 'unterminated-quote', row: 2, column: null } });
  });
});

describe('writing CSV', () => {
  test('quotes what needs it, doubles quotes, ends every record with CRLF', () => {
    expect(serializeCsv([['a', 'b,c', 'd"e', 'x\ny', ' pad', 'semi;colon', '']], ',')).toBe('a,"b,c","d""e","x\ny"," pad","semi;colon",\r\n');
  });

  test('a lone surrogate becomes U+FFFD, a pair is kept', () => {
    expect(serializeCsv([['\ud800', 'a\udc00b', '\u{1F600}']], ',')).toBe('\ufffd,a\ufffdb,\u{1F600}\r\n');
    expect(toWellFormed('x\ud83dy')).toBe('x\ufffdy');
  });

  test('a first cell that looks like the sep= hint is quoted', () => {
    expect(parseCsv(serializeCsv([['sep=;', 'b']], ','))).toEqual({ ok: true, value: { delimiter: ',', records: [['sep=;', 'b']] } });
  });

  test('parse(serialize(records)) gives the records back, for both delimiters', () => {
    const field = fc.oneof(fc.string({ maxLength: 12 }), fc.constantFrom('', ' ', ',', ';', '"', '\n', '\r\n', '\r', 'a,b;c', '""', "'=x"));
    const record = fc.array(field, { minLength: 1, maxLength: 6 });
    fc.assert(
      fc.property(fc.array(record, { minLength: 1, maxLength: 8 }), fc.constantFrom<',' | ';'>(',', ';'), (records, delimiter) => {
        const clean = records.map((r) => r.map(toWellFormed));
        // A first cell that starts with the byte order mark would be taken for one.
        if ((clean[0] as string[])[0]?.startsWith('\ufeff') === true) return;
        // The delimiter is known here; a file's own is found from its first row (tested above).
        const r = parseCsv(serializeCsv(clean, delimiter), delimiter);
        expect(r.ok && r.value.records).toEqual(clean);
      }),
      { numRuns: 300 },
    );
  });

  test('the reader never throws, whatever the text', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string({ unit: 'binary', maxLength: 120 }), fc.stringMatching(/^[a-z0-9,;"\r\n' ]{0,80}$/), fc.array(fc.constantFrom('"', ',', ';', '\n', '\r', 'a', ' ', 'sep=;'), { maxLength: 40 }).map((p) => p.join(''))),
        (text) => {
          expect(() => parseCsv(text)).not.toThrow();
          expect(() => importCsv(text, BASE)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('the headers (Requirement 2)', () => {
  test('column letters are the spreadsheet\'s', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  test('every accepted name is lower case and the table has the columns of the brief', () => {
    for (const spec of ACCEPTED_HEADERS) for (const name of spec.names) expect(name).toBe(name.toLowerCase());
    expect(ACCEPTED_HEADERS.map((s) => s.meaning)).toEqual(['key', 'title', 'points', 'value', 'urgency', 'risk', 'cod', 'mustHave', 'dependsOn', 'blockedBy', 'blocks', 'past', 'resolution']);
  });

  test('headers match without regard to case, spaces or a "Custom field (...)" wrapper', () => {
    const text = 'ISSUE KEY ,  summary,custom field (STORY  POINT estimate),Custom Field (Cost of Delay)\nA-1,x,3,9\n';
    expect(board(text).tickets[0]).toMatchObject({ key: 'A-1', effort: 3, cost: { kind: 'imported', cod: 9 } });
  });

  test('every other column is ignored, however often it repeats', () => {
    const text = 'Issue key,Summary,Labels,Labels,Story Points,Sprint,Sprint,Cost of Delay,Whatever\nA-1,x,l1,l2,3,s1,s2,9,"q,r"\n';
    expect(board(text).tickets).toHaveLength(1);
  });

  test('a missing required column is an error that names the header it expected', () => {
    const e = errorsOf('Summary\nx\n');
    expect(e.map((x) => [x.code, x.row, x.value])).toEqual([
      ['missing-column', null, 'Cost of Delay'],
      ['missing-column', null, 'Issue key'],
      ['missing-column', null, 'Story Points'],
    ]);
  });

  test('with some of Value, Urgency, Risk and no Cost of Delay, the missing parts are named', () => {
    const e = errorsOf('Issue key,Summary,Story Points,Value\nA-1,x,3,3\n');
    expect(e.map((x) => x.value)).toEqual(['Risk', 'Urgency']);
  });

  test('a column that may not repeat, repeated, is an error with both letters', () => {
    const e = errorsOf('Issue key,Summary,Story Points,Cost of Delay,Summary\nA-1,x,3,9,y\n');
    expect(e.map((x) => [x.code, x.row, x.column?.letter, x.value])).toEqual([['duplicate-column', 1, 'E', 'B']]);
  });

  test('a header error is returned alone: the rows are not read', () => {
    const e = errorsOf('Summary,Story Points\n,abc\n');
    expect(e.every((x) => x.code === 'missing-column')).toBe(true);
  });
});

describe('a real Jira Cloud export', () => {
  const text = fixture('jira-cloud-export.csv');

  test('the fixture has a byte order mark, the real header names, repeated columns and a cell with a line break', () => {
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const header = recordsOf(text)[0] as string[];
    expect(header.filter((h) => h === 'Sprint')).toHaveLength(2);
    expect(header.filter((h) => h === 'Inward issue link (Blocks)')).toHaveLength(2);
    expect(text).toContain('Card freeze toggle\r\nwith a line break');
  });

  test('gives exactly this board', () => {
    const r = imported(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.value.board;
    expect(b.tickets.map((t) => [t.key, t.title, t.effort, t.cost, t.mustHave, t.past, t.dependsOn])).toEqual([
      ['HB-1', 'Fix stale balance, after a transfer', 5, { kind: 'formula', value: 8, urgency: 5, risk: 5 }, false, 0, []],
      ['HB-2', 'Strong-auth callback (PSD2)', 8, { kind: 'formula', value: 8, urgency: 13, risk: 8 }, false, 0, []],
      ['HB-3', 'Card freeze toggle\r\nwith a line break', 5, { kind: 'formula', value: 8, urgency: 5, risk: 3 }, false, 0, ['HB-1']],
      ['HB-4', 'Push alerts "freeze"', 3, { kind: 'formula', value: 5, urgency: 3, risk: 3 }, false, 0, ['HB-1', 'HB-3']],
      ['HB-5', 'Savings goals', 13, { kind: 'imported', cod: 14 }, false, 0, []],
      ['HB-8', 'Dashboard widget', 2, { kind: 'formula', value: 3, urgency: 2, risk: 2 }, false, 0, []],
      ['HB-9', 'Statement export', 3, { kind: 'formula', value: 5, urgency: 3, risk: 3 }, false, 0, ['HB-8']],
      ['HB-10', 'FX rate alerts', 5, { kind: 'formula', value: 5, urgency: 3, risk: 3 }, false, 0, ['HB-7']],
    ]);
    expect(b.wontDo).toEqual(['HB-7']);
    expect(r.value.putDown).toEqual(['HB-7']);
    // the ticket the file closed as Won't Do keeps its data, though it is not on the board
    expect(r.value.putDownTickets).toEqual([
      { key: 'HB-7', title: 'Multi-currency wallet', effort: 21, cost: { kind: 'formula', value: 5, urgency: 2, risk: 3 }, mustHave: false, past: 0, dependsOn: [] },
    ]);
    expect(r.value.ticketCount).toBe(8);
    expect(r.value.skipped).toEqual({ count: 1, byResolution: [{ resolution: 'Done', count: 1 }] });
    expect(r.value.warnings).toEqual([]);
    expect([b.timeZone, b.nextReleaseWeeks, b.zombieThreshold, b.fogSeed, b.people]).toEqual([BASE.timeZone, 2, 3, 0, BASE.people]);
  });

  test('the Done issue is skipped and a link to it is dropped; the Won\'t Do issue blocks its dependent', () => {
    const b = board(text);
    expect(b.tickets.find((t) => t.key === 'HB-6')).toBeUndefined();
    expect(b.tickets.find((t) => t.key === 'HB-8')?.dependsOn).toEqual([]);
    expect(b.tickets.find((t) => t.key === 'HB-10')?.dependsOn).toEqual(['HB-7']);
    const solved = solveWithCapacity(b, 100, 0);
    const out = solved.ok && solved.value.status === 'ok' ? solved.value.buried.find((x) => x.key === 'HB-10') : undefined;
    expect(out?.reason).toEqual({ kind: 'blocked-by-put-down', putDownKey: 'HB-7' });
  });

  test('a semicolon file with a sep= line', () => {
    const b = board(fixture('jira-semicolon.csv'));
    expect(b.tickets.map((t) => [t.key, t.title, t.effort, t.cost, t.mustHave, t.past, t.dependsOn])).toEqual([
      ['HB-1', 'Pay; now', 5, { kind: 'imported', cod: 12 }, true, 0, []],
      ['HB-2', 'Receipts', 3, { kind: 'imported', cod: 7 }, false, 2, ['HB-1']],
    ]);
  });
});

describe('the errors (Requirement 3)', () => {
  test('a file with one mistake of every kind lists them all, by row and column, with the sentence\'s own data', () => {
    const e = errorsOf(fixture('jira-errors.csv'));
    expect(e.map((x) => [x.row, x.column?.letter ?? null, x.column?.header ?? null, x.code, x.value ?? null, x.keys ?? null])).toEqual([
      [3, 'C', 'Story Points', 'not-integer', '2.5', null],
      [4, 'C', 'Story Points', 'negative-number', '-1', null],
      [5, 'D', 'Value', 'off-scale', '4', null],
      [6, 'F', 'Risk', 'cost-incomplete', 'Risk', null],
      [7, 'G', 'Cost of Delay', 'cost-both', null, null],
      [8, 'G', 'Cost of Delay', 'cost-missing', null, null],
      [9, 'H', 'Must Have', 'bad-flag', 'maybe', null],
      [10, 'A', 'Issue key', 'duplicate-key', '2', ['E-1']],
      [11, 'A', 'Issue key', 'bad-key', 'E 9', null],
      [12, 'B', 'Summary', 'missing-value', null, null],
      [13, 'I', 'Depends On', 'unknown-dependency', null, ['NOPE']],
      [14, 'I', 'Depends On', 'self-dependency', null, ['E-12']],
      [15, null, null, 'dependency-cycle', null, ['E-13', 'E-14']],
      [18, 'J', 'Times Postponed', 'not-integer', 'abc', null],
    ]);
  });

  test('a line break inside a quoted cell is not a row; a blank row is', () => {
    const e = errorsOf(file('A-1,"two\nlines",3,9', 'A-2,x,abc,9'));
    expect(e.map(summary)).toEqual(['3:C:not-integer']);
    const blank = errorsOf(file('A-1,x,3,9', '', 'A-2,x,abc,9'));
    expect(blank.map(summary)).toEqual(['4:C:not-integer']);
  });

  test('errors are sorted whatever order they were found in, the whole file first', () => {
    const e = errorsOf(file('A-1,x,abc,9', 'A-2,x,3,9', 'A-3,x,3,9,', ...Array.from({ length: CSV_LIMITS.tickets }, (_, i) => `B-${i},x,3,9`)));
    const rows = e.map((x) => x.row ?? -1);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(e[0]?.code).toBe('too-many-tickets');
  });

  test('numbers: "5.0" is 5; "0.5", "1,5", "2e3", "abc" and past the safe range are not whole numbers; a minus sign is a negative number', () => {
    expect(board(file('A-1,x,5.0,9.00')).tickets[0]).toMatchObject({ effort: 5, cost: { cod: 9 } });
    for (const bad of ['0.5', '"1,5"', '2e3', 'abc', '9007199254740993', ' ']) {
      const e = errorsOf(file(`A-1,x,${bad},9`));
      expect(e[0]?.code, bad).toBe(bad === ' ' ? 'missing-value' : 'not-integer');
    }
    expect(errorsOf(file('A-1,x,-2,9'))[0]?.code).toBe('negative-number');
  });

  test('Value, Urgency and Risk must be on the scale; each part is read, none is optional once one is given', () => {
    const header = 'Issue key,Summary,Story Points,Value,Urgency,Risk\n';
    expect(importCsv(`${header}A-1,x,3,1,2,20\n`, BASE).ok).toBe(true);
    expect(importCsv(`${header}A-1,x,3,4,2,20\n`, BASE).ok).toBe(false);
    expect(errorList(importCsv(`${header}A-1,x,3,1,,20\n`, BASE))[0]).toMatchObject({ code: 'cost-incomplete', value: 'Urgency' });
  });

  test('rows of one file may use a Cost of Delay and others the three parts', () => {
    const text = 'Issue key,Summary,Story Points,Value,Urgency,Risk,Cost of Delay\nA-1,x,3,1,2,3,\nA-2,y,4,,,,10\n';
    expect(board(text).tickets.map((t) => t.cost)).toEqual([{ kind: 'formula', value: 1, urgency: 2, risk: 3 }, { kind: 'imported', cod: 10 }]);
  });

  test('Must Have reads yes/no, true/false, y/n and 1/0 in any case; Times Postponed is past', () => {
    const text = 'Issue key,Summary,Story Points,Cost of Delay,Must Have,Times Postponed\nA-1,x,3,1,YES,2\nA-2,x,3,1,No,\nA-3,x,3,1,true,0\nA-4,x,3,1,0,1\nA-5,x,3,1,,\n';
    expect(board(text).tickets.map((t) => [t.mustHave, t.past])).toEqual([[true, 2], [false, 0], [true, 0], [false, 1], [false, 0]]);
  });

  test('the dependency forms: Depends On with ; , and spaces, repeated inward links, and outward links as the inverse', () => {
    const text = [
      'Issue key,Summary,Story Points,Cost of Delay,Depends On,Inward issue link (Blocks),Inward issue link (Blocks),Outward issue link (Blocks)',
      'A-1,a,1,1,,,,',
      'A-2,b,1,1,"A-1; A-3,A-4 A-1",,,',
      'A-3,c,1,1,,A-1,A-4,',
      'A-4,d,1,1,,,,A-5',
      'A-5,e,1,1,,,,',
    ].join('\n');
    const deps = Object.fromEntries(board(text).tickets.map((t) => [t.key, t.dependsOn]));
    expect(deps).toEqual({ 'A-1': [], 'A-2': ['A-1', 'A-3', 'A-4'], 'A-3': ['A-1', 'A-4'], 'A-4': [], 'A-5': ['A-4'] });
  });

  test('a link to a key that is not in the file is an error at the cell where it was written', () => {
    const e = errorsOf('Issue key,Summary,Story Points,Cost of Delay,Inward issue link (Blocks)\nA-1,a,1,1,OTHER-9\n');
    expect(e).toEqual([{ code: 'unknown-dependency', row: 2, column: { index: 4, letter: 'E', header: 'Inward issue link (Blocks)' }, keys: ['OTHER-9'] }]);
  });

  test('a cycle names its keys and the row of the smallest', () => {
    const e = errorsOf('Issue key,Summary,Story Points,Cost of Delay,Depends On\nB-1,a,1,1,B-2\nB-2,b,1,1,B-3\nB-3,c,1,1,B-1\n');
    expect(e.map((x) => [x.code, x.row, x.keys])).toEqual([['dependency-cycle', 2, ['B-1', 'B-2', 'B-3']]]);
  });

  test('a row with a resolution other than Won\'t Do is skipped, counted by resolution, and not read for mistakes', () => {
    const text = 'Issue key,Summary,Story Points,Cost of Delay,Resolution\nA-1,a,1,1,\nA-2,b,abc,1,Done\nA-3,c,,,Done\nA-4,d,,,Duplicate\nA-5,e,1,1,Won\u2019t Do\n';
    const r = imported(text);
    expect(r.ok && [r.value.ticketCount, r.value.putDown, r.value.skipped]).toEqual([1, ['A-5'], { count: 3, byResolution: [{ resolution: 'Done', count: 2 }, { resolution: 'Duplicate', count: 1 }] }]);
  });

  test('a put-down row is read leniently: a wrong or missing cell takes a plain default, and nothing is reported', () => {
    const text = 'Issue key,Summary,Story Points,Value,Urgency,Risk,Cost of Delay,Must Have,Depends On,Times Postponed,Resolution\nA-1,a,1,1,1,1,,,,,\nA-9,,abc,4,x,,zz,maybe,NOPE;A-1;A-9,-3,Won\'t Do\n';
    const r = imported(text);
    expect(r.ok && r.value.putDownTickets).toEqual([{ key: 'A-9', title: 'A-9', effort: 0, cost: { kind: 'imported', cod: 0 }, mustHave: false, past: 0, dependsOn: ['A-1'] }]);
  });

  test('a put-down row needs nothing but its key', () => {
    const r = imported('Issue key,Summary,Story Points,Cost of Delay,Resolution\nA-1,a,1,1,\nA-9,,,,Won\'t Do\n');
    expect(r.ok && r.value.board.wontDo).toEqual(['A-9']);
  });

  test('a title that begins with an apostrophe and a formula character gets its apostrophe back', () => {
    expect(board(file("A-1,'=1+1,3,9", "A-2,''=x,3,9", "A-3,'plain,3,9")).tickets.map((t) => t.title)).toEqual(['=1+1', "'=x", "'plain"]);
  });

  test('the empty file, a header with no rows, and a file with only closed rows', () => {
    expect(errorsOf('').map((e) => e.code)).toEqual(['empty-file']);
    expect(errorsOf('  \n\n').map((e) => e.code)).toEqual(['empty-file']);
    expect(errorsOf(`${HEADER}\n`).map((e) => e.code)).toEqual(['no-tickets']);
    expect(errorsOf('Issue key,Summary,Story Points,Cost of Delay,Resolution\nA-1,a,1,1,Done\n').map((e) => e.code)).toEqual(['no-tickets']);
  });

  test('a summary over 1,000 characters is too long', () => {
    const e = errorsOf(file(`A-1,${'x'.repeat(1001)},3,9`));
    expect([e[0]?.code, e[0]?.limit]).toEqual(['too-long', 1000]);
  });

  test('a U+FFFD in the file is a warning, not an error', () => {
    const r = imported(file('A-1,caf\ufffd,3,9'));
    expect(r.ok && r.value.warnings).toEqual(['replacement-characters']);
  });

  test('the limits, each with its own error', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => `K-${i},t,1,1`);
    expect(importCsv(file(...rows(CSV_LIMITS.tickets)), BASE).ok).toBe(true);
    expect(errorsOf(file(...rows(CSV_LIMITS.tickets + 1)))[0]).toMatchObject({ code: 'too-many-tickets', row: null, value: String(CSV_LIMITS.tickets + 1), limit: 60 });
    expect(errorsOf(file(...Array.from({ length: CSV_LIMITS.rows }, () => '')))[0]).toMatchObject({ code: 'too-many-rows', limit: 2000 });
    expect(errorsOf(`${HEADER}${',x'.repeat(CSV_LIMITS.columns)}\nA-1,a,1,1\n`)[0]).toMatchObject({ code: 'too-many-columns', row: 1, limit: 300 });
    expect(errorsOf('x'.repeat(CSV_LIMITS.bytes + 1))[0]).toMatchObject({ code: 'file-too-large', limit: 1_048_576 });
  });

  test('at most 100 errors are returned, with the total in a last entry', () => {
    const e = errorsOf(file(...Array.from({ length: 150 }, (_, i) => `K-${i},t,abc,1`)).replace(/^/, ''));
    expect(e).toHaveLength(101);
    expect(e[100]).toMatchObject({ code: 'too-many-errors', row: null, total: 151, limit: 100 });
  });

  test('an error always names a row that exists and a column of the header, for any text', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'binary', maxLength: 200 }),
          fc.array(fc.constantFrom('Issue key', 'Summary', 'Story Points', 'Cost of Delay', 'Value', 'Depends On', 'a', '1', '-2', '2.5', 'Done', 'Won\'t Do', 'A-1', 'A-2', '"x"', '', 'yes'), { maxLength: 60 }).map((cells) => {
            const out: string[] = [];
            for (let i = 0; i < cells.length; i += 4) out.push(cells.slice(i, i + 4).join(','));
            return out.join('\n');
          }),
        ),
        (text) => {
          const r = importCsv(text, BASE);
          if (r.ok) return;
          const parsed = parseCsv(text);
          const records = parsed.ok ? parsed.value.records : [];
          const header = records[0] ?? [];
          for (const e of r.error) {
            if (e.row !== null && parsed.ok) expect(e.row, `${e.code}`).toBeLessThanOrEqual(records.length);
            if (e.row !== null) expect(e.row).toBeGreaterThanOrEqual(1);
            if (e.column !== null) expect(e.column.index).toBeLessThan(header.length);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ---- export and the round trip --------------------------------------------------------------------------------------------

function exportOf(b: Board, kept: ReadonlySet<string> | null = new Set(), home: Board = b, closed: readonly Ticket[] = []): string {
  return exportCsv({ board: valid(b), home: valid(home), closed, kept, release: 'Rel 1', nextRelease: 'Rel 2' });
}

/** The data of the tickets of a board's put-down keys, as a file that closed them would hold: hostile titles, costs, must-have, past, links to the board's tickets and to the other put-down keys. */
const arbClosedFields = fc.record({ title: arbCsvTitle, effort: fc.nat(30), cost: arbCost, mustHave: fc.boolean(), past: fc.nat(5), deps: fc.array(fc.nat(), { maxLength: 3 }) });
function closedFor(b: Board, fields: readonly { title: string; effort: number; cost: Ticket['cost']; mustHave: boolean; past: number; deps: number[] }[]): Ticket[] {
  const known = [...b.tickets.map((t) => t.key), ...b.wontDo];
  return b.wontDo.map((key, i) => {
    const f = fields[i % fields.length]!;
    const deps = [...new Set(f.deps.map((n) => known[n % known.length] as string).filter((k) => k !== key))].sort(compareKeys);
    return { key, title: f.title, effort: f.effort, cost: f.cost, mustHave: f.mustHave, past: f.past, dependsOn: deps };
  }).sort((a, b2) => compareKeys(a.key, b2.key));
}
/** Those tickets after a round trip: titles as a file holds them. */
const closedExpected = (closed: readonly Ticket[]): Ticket[] => closed.map((t) => ({ ...t, title: toWellFormed(t.title) }));

/** What a board must look like after a round trip: titles as a file holds them, the seed the import gives, the team as given. */
function expected(b: Board): unknown {
  return canonicalBoard({ ...b, fogSeed: 0, tickets: b.tickets.map((t) => ({ ...t, title: toWellFormed(t.title) })) });
}

describe('the export (Requirement 4)', () => {
  const a = { ...ticket('A-1', 5, 0, { title: 'First' }), cost: { kind: 'formula', value: 8, urgency: 5, risk: 3 } as const, mustHave: true, past: 2 };
  const b = { ...ticket('A-2', 3, 14, { title: 'Second', dependsOn: ['A-1', 'W-1'] }) };
  const home = makeBoard([a, b, ticket('W-1', 2, 1, { title: 'Closed one' })]);
  const current = makeBoard([a, b], { wontDo: ['W-1'] });

  test('the columns, in order, one row per ticket, then the tickets put down', () => {
    const lines = exportOf(current, new Set(['A-1']), home).split('\r\n');
    expect(lines).toEqual([
      'Issue key,Summary,Story Points,Value,Urgency,Risk,Cost of Delay,Must Have,Depends On,Times Postponed,Fix Version/s,Resolution',
      'A-1,First,5,8,5,3,,yes,,2,Rel 1,',
      'A-2,Second,3,,,,14,no,"A-1;W-1",0,Rel 2,',
      "W-1,Closed one,2,,,,1,no,,0,,Won't Do",
      '',
    ]);
  });

  test('Fix Version/s is empty for every row when the freeze is impossible, and a put-down row without a title uses its key', () => {
    const csv = exportOf(current, null);
    expect(csv.split('\r\n').slice(1, 3).map((l) => l.split(',')[10])).toEqual(['', '']);
    expect(exportOf(current, null, makeBoard([a, b], { wontDo: ['W-1'] })).split('\r\n')[3]).toBe("W-1,W-1,,,,,,,,,,Won't Do");
  });

  test('a put-down ticket is written with everything the app has for it, from the board or from the file: title, points, cost, links, past', () => {
    const fromFile = { ...ticket('F-1', 2, 0, { title: 'Dropped idea', dependsOn: ['A-1'], past: 3 }), cost: { kind: 'formula', value: 3, urgency: 2, risk: 5 } as const, mustHave: true };
    const withData = exportOf(makeBoard([a], { wontDo: ['F-1'] }), null, makeBoard([a], { wontDo: ['F-1'] }), [fromFile]);
    expect(withData.split('\r\n')[2]).toBe("F-1,Dropped idea,2,3,2,5,,yes,A-1,3,,Won't Do");
  });

  test('no byte order mark, a comma, CRLF', () => {
    const csv = exportOf(current);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.includes('\r\n')).toBe(true);
    expect(csv.replace(/\r\n/g, '').includes('\n')).toBe(false);
  });

  test('a text that a spreadsheet would run as a formula gets one apostrophe, and the importer takes it back', () => {
    expect([guardCell('=1'), guardCell('+1'), guardCell('-1'), guardCell('@x'), guardCell('\tx'), guardCell('\rx'), guardCell("'=x"), guardCell('plain'), guardCell("'plain")]).toEqual([
      "'=1", "'+1", "'-1", "'@x", "'\tx", "'\rx", "''=x", 'plain', "'plain",
    ]);
    fc.assert(fc.property(fc.oneof(fc.string(), fc.stringMatching(/^'{0,3}[=+\-@\t\r]?[a-z']{0,5}$/)), (s) => unguardCell(guardCell(s)) === s), { numRuns: 500 });
    expect(exportOf(makeBoard([ticket('A-1', 1, 1, { title: '=HYPERLINK("x")' })])).split('\r\n')[1]).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
  });

  test('the hunger is not exported: the file holds the ticket\'s own urgency', () => {
    const hungry = { ...ticket('H-1', 1, 0, { past: 3 }), cost: { kind: 'formula', value: 1, urgency: 1, risk: 1 } as const };
    expect(exportOf(makeBoard([hungry])).split('\r\n')[1]).toBe('H-1,H-1,1,1,1,1,,no,,3,Rel 2,');
  });
});

describe('the round trip', () => {
  const baseOf = (b: Board): ImportBase => ({ people: b.people, timeZone: b.timeZone, nextReleaseWeeks: b.nextReleaseWeeks, zombieThreshold: b.zombieThreshold });

  test('P13 export then import gives the same tickets, costs, must-haves, dependencies, past and put-down tickets with all their data', () => {
    fc.assert(
      fc.property(arbCsvBoard(), fc.array(arbClosedFields, { minLength: 3, maxLength: 3 }), (generated, fields) => {
        const b = valid(generated);
        const closed = closedFor(b, fields);
        const r = importCsv(exportOf(b, new Set(b.tickets.slice(0, 3).map((t) => t.key)), b, closed), baseOf(b));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(canonicalBoard(r.value.board)).toEqual(expected(b));
        expect(r.value.putDown).toEqual([...b.wontDo].sort(compareKeys));
        expect(r.value.putDownTickets).toEqual(closedExpected(closed));
      }),
      { numRuns: 120 },
    );
  });

  test('P26 the same with hostile titles, a comma file and a semicolon file', () => {
    fc.assert(
      fc.property(arbCsvBoard(12), fc.array(arbClosedFields, { minLength: 3, maxLength: 3 }), (generated, fields) => {
        const b = valid(generated);
        const closed = closedFor(b, fields);
        const comma = exportOf(b, new Set(), b, closed);
        const records = recordsOf(comma);
        for (const text of [comma, serializeCsv(records, ';'), `sep=;\r\n${serializeCsv(records, ';')}`, `\ufeff${comma}`]) {
          const r = importCsv(text, baseOf(b));
          expect(r.ok).toBe(true);
          if (!r.ok) continue;
          expect(canonicalBoard(r.value.board)).toEqual(expected(b));
          expect(r.value.putDownTickets).toEqual(closedExpected(closed));
        }
      }),
      { numRuns: 120 },
    );
  });

  test('the sample-like board survives with its exhume exported as a must-have', () => {
    const home = makeBoard([ticket('A-1', 5, 3), ticket('A-2', 2, 1, { dependsOn: ['A-1'] })]);
    const current = { ...home, tickets: home.tickets.map((t) => (t.key === 'A-2' ? { ...t, mustHave: true } : t)) };
    const r = importCsv(exportOf(current, new Set(), home), baseOf(home));
    expect(r.ok && r.value.board.tickets.map((t) => [t.key, t.mustHave])).toEqual([['A-1', false], ['A-2', true]]);
  });

  test('row order does not change the solution', () => {
    fc.assert(
      fc.property(arbCsvBoard(14), fc.nat(), (generated, seed) => {
        const b = valid(generated);
        const records = recordsOf(exportOf(b));
        const [header, ...rows] = records as [string[], ...string[][]];
        const shuffled = fc.sample(fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }), { numRuns: 1, seed })[0] as string[][];
        const a = importCsv(serializeCsv([header, ...rows], ','), baseOf(b));
        const c = importCsv(serializeCsv([header, ...shuffled], ','), baseOf(b));
        expect(a.ok && c.ok).toBe(true);
        if (!a.ok || !c.ok) return;
        const total = b.tickets.reduce((s, t) => s + t.effort, 0);
        for (const capacity of [Math.floor(total * 0.3), Math.floor(total * 0.6)]) {
          const x = solveWithCapacity(a.value.board, capacity, 0);
          const y = solveWithCapacity(c.value.board, capacity, 0);
          expect(y).toEqual(x);
        }
      }),
      { numRuns: 80 },
    );
  });
});
