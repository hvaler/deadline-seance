import * as fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { certificateNote, deathCertificate, escapeMarkdown, guardCertificate, plainText, renderCertificate } from '../../src/engine/certificate';
import { nightFacts } from '../../src/engine/facts';
import type { NightFacts, NightInput } from '../../src/engine/facts';
import { checkNumbers, extractTokens, guardFacts } from '../../src/engine/guard';
import type { Board, Ticket } from '../../src/engine/types';
import { ONE_SLOT_FROM, ONE_SLOT_TO, atCapacity, makeBoard, ticket, valid } from './fixtures';
import { arbNight, arbPermutedBoard, arbTitle } from './generators';
import { splitRow, unescape, unescapedAt } from './markdown-helpers';

// The certificate: its sections, its order, its safety for any title, and the guard over it (P24).

function factsOf(input: NightInput): NightFacts {
  const r = nightFacts(input);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

function night(tickets: Ticket[], capacity: number, exhumed: string[] = [], over: Partial<Board> = {}, release: string | null = 'Test release 3.2'): NightInput {
  const base = atCapacity(makeBoard(tickets.map((t) => ({ ...t, mustHave: false })), over), capacity);
  const board = valid({ ...base.board, tickets: base.board.tickets.map((t) => (exhumed.includes(t.key) ? { ...t, mustHave: true } : t)) });
  return { home: base.board, board, freeze: base.freeze, away: [], release };
}

/** Every section filled: a zombie, a put-down that blocks a ticket, someone away, two exhumes that push a ticket out together. */
function richNight(): NightInput {
  const w = ticket('W', 2, 5, { title: 'Closed one' });
  const home = valid(
    makeBoard(
      [
        w,
        ticket('T', 4, 10, { title: 'The ticket' }),
        ticket('E1', 4, 1, { title: 'First exhume' }),
        ticket('E2', 4, 1, { title: 'Second exhume' }),
        ticket('X', 1, 5, { dependsOn: ['W'], title: 'Needs the closed one' }),
        ticket('Zo', 20, 3, { past: 2, title: 'A zombie' }),
        { ...ticket('Fo', 9, 4, { title: 'Formula one' }), cost: { kind: 'formula', value: 3, urgency: 2, risk: 1 } },
      ],
      { people: [{ name: 'Solo', pointsPerHalfDay: 10, daysOff: [] }, { name: 'Ana', pointsPerHalfDay: 4, daysOff: [] }] },
    ),
  );
  const board = valid({
    ...home,
    tickets: home.tickets.filter((t) => t.key !== 'W').map((t) => (t.key === 'E1' || t.key === 'E2' ? { ...t, mustHave: true } : t)),
    wontDo: ['W'],
  });
  return { home, board, freeze: { now: ONE_SLOT_FROM, freezeAt: ONE_SLOT_TO, marginPct: 0 }, away: ['Ana'], release: 'Rich release' };
}

const lines = (md: string): string[] => md.split('\n');
const headings = (md: string): string[] => lines(md).filter((l) => l.startsWith('## ')).map((l) => l.slice(3));

describe('the sections', () => {
  const facts = factsOf(richNight());
  const md = deathCertificate(facts);

  test('are always the same, in this order', () => {
    expect(lines(md)[0]).toBe('# Death certificate');
    expect(headings(md)).toEqual(['The cut', 'Will it hold?', 'Left outside', 'Zombies', "Put down (Won't Do)", 'People away', 'Exhumed by decision']);
  });

  test('the header says the release, the freeze and the board\'s own "as of"', () => {
    expect(md).toContain('Release: Rich release\n');
    expect(md).toContain('Freeze: Mon 2026-10-19 12:00 (Europe/Madrid)\n');
    expect(md).toContain("As of: Mon 2026-10-19 09:00, the start time of the board\n");
  });

  test('a note with a null release has no release line', () => {
    expect(deathCertificate(factsOf(night([ticket('A', 1, 1)], 5, [], {}, null)))).not.toContain('Release:');
  });

  test('every section of the rich night has its content', () => {
    expect(md).toContain('- Kept inside: ');
    expect(md).toContain('A ticket is a zombie when leaving it out again makes 3 releases in a row.');
    expect(md).toContain("- W, Closed one: closed as Won't Do. Blocks X.");
    expect(md).toContain('- Ana\n');
    expect(md).toMatch(/- E1, First exhume: 4 points, cost of delay 1\. Pushed out: T \(10, together with E2\)\./);
  });

  test('the reasons read as the design says, and a joint push-out never claims a single exhume', () => {
    const rows = lines(md).filter((l) => /^\| (T|X|Zo|Fo) /.test(l)).map((l) => splitRow(l));
    const reason = (key: string): string => (rows.find((r) => r[0] === key) as string[])[5] as string;
    expect(reason('T')).toBe('Pushed out by the exhumed E1 and E2 together (none of them is enough alone): needs 4 points, 2 left.');
    expect(reason('X')).toBe("Cannot ship: depends on W, which was put down (Won't Do).");
    expect(reason('Zo')).toBe('Does not fit: needs 20 points, 2 left.');
    expect(reason('T')).not.toMatch(/Pushed out by the exhumed E1:|Pushed out by the exhumed E2:/);
  });

  test('every other section says "None." when it is empty', () => {
    const plain = deathCertificate(factsOf(night([ticket('A', 1, 1)], 5)));
    expect(plain.match(/^None\.$/gm)?.length).toBe(5);
    expect(plain).toContain('## Left outside\n\nNone.\n');
  });

  test('a ticket that follows a buried dependency says which', () => {
    const f = factsOf(night([ticket('A', 3, 10), ticket('B', 5, 1), ticket('C', 1, 9, { dependsOn: ['B'] })], 4));
    expect(deathCertificate(f)).toContain('Follows B, which is left outside.');
  });

  test('the cost-of-delay cell shows the formula, with the hunger, or says it is imported', () => {
    expect(md).toContain('value 3 + urgency 2 + risk 1 = 6');
    expect(md).toContain('imported cost of delay 3');
  });

  test('a zombie line says its urgency now and after one more release, or that it is imported', () => {
    const f = factsOf(night([{ ...ticket('Hz', 9, 1, { past: 3 }), cost: { kind: 'formula', value: 1, urgency: 8, risk: 1 } }, ticket('Im', 9, 1, { past: 3 })], 1));
    const text = deathCertificate(f);
    expect(text).toContain('- Hz, Hz: left out 3 releases; urgency 20 now, 20 if left out again.'.replace('20 now, 20 if left out again', '20, already at the top'));
    expect(text).toContain('- Im, Im: left out 3 releases; imported cost of delay, so no hunger.');
  });

  test('the table is a model first: its rows are the outside list, in order', () => {
    const note = certificateNote(facts);
    const table = note.blocks.find((b) => b.kind === 'table');
    expect(table && table.kind === 'table' && table.rows.map((r) => plainText(r[0] as never))).toEqual(facts.status === 'ok' ? facts.outside.map((o) => o.key) : []);
  });
});

describe('the impossible night', () => {
  test('is short and true: the numbers and what blocks it, with no table', () => {
    const f = factsOf(night([ticket('M', 9, 1, { mustHave: true })], 5, ['M']));
    const md = deathCertificate(f);
    expect(md).toContain('## The freeze is impossible');
    expect(md).toContain('The must-haves need 9 points; there are 5 (5 after the 0 % reserve).');
    expect(md).toContain('Nothing can be decided until the must-haves fit.');
    expect(md).not.toContain('| Key |');
    expect(guardCertificate(f)).toEqual({ ok: true, offending: [] });
  });

  test('names a must-have that a put-down blocks', () => {
    const board = valid(makeBoard([ticket('M', 1, 1, { mustHave: true, dependsOn: ['W'] })], { wontDo: ['W'], people: [{ name: 'Solo', pointsPerHalfDay: 9, daysOff: [] }] }));
    const f = factsOf({ home: board, board, freeze: { now: ONE_SLOT_FROM, freezeAt: ONE_SLOT_TO, marginPct: 0 }, away: [], release: null });
    expect(deathCertificate(f)).toContain("- M can never ship: it depends on W, which was put down (Won't Do).");
  });
});

describe('an empty board', () => {
  const f = factsOf(night([], 5, [], {}, null));
  const md = deathCertificate(f);

  test('has a note with nothing outside and a chance of 100 %', () => {
    expect(md).toContain('- Kept inside: 0 tickets, 0 points, saved cost of delay 0.');
    expect(md).toContain('The cut holds on 1,000 of 1,000 nights (100 %).');
  });

  test('the template has no digit and no number word of its own: the guard passes it, and a digit hidden in the template would not', () => {
    expect(guardCertificate(f)).toEqual({ ok: true, offending: [] });
    expect(extractTokens(md).filter((t) => t.kind === 'word')).toEqual([]);
    // Every number that is there is one of the facts; if the template carried a "777" it would be offending, because 777 is not a fact of this night.
    const g = guardFacts([f], { keys: [...f.keys] });
    expect(g.numbers.has(777)).toBe(false);
    expect(checkNumbers(`${md}777`, g).offending.map((o) => o.text)).toEqual(['777']);
  });
});

describe('Markdown safety (Requirement 3)', () => {
  /** A night with one ticket that cannot fit, so it is a row of the table, with this title. */
  function rowOf(title: string): { md: string; row: string; cells: string[] } {
    const f = factsOf(night([ticket('A-1', 5, 3, { title })], 1));
    const md = deathCertificate(f);
    const at = lines(md).findIndex((l) => l.startsWith('| A-1 '));
    return { md, row: lines(md)[at] as string, cells: splitRow(lines(md)[at] as string) };
  }

  test('the escape turns the awkward titles into literal text', () => {
    expect(escapeMarkdown('a|b')).toBe('a\\|b');
    expect(escapeMarkdown('<script>x</script>')).toBe('\\<script\\>x\\</script\\>');
    expect(escapeMarkdown('`c` *b* _i_ ~s~ [l] #h $m &#49;')).toBe('\\`c\\` \\*b\\* \\_i\\_ \\~s\\~ \\[l\\] \\#h \\$m \\&\\#49;');
    expect(escapeMarkdown('two\nlines\r\nand\ttab')).toBe('two lines and tab');
    expect(escapeMarkdown('  a   b  ')).toBe('a b');
    expect(escapeMarkdown('x\\')).toBe('x\\\\');
    expect(escapeMarkdown('\u202eevil\u2066')).toBe('evil');
  });

  test('a table row has exactly the expected number of cells for any title', () => {
    fc.assert(
      fc.property(arbTitle, (title) => {
        const { cells, row } = rowOf(title);
        expect(row.includes('\n')).toBe(false);
        expect(cells).toHaveLength(6);
        expect(cells[0]).toBe('A-1');
        expect(cells[2]).toBe('5');
      }),
      { numRuns: 400 },
    );
  });

  test('the title in its cell is the title, unescaped, on one line', () => {
    fc.assert(
      fc.property(arbTitle, (title) => {
        const { cells } = rowOf(title);
        const expected = title.replace(/[\u202A-\u202E\u2066-\u2069]/g, '').replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
        expect(unescape(cells[1] as string)).toBe(expected);
      }),
      { numRuns: 400 },
    );
  });

  test('no raw HTML reaches the Markdown: every "<" and "&" is escaped, whatever the title', () => {
    fc.assert(
      fc.property(arbTitle, (title) => {
        const { md } = rowOf(title);
        expect(unescapedAt(md, '<')).toEqual([]);
        expect(unescapedAt(md, '&')).toEqual([]);
        expect(md).not.toMatch(/(^|[^\\])<[A-Za-z!/?]/);
      }),
      { numRuns: 400 },
    );
  });

  test('a title cannot start a heading, a list or a quote in the lines around the table', () => {
    const { md } = rowOf('# not a heading\n- not a list\n> not a quote');
    expect(headings(md)).toEqual(['The cut', 'Will it hold?', 'Left outside', 'Zombies', "Put down (Won't Do)", 'People away', 'Exhumed by decision']);
    expect(lines(md).filter((l) => l.startsWith('>'))).toEqual([]);
  });

  test('a release, a name, a zone-like text and a put-down title are escaped too', () => {
    const base = night([ticket('A', 1, 1)], 5, [], {}, '<b>R</b>|x');
    const board = valid({ ...base.board, people: [...base.board.people, { name: 'A|n*a', pointsPerHalfDay: 1, daysOff: [] }] });
    const md = deathCertificate(factsOf({ ...base, home: board, board, away: ['A|n*a'] }));
    expect(md).toContain('Release: \\<b\\>R\\</b\\>\\|x\n');
    expect(md).toContain('- A\\|n\\*a\n');
  });
});

describe('the data text is reported by position', () => {
  test('the spans cover exactly the escaped titles, names and release', () => {
    const f = factsOf(richNight());
    const { markdown, data } = renderCertificate(f);
    const covered = data.map(([s, e]) => markdown.slice(s, e));
    expect(covered).toContain('Rich release');
    expect(covered).toContain('Europe/Madrid');
    expect(covered).toContain('The ticket');
    expect(covered).toContain('Ana');
    expect(covered).toContain('Closed one');
    expect(covered.some((c) => c.startsWith('E'))).toBe(true);
    for (const [s, e] of data) expect(s).toBeLessThan(e);
  });

  test('a title that is a number does not hide a wrong number outside it', () => {
    const f = factsOf(night([ticket('A-1', 5, 3, { title: '777' })], 1));
    const { markdown, data } = renderCertificate(f);
    expect(guardCertificate(f).ok).toBe(true);
    const wrong = markdown.replace('Kept inside: 0 tickets', 'Kept inside: 777 tickets');
    const g = guardFacts([f], { keys: f.keys });
    expect(checkNumbers(wrong, g, { ignore: data }).offending.map((o) => o.text)).toEqual(['777']);
  });
});

describe('the guard bites on a real certificate (Requirement 5.4)', () => {
  const f = factsOf(richNight());
  const { markdown, data } = renderCertificate(f);
  const g = guardFacts([f], { keys: [...f.keys, ...f.keys.map(escapeMarkdown)] });
  const check = (text: string): string[] => checkNumbers(text, g, { ignore: data }).offending.map((o) => `${o.reason}:${o.text}`);

  test('the real certificate passes', () => {
    expect(check(markdown)).toEqual([]);
  });

  test('one changed digit', () => {
    const wrong = markdown.replace(/(saved cost of delay )\d+/, '$1778');
    expect(wrong).not.toBe(markdown);
    expect(check(wrong)).toEqual(['not-in-facts:778']);
  });

  test('an invented percentage', () => {
    expect(g.numbers.has(47)).toBe(false);
    expect(check(markdown.replace(/nights \(\d+ %\)/, 'nights (47 %)'))).toEqual(['not-in-facts:47 %']);
  });

  test('a wrong key', () => {
    expect(check(markdown.replace('| T |', '| T-7 |'))).toEqual(['unknown-key:T-7']);
    expect(check(markdown.replace('depends on W,', 'depends on HB-190,'))).toEqual(['unknown-key:HB-190']);
  });

  test('a wrong date, time and weekday', () => {
    expect(check(markdown.replace('Mon 2026-10-19 12:00', 'Tue 2026-10-20 13:00'))).toEqual([
      'unknown-weekday:Tue',
      'unknown-date:2026-10-20',
      'unknown-time:13:00',
    ]);
  });
});

describe('P24 and the rest of the contract', () => {
  test('P24 every number in the certificate is in the computed facts: the guard returns no offending token', () => {
    fc.assert(
      fc.property(arbNight, (n) => {
        const r = nightFacts(n);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const verdict = guardCertificate(r.value);
        expect(verdict.offending.map((o) => `${o.reason}:${o.text}@${o.at}`)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  test('the same facts give the same Markdown byte for byte, ending with one newline', () => {
    fc.assert(
      fc.property(arbNight, (n) => {
        const f = factsOf(n);
        const md = deathCertificate(f);
        expect(deathCertificate(f)).toBe(md);
        expect(md.endsWith('\n')).toBe(true);
        expect(md.endsWith('\n\n')).toBe(false);
        expect(md.includes('\r')).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  test('the note does not depend on the order of tickets, people or absences', () => {
    fc.assert(
      fc.property(arbNight, fc.nat(), (n, seed) => {
        const permuted = valid(fc.sample(arbPermutedBoard(n.board), { numRuns: 1, seed })[0] as Board);
        expect(deathCertificate(factsOf({ ...n, board: permuted }))).toBe(deathCertificate(factsOf(n)));
      }),
      { numRuns: 60 },
    );
  });

  test('no sentence promises that a bigger reserve is safer, or decides for the user', () => {
    const promise =
      /\b(safe|safer|safest|risky|good|bad|better|best|worse|worst|recommend\w*|guarantee\w*|always|never|raises?|improves?|increases?|boosts?|highest|lowest|ideal|optimal|sweet spot|(more|bigger|larger|higher) (reserve|margin|buffer))\b/i;
    const decides = /\b(you (must|should|need to)|the best|do this|should)\b/i;
    for (const input of [richNight(), night([ticket('A', 1, 1)], 5), night([ticket('M', 9, 1, { mustHave: true })], 5, ['M'])]) {
      const md = deathCertificate(factsOf(input));
      expect(md).not.toMatch(promise);
      expect(md).not.toMatch(decides);
    }
  });

  test('the facts are not changed by making the note', () => {
    const f = factsOf(richNight());
    const copy = JSON.stringify(f);
    deathCertificate(f);
    guardCertificate(f);
    expect(JSON.stringify(f)).toBe(copy);
  });
});
