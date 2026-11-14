import { checkNumbers, guardFacts } from './guard';
import type { GuardResult, Span } from './guard';
import type { NightFacts, OutsideFact, OutsideReason, PushedOut, SolvedNight } from './facts';
import type { Key } from './types';

/**
 * The death certificate: a note for stakeholders on what the night leaves outside and why. A fixed English template filled with facts
 * (`facts.ts`). No model, no clock, no randomness. The template has no digit and no number word: every number in the note comes from the facts.
 *
 * The note is first a small model (`Note`); the Markdown and the screen are both made from it, so they cannot say different things.
 */

// ---- the model -------------------------------------------------------------------------------------------------------------

/** Text from the board (a title, a name, the release, the zone). Escaped in Markdown, put on the screen as text, and ignored by the guard. */
export interface Data {
  readonly data: string;
}
/** A ticket key. Escaped like any text, but checked by the guard as a key. */
export interface KeyRef {
  readonly key: string;
}
export type Text = readonly (string | Data | KeyRef)[];

export type Block =
  | { readonly kind: 'title' | 'heading' | 'paragraph'; readonly text: Text }
  | { readonly kind: 'list'; readonly items: readonly Text[] }
  | {
      readonly kind: 'table';
      /** What the table is, for a screen reader. */
      readonly label: string;
      readonly head: readonly Text[];
      readonly align: readonly ('left' | 'right')[];
      readonly rows: readonly (readonly Text[])[];
    };

export interface Note {
  readonly blocks: readonly Block[];
}

/** The text of a piece, as the screen shows it. */
export function plainText(text: Text): string {
  return text.map((p) => (typeof p === 'string' ? p : 'data' in p ? p.data : p.key)).join('');
}

// ---- escaping --------------------------------------------------------------------------------------------------------------

const PUNCTUATION = /[\\`*_~[\]<>|&#$]/g;

/** Backslash before every character that Markdown could read as structure. */
function escapePunctuation(text: string): string {
  return text.replace(PUNCTUATION, '\\$&');
}

/**
 * Turns any string into text that CommonMark and GitHub-flavoured Markdown show literally, on one line: control characters and line breaks become
 * a space, bidirectional overrides are removed, runs of white space collapse, the ends are trimmed, and `\ ` * _ ~ [ ] < > | & # $` get a backslash.
 */
export function escapeMarkdown(text: string): string {
  const cleaned = text
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return escapePunctuation(cleaned);
}

// ---- small helpers ---------------------------------------------------------------------------------------------------------

const count = (n: number, one: string, many: string = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function thousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const k = (key: Key): KeyRef => ({ key });
const d = (text: string): Data => ({ data: text });

/** "A", "A and B", "A, B and C" (or "or"), as pieces. */
function keyList(keys: readonly Key[], joiner: 'and' | 'or'): Text {
  const out: (string | KeyRef)[] = [];
  keys.forEach((key, i) => {
    if (i > 0) out.push(i === keys.length - 1 ? ` ${joiner} ` : ', ');
    out.push(k(key));
  });
  return out;
}

function stamp(s: { readonly weekday: string; readonly date: string; readonly time: string }): string {
  return `${s.weekday} ${s.date} ${s.time}`;
}

/** The wording of `formulaText` in the UI: "value 5 + urgency 2 → 8 + risk 3 = 16", or "imported cost of delay 14". A test keeps the two equal. */
function formula(o: OutsideFact): string {
  const c = o.costParts;
  if (c.imported) return `imported cost of delay ${c.cod}`;
  const urgency = c.effectiveUrgency === c.urgency ? `${c.urgency}` : `${c.urgency} \u2192 ${c.effectiveUrgency}`;
  return `value ${c.value} + urgency ${urgency} + risk ${c.risk} = ${c.cod}`;
}

function reasonText(r: OutsideReason): Text {
  switch (r.kind) {
    case 'no-room':
      return [`Does not fit: needs ${count(r.needed, 'point')}, ${r.left} left.`];
    case 'depends-on-buried':
      return ['Follows ', ...keyList(r.buriedDependencies, 'and'), `, which ${r.buriedDependencies.length === 1 ? 'is' : 'are'} left outside.`];
    case 'blocked-by-put-down':
      return ['Cannot ship: depends on ', k(r.putDownKey), ", which was put down (Won't Do)."];
    case 'pushed-out-by-exhume': {
      const tail = `: needs ${count(r.needed, 'point')}, ${r.left} left.`;
      if (r.together) return ['Pushed out by the exhumed ', ...keyList(r.exhumed, 'and'), ` together (none of them is enough alone)${tail}`];
      if (r.exhumed.length === 1) return ['Pushed out by the exhumed ', k(r.exhumed[0] as Key), tail];
      return ['Pushed out by the exhumed ', ...keyList(r.exhumed, 'or'), ` (any of them is enough alone)${tail}`];
    }
  }
}

function pushedOutText(p: PushedOut): Text {
  const base = `(${p.cod}`;
  if (!p.together) return [k(p.key), ` ${base})`];
  return [k(p.key), ` ${base}, together with `, ...keyList(p.with, 'and'), ')'];
}

// ---- the note --------------------------------------------------------------------------------------------------------------

function header(facts: NightFacts): Block[] {
  const blocks: Block[] = [{ kind: 'title', text: ['Death certificate'] }];
  if (facts.release !== null) blocks.push({ kind: 'paragraph', text: ['Release: ', d(facts.release)] });
  blocks.push({ kind: 'paragraph', text: [`Freeze: ${stamp(facts.freeze)} (`, d(facts.zone), ')'] });
  blocks.push({ kind: 'paragraph', text: [`As of: ${stamp(facts.asOf)}, the start time of the board`] });
  return blocks;
}

function impossibleNote(facts: Extract<NightFacts, { status: 'impossible' }>): Note {
  const blocks = header(facts);
  blocks.push({ kind: 'heading', text: ['The freeze is impossible'] });
  blocks.push({
    kind: 'paragraph',
    text: [`The must-haves need ${count(facts.needed, 'point')}; there are ${facts.capacity} (${facts.effectiveCapacity} after the ${facts.reservePct} % reserve).`],
  });
  if (facts.blockedMustHaves.length > 0) {
    blocks.push({
      kind: 'list',
      items: facts.blockedMustHaves.map((b): Text => [k(b.key), ' can never ship: it depends on ', k(b.putDownKey), ", which was put down (Won't Do)."]),
    });
  }
  blocks.push({ kind: 'paragraph', text: ['Nothing can be decided until the must-haves fit.'] });
  return { blocks };
}

function zombieLine(o: OutsideFact): Text {
  const left = `left out ${count(o.costParts.past, 'release')}`;
  const c = o.costParts;
  let tail: string;
  if (c.imported || o.nextUrgency === null) tail = 'imported cost of delay, so no hunger';
  else if (o.nextUrgency === c.effectiveUrgency) tail = `urgency ${c.effectiveUrgency}, already at the top`;
  else tail = `urgency ${c.effectiveUrgency} now, ${o.nextUrgency} if left out again`;
  return [k(o.key), ', ', d(o.title), `: ${left}; ${tail}.`];
}

function solvedNote(facts: SolvedNight): Note {
  const blocks = header(facts);

  blocks.push({ kind: 'heading', text: ['The cut'] });
  blocks.push({
    kind: 'paragraph',
    text: [`The team has ${count(facts.capacity, 'point')} before the freeze. With a ${facts.reservePct} % reserve, ${count(facts.effectiveCapacity, 'point')} ${facts.effectiveCapacity === 1 ? 'is' : 'are'} available.`],
  });
  blocks.push({
    kind: 'list',
    items: [
      [`Kept inside: ${count(facts.kept.count, 'ticket')}, ${count(facts.kept.effort, 'point')}, saved cost of delay ${facts.kept.cod}.`],
      [`Left outside: ${count(facts.outsideTotals.count, 'ticket')}, ${count(facts.outsideTotals.effort, 'point')}, cost of delay ${facts.outsideTotals.cod}.`],
      [`Waiting for the next release costs ${facts.outsideTotals.waitingCost} for all of them (cost of delay \u00d7 ${count(facts.weeks, 'week')}).`],
    ],
  });

  blocks.push({ kind: 'heading', text: ['Will it hold?'] });
  blocks.push({
    kind: 'paragraph',
    text: [
      `Estimates are simulated between ${facts.fog.minPct} % and ${facts.fog.maxPct} % of their value on ${thousands(facts.fog.nights)} nights, measured against all ${count(facts.fog.capacity, 'point')} of the team.`,
    ],
  });
  blocks.push({ kind: 'paragraph', text: [`The cut holds on ${thousands(facts.fog.holds)} of ${thousands(facts.fog.nights)} nights (${facts.fog.pct} %).`] });

  blocks.push({ kind: 'heading', text: ['Left outside'] });
  if (facts.outside.length === 0) blocks.push({ kind: 'paragraph', text: ['None.'] });
  else {
    blocks.push({
      kind: 'table',
      label: 'Left outside',
      head: [['Key'], ['Title'], ['Points'], ['Cost of delay'], [`Waiting cost (\u00d7 ${count(facts.weeks, 'week')})`], ['Reason']],
      align: ['left', 'left', 'right', 'left', 'right', 'left'],
      rows: facts.outside.map((o): Text[] => [[k(o.key)], [d(o.title)], [String(o.effort)], [formula(o)], [String(o.waitingCost)], reasonText(o.reason)]),
    });
  }

  const zombies = facts.outside.filter((o) => o.isZombie);
  blocks.push({ kind: 'heading', text: ['Zombies'] });
  if (zombies.length === 0) blocks.push({ kind: 'paragraph', text: ['None.'] });
  else {
    blocks.push({
      kind: 'paragraph',
      text: [`A ticket is a zombie when leaving it out again makes ${count(facts.zombieThreshold, 'release')} in a row. Its urgency climbs a step on the scale for each release it is left out.`],
    });
    blocks.push({ kind: 'list', items: zombies.map((o) => zombieLine(o)) });
  }

  blocks.push({ kind: 'heading', text: ["Put down (Won't Do)"] });
  if (facts.putDown.length === 0) blocks.push({ kind: 'paragraph', text: ['None.'] });
  else {
    blocks.push({
      kind: 'list',
      items: facts.putDown.map((p): Text => {
        const who: Text = p.title === null ? [k(p.key), ": closed as Won't Do. "] : [k(p.key), ', ', d(p.title), ": closed as Won't Do. "];
        const blocks_: Text = p.blocks.length === 0 ? ['Blocks nothing.'] : ['Blocks ', ...keyList(p.blocks, 'and'), '.'];
        return [...who, ...blocks_];
      }),
    });
  }

  blocks.push({ kind: 'heading', text: ['People away'] });
  if (facts.away.length === 0) blocks.push({ kind: 'paragraph', text: ['None.'] });
  else blocks.push({ kind: 'list', items: facts.away.map((name): Text => [d(name)]) });

  blocks.push({ kind: 'heading', text: ['Exhumed by decision'] });
  if (facts.exhumed.length === 0) blocks.push({ kind: 'paragraph', text: ['None.'] });
  else {
    blocks.push({
      kind: 'list',
      items: facts.exhumed.map((e): Text => {
        const lead: Text = [k(e.key), ', ', d(e.title), `: ${count(e.effort, 'point')}, cost of delay ${e.cod}. `];
        if (e.pushedOut.length === 0) return [...lead, 'Pushed out nothing.'];
        const items: (string | Data | KeyRef)[] = [];
        e.pushedOut.forEach((p, i) => {
          if (i > 0) items.push(', ');
          items.push(...pushedOutText(p));
        });
        return [...lead, 'Pushed out: ', ...items, '.'];
      }),
    });
  }
  return { blocks };
}

/** The note as a model, for the screen and for `renderCertificate`. */
export function certificateNote(facts: NightFacts): Note {
  return facts.status === 'impossible' ? impossibleNote(facts) : solvedNote(facts);
}

// ---- Markdown --------------------------------------------------------------------------------------------------------------

export interface RenderedCertificate {
  readonly markdown: string;
  /** `[start, end)` offsets in `markdown` of the data text (titles, names, release, zone): what the guard must not read. */
  readonly data: readonly Span[];
}

/** The Markdown of a note and the places of its data text. Lines end with `\n`, there is one blank line between blocks and one final newline. */
export function renderNote(note: Note): RenderedCertificate {
  let md = '';
  const data: Span[] = [];

  const write = (text: Text): void => {
    for (const piece of text) {
      if (typeof piece === 'string') md += escapePunctuation(piece);
      else if ('data' in piece) {
        const start = md.length;
        md += escapeMarkdown(piece.data);
        data.push([start, md.length]);
      } else md += escapeMarkdown(piece.key);
    }
  };

  for (const block of note.blocks) {
    if (md !== '') md += '\n';
    switch (block.kind) {
      case 'title':
        md += '# ';
        write(block.text);
        md += '\n';
        break;
      case 'heading':
        md += '## ';
        write(block.text);
        md += '\n';
        break;
      case 'paragraph':
        write(block.text);
        md += '\n';
        break;
      case 'list':
        for (const item of block.items) {
          md += '- ';
          write(item);
          md += '\n';
        }
        break;
      case 'table': {
        const row = (cells: readonly Text[]): void => {
          md += '|';
          for (const cell of cells) {
            md += ' ';
            write(cell);
            md += ' |';
          }
          md += '\n';
        };
        row(block.head);
        md += `|${block.align.map((a) => (a === 'right' ? '---:' : '---')).join('|')}|\n`;
        for (const r of block.rows) row(r);
        break;
      }
    }
  }
  return { markdown: md, data };
}

export function renderCertificate(facts: NightFacts): RenderedCertificate {
  return renderNote(certificateNote(facts));
}

/** The certificate as Markdown. The same facts give the same string. */
export function deathCertificate(facts: NightFacts): string {
  return renderCertificate(facts).markdown;
}

/** The guard's verdict on the certificate of these facts: every number, time, date, weekday and key must be one of the facts. */
export function guardCertificate(facts: NightFacts): GuardResult {
  const { markdown, data } = renderCertificate(facts);
  const keys = [...facts.keys, ...facts.keys.map(escapeMarkdown)];
  return checkNumbers(markdown, guardFacts([facts], { keys }), { ignore: data });
}
