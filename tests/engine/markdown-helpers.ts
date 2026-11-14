// Helpers that read Markdown the way a renderer does, shared by the certificate tests of the engine and of the screen.

/** The cells of a table row: split on a `|` that is not escaped (an even number of backslashes before it). */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let slashes = 0;
  for (const ch of line) {
    if (ch === '|' && slashes % 2 === 0) {
      cells.push(cell);
      cell = '';
    } else cell += ch;
    slashes = ch === '\\' ? slashes + 1 : 0;
  }
  cells.push(cell);
  return cells.slice(1, -1).map((c) => c.trim());
}

/** Removes the backslash before an ASCII punctuation character, as every renderer does. */
export const unescape = (s: string): string => s.replace(/\\([\\`*_~[\]<>|&#$])/g, '$1');

/** Indexes of `ch` that are not preceded by an odd number of backslashes. */
export function unescapedAt(text: string, ch: string): number[] {
  const out: number[] = [];
  let slashes = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ch && slashes % 2 === 0) out.push(i);
    slashes = text[i] === '\\' ? slashes + 1 : 0;
  }
  return out;
}

/** What a note says, block by block, read back from its Markdown: the same sequence the screen must show. */
export type Said = { kind: 'title' | 'heading' | 'paragraph' | 'item'; text: string } | { kind: 'row'; cells: string[] };

export function readMarkdown(markdown: string): Said[] {
  const said: Said[] = [];
  for (const line of markdown.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('# ')) said.push({ kind: 'title', text: unescape(line.slice(2)) });
    else if (line.startsWith('## ')) said.push({ kind: 'heading', text: unescape(line.slice(3)) });
    else if (line.startsWith('- ')) said.push({ kind: 'item', text: unescape(line.slice(2)) });
    else if (line.startsWith('|')) {
      if (/^\|(?:---:?\|)+$/.test(line)) continue;
      said.push({ kind: 'row', cells: splitRow(line).map(unescape) });
    } else said.push({ kind: 'paragraph', text: unescape(line) });
  }
  return said;
}
