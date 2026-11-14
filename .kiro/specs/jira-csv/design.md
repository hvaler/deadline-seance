# Design: jira-csv

Read `requirements.md` first. This file says how each requirement is met, and lists the decisions that are mine to propose and yours to confirm.

## 1. Decisions to confirm in review

| # | Decision | Why | If you disagree |
|---|---|---|---|
| D1 | **80 open tickets** is the limit (and 1 MiB, 2,000 records, 300 columns, 100 errors). | It is the size the product, the solver and the fog were built and tested for. Measured here (section 9): a normal 80-ticket board solves in about 1 ms (worst 36 ms); a tie-heavy one with dependencies in 3 ms (worst 40 to 207 ms in two samples); a tie-heavy one **without dependencies** has a worst case of 813 ms (p95 185 ms). | Limit **60**: worst measured solve 32 ms on every kind. The constant is one line; 60 loses real boards, 80 keeps a rare stall for boards built on purpose to tie. |
| D2 | A dependency on a key that is **not in the file** is an error (row, column, key), as `docs/rule.md` says. | Silently dropping a link changes the cut without telling. Real exports often link to issues outside the filter; the sentence says to remove the link or add the issue. | Drop such links and count them in a warning. One branch in `importCsv`. |
| D3 | **Closed rows are skipped** (Resolution other than "Won't Do"), and links to them are dropped. | A whole-project export has hundreds of Done issues; they are not in a freeze, and a "blocked by" a Done issue blocks nothing. The banner says how many were skipped. | Treat any resolved row as an error. |
| D4 | A **blank Story Points** and a **decimal** (`0.5`) are errors. | The engine is integer-only; a blank estimate read as 0 would make the ticket free and put it in the cut. The error names the rows so the user can fill them. | Blank is 0 with a warning; decimals round up. Both change numbers the user did not type, so I do not propose them. |
| D5 | **Outward** links (`Outward issue link (Blocks)`) are read as the inverse; `Depends On` splits at `;`, `,` and white space. | The two link columns say the same thing from each end; accepting both costs three lines and avoids a "missing dependency" when only one is exported. | Inward only (your brief) and `;` only. |
| D6 | **Header errors stop the row pass**: if a required column is missing or duplicated, only those errors are returned. | Without the column every row is wrong in the same way; a hundred "Row n: missing" sentences hide the one that matters. All row errors are collected once the header is right. | Collect everything at once, with a cap. |
| D7 | The **export has no byte order mark**, uses a comma and CRLF; the importer accepts a mark, `;` and LF. | Jira's importer reads a mark as part of the first header. Excel opens a UTF-8 file without a mark as ANSI, so accents can look wrong when double-clicked in Excel; the README says to use Data > From Text, or to import into Jira, which is what the file is for. | Add the mark; Jira users must remove it. |
| D8 | **The release name** defaults to the file name without extension (`_` and spaces to one space, 60 characters), editable in the banner, and is kept in the state (`release`). Certificate, `Fix Version/s` and the product line use it. | One place for it; the certificate spec read it from `MountOptions.release`, which becomes the built-in board's release. | A fixed "Your tickets". |
| D9 | `AppState` gains `builtIn`, `source`, `release`; new actions `board/import`, `board/sample`, `release/set`. `board/reset` resets to the **loaded** board. | The tour must load the sample whatever is loaded, and Reset must keep your tickets. All of it stays in the reducer, so restore after the tour is still one `state/restore`. | A second store for the imported board (the tour's `toBe` restore would need two). |
| D10 | The tour's two `board/reset` become `board/sample`; the prompt says so when a file is loaded; your board comes back at the end. | Same captions, same 59.0 s, true on any board. | Disable the tour while a file is loaded. |
| D11 | **Plan B** is built, for boards of more than **30** tickets. | The curve takes a median of 14 ms (normal) to 21 ms (ties) at 80 tickets, above the 8 ms gate. Gating by size keeps the sample board (19 tickets) exactly as it is, with no "updating" flicker. | Plan B for every board (the sample shows "updating" while dragging). |
| D12 | **Next release name** is an inline labelled field next to the export button, not a dialog. | One control less to focus-trap, and the value stays for the next export. | A small dialog. |
| D13 | **Apostrophe rule** for formulas: one leading apostrophe on a text cell that starts (after any apostrophes) with `= + - @`, tab or CR; the importer removes exactly one in that case. | Round trip stays exact, including a title that really starts with `'=`. The cost: a title starting with `-` shows an apostrophe in Jira. | Never alter text and warn in the README instead. |
| D14 | **Lone surrogates** are written as U+FFFD by the exporter. | A file is bytes: any lone surrogate would become U+FFFD when saved anyway. Doing it in the string keeps what the function returns equal to what the file holds. | Keep them in memory; the round trip would differ from the file. |
| D15 | **Non-UTF-8 files** import with a warning when they contain U+FFFD. | Excel's plain "CSV" is ANSI; the user should know why an accent looks wrong. | Reject. |

## 2. Files

```
src/engine/
  csv.ts            NEW   parseCsv, serializeCsv, importCsv, exportCsv, ACCEPTED_HEADERS, CSV_LIMITS, types
  index.ts          EDIT  exports them
src/ui/
  model.ts          EDIT  AppState: builtIn, source, release; actions board/import, board/sample, release/set; Subject: import, sample; Comparison: new-board
  state.ts          EDIT  the three actions; reset keeps the loaded board
  text.ts           EDIT  notes for import and sample, banner sentences, describeCsvError
  night.ts          EDIT  nightInputOf(state) reads state.release
  services.ts       EDIT  Services.reader (File.text())
  render/banner.ts  NEW   the "Your tickets" banner
  render/import.ts  NEW   import controls, drop zone, errors region, sample and export downloads
  render/tools.ts   EDIT  the group replaces the csv slot; the reset label
  render/title-card.ts EDIT  the product line
  render/tour.ts    EDIT  prompt note while a file is loaded
  tour/sample-script.ts, tour/doc.ts  EDIT  board/sample
  derive.ts, fog-cache.ts, context.ts, gestures.ts, render/candle.ts, render/sign.ts, render/fog.ts  EDIT  plan B
  app.ts, main.ts   EDIT  wiring
  styles/components.css, layout.css  EDIT
tests/engine/       csv.test.ts, fixtures/jira-cloud-export.csv, fixtures/jira-semicolon.csv, fixtures/jira-errors.csv (NEW); generators.ts, performance.test.ts, purity.test.ts, traceability.test.ts (EDIT)
tests/ui/           csv-tools.test.ts, csv-golden.test.ts, fog-settle.test.ts (NEW); harness.ts, arbitraries.ts, reducer.test.ts, text.test.ts, slots.test.ts, certificate-view.test.ts, render-tour.test.ts, tour-script.test.ts, a11y.test.ts (EDIT)
docs/               rule.md (appended), examples/sample-board.csv (generated), video-tour-script.md (regenerated)
```

The solver, diff, fog, facts, guard and certificate do not change.

## 3. Reading and writing CSV (`csv.ts`)

```ts
export type Delimiter = ',' | ';';
export interface ParsedCsv { readonly delimiter: Delimiter; readonly records: readonly (readonly string[])[] }
export function parseCsv(text: string): Result<ParsedCsv, CsvError>
export function serializeCsv(records: readonly (readonly string[])[], delimiter: Delimiter): string
```

**Reader.** One pass over the characters with three states (start of field, in an unquoted field, in a quoted field). A quote that opens a field starts quoted mode; inside it `""` is a quote and a lone `"` followed by the delimiter, a line end or the end of the text closes it; a `"` in an unquoted field is text. CR, LF and CRLF end a record outside quotes; inside quotes they are kept as written. The first character, if U+FEFF, is dropped. A first line matching `^sep=(.)$` (case-insensitive) with `,` or `;` sets the delimiter and is removed before counting rows. Otherwise the delimiter is chosen from the **first record**: count `,` and `;` outside quotes in the first line (stopping at the first line end outside quotes); more `;` than `,` means `;`. An unterminated quote returns `unterminated-quote` with the row where it opened. A final line end does not make an empty record.

**Writer.** A field is quoted when it holds the delimiter, `"`, CR or LF (or starts or ends with a space, so a reader that trims cannot hurt it); every record ends with CRLF. No lone surrogate leaves: `/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g` becomes U+FFFD (a hand-written loop instead if the lookbehind is a problem in the engine's lib target).

## 4. Importing (`importCsv`)

```ts
export interface CsvColumn { readonly index: number; readonly letter: string; readonly header: string }
export interface CsvError { readonly code: CsvErrorCode; readonly row: number | null; readonly column: CsvColumn | null; readonly value?: string; readonly keys?: readonly Key[]; readonly limit?: number; readonly total?: number }
export interface ImportBase { readonly people: readonly Person[]; readonly timeZone: string; readonly nextReleaseWeeks: number; readonly zombieThreshold: number }
export interface Imported {
  readonly board: ValidBoard;
  readonly ticketCount: number;
  readonly putDown: readonly Key[];
  readonly skipped: { readonly count: number; readonly byResolution: readonly { readonly resolution: string; readonly count: number }[] };
  readonly warnings: readonly 'replacement-characters'[];
}
export function importCsv(text: string, base: ImportBase): Result<Imported, readonly CsvError[]>
```

Steps, in order, each returning early only where said:

1. **Whole file.** `text.length` over the byte limit: `file-too-large`. Empty or white space only: `empty-file`.
2. **Parse.** `parseCsv`; an error ends here. More than 2,000 records: `too-many-rows`; more than 300 columns in the header: `too-many-columns`.
3. **Header pass.** Normalise each header (trim, collapse spaces, lower case, strip one `Custom field (...)` wrapper) and look it up in `ACCEPTED_HEADERS` (a data table: meaning, aliases, repeatable). Collect `missing-column` and `duplicate-column`. If there is any, return them (D6). No data row: `no-tickets`.
4. **Classify rows.** Row number = record index + 1. An all-empty record is skipped. Resolution empty: open; Won't Do (`'` or `’`, any case): put-down; anything else: closed (counted by resolution). Keys are trimmed. Duplicate keys (within and across the three kinds) are `duplicate-key` at the second row.
5. **Open rows.** For each: `bad-key`, `missing-value`, `too-long`, the integers (`^\d+$` after trim, within `Number.MAX_SAFE_INTEGER`; `-3` is `negative-number`; anything else `not-integer`), the cost by the rule of Requirement 3.5 (`cost-both` if a Cost of Delay and any of the three parts; `cost-incomplete` if some but not all parts and no Cost of Delay; `cost-missing` if none), the scale for Value, Urgency and Risk (`off-scale`), the flag (`bad-flag`). Text cells go through the apostrophe rule of section 5 (Summary and keys).
6. **Dependencies.** For each open row, the keys of its Depends On and Blocked by columns, and for each Blocks cell the inverse edge (the key named depends on this row). A key that is an open ticket, a put-down row or a closed row is fine (closed: dropped); any other is `unknown-dependency` at the row and column where it was written. A key equal to the row's own is `self-dependency`. `findCycles` (chain.ts) over the open tickets gives `dependency-cycle`, with the keys, at the row of the smallest key.
7. **Limits.** More than 80 open tickets: `too-many-tickets` with the count and the limit.
8. **Errors?** Sort, cap at 100 with `too-many-errors` and the total, return.
9. **Board.** `validateBoard({ ...base, tickets, wontDo, fogSeed: DEFAULT_FOG_SEED })`. The checks above cover every validation error except `board-too-large`, which is returned as such; any other (it cannot happen) is returned as `board-too-large` with the engine's code in `value`, so nothing is lost.

**Error order.** `row` (null first), `column.index` (null first), `code`, `value`. A test over the three error fixtures pins the full list.

**Accepted headers** (the one table of Requirement 2.1, as data):

```ts
export const ACCEPTED_HEADERS = [
  { meaning: 'key', required: true, repeatable: false, names: ['issue key', 'key'] },
  { meaning: 'title', required: true, repeatable: false, names: ['summary'] },
  { meaning: 'points', required: true, repeatable: false, names: ['story points', 'story point estimate', 'story point'] },
  { meaning: 'value', required: false, repeatable: false, names: ['value'] },
  { meaning: 'urgency', required: false, repeatable: false, names: ['urgency'] },
  { meaning: 'risk', required: false, repeatable: false, names: ['risk'] },
  { meaning: 'cod', required: false, repeatable: false, names: ['cost of delay', 'cod'] },
  { meaning: 'mustHave', required: false, repeatable: false, names: ['must have', 'must-have'] },
  { meaning: 'dependsOn', required: false, repeatable: true, names: ['depends on'] },
  { meaning: 'blockedBy', required: false, repeatable: true, names: ['inward issue link (blocks)'] },
  { meaning: 'blocks', required: false, repeatable: true, names: ['outward issue link (blocks)'] },
  { meaning: 'past', required: false, repeatable: false, names: ['times postponed'] },
  { meaning: 'resolution', required: false, repeatable: false, names: ['resolution'] },
] as const;
```

(`required` for the cost columns is "one of two groups", checked in code.) A test builds the README's table from this data and compares it with the README text.

## 5. Exporting (`exportCsv`)

```ts
export interface ExportInput {
  readonly board: ValidBoard;               // the current board
  readonly home: ValidBoard;                // for the titles of put-down tickets
  readonly kept: ReadonlySet<Key> | null;   // the keys the cut keeps; null when the freeze is impossible
  readonly release: string;                 // the current release name
  readonly nextRelease: string;
}
export function exportCsv(input: ExportInput): string
```

Header record, one record per ticket in board order, then one per `wontDo` key in key order, through `serializeCsv(records, ',')`. A formula ticket's cells are its own value, urgency and risk (not the hunger); an imported one its `cod`. `Fix Version/s` is `release` for a kept key, `nextRelease` otherwise, empty when `kept` is null and on put-down rows.

**Apostrophe.** `guardCell(text) = /^'*[=+\-@\t\r]/.test(text) ? "'" + text : text` on Issue key, Summary, Depends On and Fix Version/s; `unguardCell(text) = /^'+[=+\-@\t\r]/.test(text) ? text.slice(1) : text` on the same cells in the importer (so one apostrophe is removed exactly when the rest starts with apostrophes and then a trigger character, which is what `guardCell` adds). A property test round-trips arbitrary strings through the pair.

## 6. State and reducer

```ts
interface AppState { /* the existing fields */
  readonly builtIn: { readonly board: ValidBoard; readonly release: string | null };
  readonly source: { readonly kind: 'built-in' } | { readonly kind: 'file'; readonly name: string; readonly skipped: number; readonly warnings: readonly string[] };
  readonly release: string | null;
}
type Action = /* existing */
  | { type: 'board/import'; board: ValidBoard; name: string; release: string | null; skipped: number; warnings: readonly string[] }
  | { type: 'board/sample' }
  | { type: 'release/set'; name: string };
```

- `initialStateFor(board, release = null)` sets `builtIn = { board, release }`, `source = built-in`, `release`. `initialState()` gives the sample with `SAMPLE_RELEASE`.
- `board/import`: `{ ...initialStateFor(action.board, action.release), builtIn: state.builtIn, source: file, sound: state.sound, change: done(subject import, comparison new-board) }`.
- `board/sample`: the same with `state.builtIn`, source built-in, subject `sample`.
- `board/reset`: back to `state.home` with `source`, `builtIn` and `release` kept (today's behaviour for the built-in board).
- `release/set`: trims, collapses white space, cuts to 60, empty becomes null; no change returns the same state; it does not touch `change` and is not announced (like `sound/set`, excluded in `ctx.act`).
- **Subject** gains `{ kind: 'import'; name: string; count: number; skipped: number }` and `{ kind: 'sample' }`; **Comparison** gains `{ kind: 'new-board' }`. The note lines: "N tickets loaded." and "K closed issues skipped." when K is above 0; for `sample`, "Back to the sample board." The sentence builders only count lists and put the numbers they were given.
- `soundEventFor` returns null for both; `compareStates` is not called for them (the comparison is `new-board` by construction, so a downloaded sample whose keys coincide never shows a false "rises and sinks").
- `nightInputOf(state)` reads `state.release`; `mountApp` passes `options.release ?? null` to `initialStateFor`.

The arbitraries gain `board/sample` and `release/set`; `board/import` is tested on its own with boards from `importCsv`.

## 7. The screen

**Services.** `Services.reader: { read(file: File): Promise<string> }` (browser: `file.text()`); the harness gets `RecordingReader`.

**`render/import.ts`** builds, in the tools region, a group "Your tickets":

```
div.csv-group[role=group][aria-labelledby]
  h3 "Your tickets"
  div.csv-actions   [Import Jira CSV] [Download sample CSV] [Export CSV for Jira]   + label "Next release name" + input
  div.csv-drop[aria-hidden]  "or drop a .csv file here"
  input[type=file][hidden][accept=".csv,text/csv"]  (opened by the button)
  div.csv-errors[role=alert][tabindex=-1]  (only after a failed attempt)
     h4 "The file was not imported"   ol > li
```

Flow: `file.size > CSV_LIMITS.bytes` gives the `file-too-large` error without reading; otherwise `reader.read(file)`, `importCsv(text, baseOf(state.builtIn.board))`, then either the errors region or `ctx.act({ type: 'board/import', ... })` and `page.reveal(banner)` with the focus on the banner. The `base` is the **built-in** board's team (the "current team" of the brief is the full team; people sent away are a candle-level choice that resets with the board). The release name is derived from the file name (section 7 below).

**Drop zone.** `dragenter/dragover` (when the drag holds files) add `is-over` and prevent default; `dragleave` removes it; `drop` reads `dataTransfer.files[0]` (more than one: the first, and a note in the errors region would be noise, so no note). The document gets `dragover` and `drop` listeners that prevent the default for file drags, so a miss does not open the file in the tab; they are removed in `destroy`.

**Error sentences** (`text.ts`, `describeCsvError`) are fixed templates over the error's fields, for example: `Row 7, column E (Story Points): must be a whole number (got 2.5).` / `Row 9, column K (Inward issue link (Blocks)): HB-77 is not in the file. Remove the link or add the issue.` / `The file: the column Summary is missing.` / `Row 11, column A (Issue key): HB-3 is also used in row 4.` (a `duplicate-key` error at the second row, carrying the first row in `value`). The text of a cell (a value) is cut to 40 characters with an ellipsis in the sentence.

**Banner** (`render/banner.ts`, a `div` at the top of `main`, `data-region="source"`, `role="region"`, `aria-label="Your tickets"`, `tabindex="-1"`, hidden for the built-in board): the two sentences of Requirement 7.2 built by `text.ts` from `source`, `home.tickets.length`, `home.nextReleaseWeeks`, `home.zombieThreshold` and `DEFAULT_FOG_SEED`; the skipped and warning notes; the field **Release name** (`change` event dispatches `release/set`); the button **Back to the sample board** (`board/sample`; the banner disappears, so the focus goes to the Import button).

**Release name from the file** (`text.ts`): drop the last `.csv` (any case), turn runs of `_` and white space into one space, trim, cut to 60; empty becomes null.

**Reset label and product line.** `tools.ts` and `title-card.ts` read `state.source` in `update`.

**Styles** (`components.css`): the group, the drop zone (a dashed border in `--stone`, `is-over` in `--amber`), the errors region (a bone-on-night panel with a red left border for the heading only if `tokens.test.ts` allows red text there; otherwise amber), the banner (amber top border like the tour bar), all with `overflow-wrap: anywhere` and the 44 px targets of the existing buttons.

## 8. The tour

`sample-script.ts`: the `baseline` and `fog-zero` scenes start with `{ type: 'board/sample' }` instead of `{ type: 'board/reset' }`. On the built-in board the two actions give the same state (a test), so captions, durations and the generated script are unchanged except the words of the two actions ("loads the sample board: back to the plain night ..." in `doc.ts`, and `describeAction` gets the new case). The prompt (`render/tour.ts`) adds a paragraph when `state.source.kind === 'file'`. The tour's restore is the existing `state/restore`, which now restores the imported board, source, release and banner with the snapshot object itself; a test starts the tour on an imported board and ends it with `toBe`. Starting the tour also clears the errors region (the import part listens to the tour's phase through the context: `ctx.store` subscription on `source` is enough, the region is removed on any state change that is not its own).

## 9. Performance

Measured on the development machine with `fast-check` generated 80-ticket boards (`tests/engine/generators.ts`, 12 to 40 boards, capacity at 20 to 70 % of the total effort), median of 5 runs:

| Boards (80 tickets) | Solve, median / max | Table, median | Cached curve (7 solves and 7 passes), median / max |
|---|---|---|---|
| normal, dependencies up to 3 | 1.0 to 1.6 ms / 8 to 36 ms | 1.3 ms | 14.1 ms / 55 ms |
| tie-heavy, dependencies | 1.5 to 3.1 ms / 40 to 207 ms | 1.3 ms | 20.8 ms / 498 ms |
| tie-heavy, no dependencies | 0.7 ms / **813 ms** (p95 185 ms) | 1.3 ms | 10.8 ms / 526 ms |
| normal, no dependencies | 0.1 ms / 0.2 ms | 1.3 ms | 1.1 ms / 1.6 ms |

By size, the worst solve of a tie-heavy board without dependencies: 40 tickets 4.5 ms, 50 tickets 21 ms, 60 tickets 32 ms, 70 tickets 184 ms, 80 tickets 813 ms. A "tie-heavy" board here has efforts and imported costs from 0 to 2, which is rarer than a real export, but a file can be built that way; Jira estimates on the Fibonacci scale make real ties less severe.

So the 8 ms gate is crossed by a normal board, and **plan B is built** (D11). The sample board's curve stays well under 2 ms.

**Plan B in the code.**

- `Ctx.gestureActive(on: boolean)`; `createGesture` takes an optional `onActive(on)` called with `true` on the first `input` of a gesture and with `false` after it settles (after `onSettle`); the candle and the reserve parts pass `ctx.gestureActive`.
- `app.ts` keeps a counter, passes `{ settled: counter === 0 }` to `derive`, and when the counter returns to 0 renders again with the current state.
- `derive(state, { settled })`: `fogViewFor` asks `peekCurve(state)` (a cache lookup that never computes). Hit: fresh. Miss and (`settled` or the board has `FOG_ON_SETTLE_FROM` tickets or fewer): compute, store as the board's last curve. Miss while not settled on a larger board: use the board's last curve if there is one (`stale: true`), otherwise compute (the first curve of a board is never withheld).
- `View.fog` gets `stale: boolean`. `fog.ts` (the sign) sets `data-stale` on the block and writes "updating" in the place of the second line of the sentence; the headline figure stays as it was.
- Tests (`fog-settle.test.ts`): on a 40-ticket board, during a gesture a candle step that is not cached does not call the fog (a spy on `fogCurve`), the sign is stale, the sentence is replaced by "updating", settling fills it and clears the mark; on the sample board no gesture ever marks it; the announcement is the same with and without; the reserve gesture computes nothing.
- The measurements are repeated in a test (`performance.test.ts`: solve and curve on a generated 80-ticket imported board, printed, with loose bounds) and in a real browser with a frame trace, with the constant set to a value above 80 for the "without plan B" run (a temporary edit, built separately, not committed).

## 10. Tests

| File | What it checks |
|---|---|
| `tests/engine/csv.test.ts` | RFC 4180 examples (quotes, doubled quotes, line breaks in quotes, CRLF, LF, lone CR, BOM, `sep=;`, `;` and `,` detection, ties, unterminated quote); the writer; `parse(serialize(r)) = r` for both delimiters; the header table; every error code with its row, letter and order; limits; closed and put-down rows; dependency forms (Depends On, inward, outward, repeated columns, separators); the apostrophe pair; `P13`; `P26`; fuzz (never throws, every row exists); row order; mutation checks |
| `tests/engine/fixtures/*.csv` | a Jira Cloud export (BOM, real headers, repeated `Sprint`, `Labels`, `Inward issue link (Blocks)`, a Done row, a Won't Do row, commas, quotes and line breaks in cells), a semicolon file with `sep=;`, and a file with one mistake of every code |
| `tests/engine/performance.test.ts` | solve and curve on an 80-ticket imported board, with bounds |
| `tests/ui/csv-tools.test.ts` | the controls, the file size check before reading, the reader, choosing and dropping a file, the document's drag guard, success (state, banner, note, focus, reveal, release name, product line, reset label), errors (the alert region, the order, the focus, the very same state object, provenance of the sentences, hostile text), sample and export downloads (names, types, bytes equal to the engine's output), round trip of the downloaded sample through the UI, `Back to the sample board`, `release/set` |
| `tests/ui/csv-golden.test.ts` | `docs/examples/sample-board.csv` by file snapshot; its import equals the sample's tickets; the README header table equals `ACCEPTED_HEADERS` |
| `tests/ui/fog-settle.test.ts` | plan B, as listed in section 9 |
| changed | `purity.test.ts` (API list: `ACCEPTED_HEADERS`, `CSV_LIMITS`, `exportCsv`, `importCsv`, `parseCsv`, `serializeCsv` and types), `traceability.test.ts` (P13, P26 in `csv.test.ts`), `slots.test.ts`, `reducer.test.ts`, `arbitraries.ts`, `text.test.ts`, `certificate-view.test.ts` (`nightInputOf`), `tour-script.test.ts`, `tour-player.test.ts`, `render-tour.test.ts` (prompt note, imported board before and after), `a11y.test.ts` (banner, errors region, import group), `harness.ts` |

**Generators** (`generators.ts`): `arbCsvBoard` (0 to 80 tickets from `arbBoard`, titles from `arbTitle` filtered to non-blank, `withWontDo`, formula and imported costs, must-haves, `past`); `arbCsvText` (arbitrary strings, strings built from CSV pieces, and valid files with random cells damaged).

**Mutation checks** (one at a time, on a copy, reverted each time): the seven of Requirement 5.6.

## 11. Real browser

A script like the earlier ones (headless Chrome over the DevTools protocol, in `%TEMP%`, deleted afterwards), on the production build served locally:

1. At 1280 × 720, 360 × 740 and 320 × 640: `DOM.setFileInputFiles` on the hidden input for a good file, a file with errors (a missing cell, a decimal, an unknown link, a cycle), and a generated 80-ticket file; `Input.dispatchDragEvent` for a drop if the protocol allows (otherwise the chooser only, and the report says so); screenshots; page `scrollWidth`; the focus after each; the alert text.
2. `Browser.setDownloadBehavior`: the sample and the export, compared with the engine's output; edit one cell of the sample, import it back, read the change on the page.
3. The candle drag on the 80-ticket board: a `requestAnimationFrame` trace, at normal speed and at 4 times CPU slowdown, with plan B and with the constant raised.
4. The tour from an imported board.

## 12. Risks

- **A tie-heavy 80-ticket board can stall one solve for up to 0.8 s** (D1). Reported, not hidden; the limit is one constant.
- **Real exports use names this spec has not seen** (a translated Jira in Spanish exports `Resumen`, `Clave de incidencia`). The table is data and the error says which header was expected, but Spanish headers are not accepted in this version.
- **Excel and encodings** (D7, D15): documented, tested with a file saved as ANSI.
- **`File.text()` in jsdom 31**: the tests use the injected reader; the browser default is what the real-browser check covers.
- **Plan B and tests that read `view.fog` during a gesture**: the existing fog tests do not drag a board above 30 tickets, so they keep their meaning; the new test file covers the rest.

## 13. What changed while implementing (after your review)

- **The limit is 60 open tickets**, your decision. The error says to filter the Jira export by fix version or sprint. Re-measured on 60-ticket boards (160 cases per kind): normal, solve median 0.3 ms and worst 4.2 ms, cached curve median 2.3 ms and worst 22 ms; tie-heavy with dependencies, solve 0.4 / 4.3 ms, curve 3.2 / 26 ms; tie-heavy with no dependencies, solve 0.1 / **96 ms**, curve 2.3 / **449 ms**. At 80 tickets the same last case reached 3.5 s for one solve and 24 s for one curve, which is why 80 is not accepted.
- **Names.** The action is `board/load` and the subject `load` (the project's scan of imports reads the word followed by a quote as an import statement); the group lives in `render/csv-group.ts`; the button is `csv-pick`.
- **Numbers.** A whole number written with a zero fraction (`5.0`, which Jira writes) is accepted; `0.5` is not.
- **Sorting.** Whole-file errors of one kind (several missing columns) are ordered by the name they carry, alphabetically.
- **The empty board.** A file with no open ticket is the error `no-tickets`, so a board of zero tickets does not round-trip; the generators start at one ticket.
- **The reader** `parseCsv(text, delimiter?)` takes the delimiter when it is known; the writer quotes a field that holds a comma **or** a semicolon, so a header written with either is read back right.
- **Release.** `AppState.release` is the one place; `MountOptions.release` is the built-in board's, `nightInputOf(state)` reads the state, and the certificate view no longer takes it as an option.
- **Plan B** is as designed; `Services.reader` and the harness's `RecordingReader` are new; `Ctx.gestureActive` is called by both gestures.
- **Put-down tickets keep their data (fix after review).** `Imported.putDownTickets` carries the tickets a file closed as Won't Do, read leniently; `AppState.source.putDown` keeps them (and `board/load` carries them); `ExportInput.closed` gives them back to the export, which writes a put-down ticket with all its columns, from `home` or from `closed`. P13 and P26 now include put-down tickets with hostile titles, costs, links and `past`.
