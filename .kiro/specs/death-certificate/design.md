# Design: death-certificate

Read `requirements.md` first. This file says how each requirement is met, and lists the decisions that are mine to propose and yours to confirm.

## 1. Decisions to confirm in review

| # | Decision | Why | If you disagree |
|---|---|---|---|
| D1 | A **fourth reason**, "blocked by a put-down", next to your three (does not fit, follows a buried dependency, pushed out by an exhume). | The app already has this state (`blocked-by-put-down`); a stakeholder reading "does not fit" for a ticket that can never ship would be misled. | Drop the row; the ticket then reads "follows HB-114"-style text we cannot say truthfully. |
| D2 | "Pushed out by an exhume" is found by **leave-one-out**: solve the night again with the exhumes undone, and then with each exhume undone alone. A ticket the solver left out for lack of room that is kept in those solves is pushed out by the exhume (or exhumes) whose undoing brings it back. Costs `1 + number of exhumes` extra solves, only when the certificate is made. | It is the only definition that is exact and needs no history: the state carries no log of what was exhumed in what order. | A cheaper wording ("an exhume is active") would name an exhume that pushed nothing out. |
| D3 | The **release name** is an input (`release: string \| null`, `MountOptions.release`); the engine's `Board` does not change. | The board has no name field; adding one touches the data model, validation, CSV and MCP. | Add `Board.name` in a later spec; the certificate then reads it from the board. |
| D4 | The view is **made from a `Note` model**, not by parsing the Markdown and not as a preformatted block. The Markdown and the DOM come from the same blocks. | A real `table` is readable by a screen reader and by a phone; a pipe table in a `pre` is neither. There is no Markdown parser to get wrong. | `<pre>` is about 20 lines less code and is what you copy; it reads worse at 320 px and with a screen reader. |
| D5 | A **custom dialog** (`div role="dialog"`), not the native `<dialog>`. | jsdom 31 has no `showModal`, so the native one could not be tested here; and the tour needs the view **above the page but below its caption bar**, which a modal `<dialog>` (top layer, makes everything else inert) cannot do. | Native `<dialog>` for the user's mode and `show()` for the tour, with a stub in tests. |
| D6 | The control lives in the **Tools** region, replacing the disabled slot. | Same place the brief and the slot already promise; no change to the sign, whose heights are fixed. The tour shows it. | In the sign, near the verdict: more visible, but it competes with the verdict and changes a measured block. |
| D7 | The table is ordered by **waiting cost, highest first**, then by key. | The first rows are what hurts most to leave out. Solver order is alphabetical, which reads like a database dump. | Alphabetical by key (the solver's order) is one line. |
| D8 | **Data text is ignored by position** (spans returned by the renderer), keys are checked as keys. | Searching for the title would let a title `5` hide a wrong `5`. | Ignore by search and accept that hole. |
| D9 | The tour scene goes **after scene 6** and the tour is **rebalanced to 59.0 s**: "fog-zero" 5.0 → 4.5 s, "message" 4.5 → 3.5 s, "close" 5.0 → 4.5 s, new scene 4.0 s. | Only the state after scene 6 fills every section. The tour is 57.0 s today; the scene would make 61.0 s, so 2.0 s come out of the three scenes with the most slack (new reading speeds: 10.7, 13.1 and 14.4 characters per second). 59.0 s keeps the 1 s of measured drift under 60. | At the end of the tour (the plain night, 20 % reserve): three sections read "None", and the note shows less. Or no scene. |
| D10 | The golden notes live in `docs/examples/`. | They double as README material for a judge who does not run the app. | `tests/ui/golden/`. |
| D11 | **No** runtime verdict of the guard on the screen. | Out of scope; the tests carry the proof. A line "every number in this note is a computed fact" is cheap to add later (`guardCertificate` exists). | Say so and I add it. |
| D12 | If **Download fails under the CSP**, I stop and report instead of loosening the policy. | `csp.test.ts` pins the policy exactly and the policy is a promise of the product. A download through `<a download href="blob:…">` is a navigation, which `default-src` does not govern, so I expect it to work; I check it first (task 7). | If it is blocked, the options are a `data:` link or showing the text in a new tab; both need your decision. |

## 2. Files

```
src/engine/
  facts.ts          NEW   nightFacts(): the facts of the night, from the solver, the fog and a leave-one-out
  guard.ts          NEW   extractTokens(), guardFacts(), checkNumbers()
  certificate.ts    NEW   Note model, escapeMarkdown(), certificateNote(), renderCertificate(), deathCertificate(), guardCertificate()
  index.ts          EDIT  exports the three modules' public functions and types
src/ui/
  night.ts          NEW   nightInputOf(state, release): the one place the UI turns its state into the engine's input
  render/certificate.ts  NEW  the view: dialog, table, Copy, Download, status; modal mode and tour mode
  services.ts       EDIT  Services.clipboard, Services.files (browser defaults)
  render/tools.ts   EDIT  the working "Death certificate" button replaces the slot
  app.ts            EDIT  mounts the view, passes it to the tour; MountOptions.release
  render/tour.ts    EDIT  show('certificate') opens the view in tour mode; tour start closes it
  tour/types.ts     EDIT  Show gains 'certificate'
  tour/sample-script.ts  EDIT  the new scene, three durations
  tour/doc.ts       EDIT  "The app" column says "opens the death certificate"
  sample-board.ts   EDIT  SAMPLE_RELEASE = 'Hollow Bank app 3.2' (PRODUCT_LINE does not change)
  styles/components.css, layout.css  EDIT  the view
src/main.ts         EDIT  release: SAMPLE_RELEASE
tests/engine/       facts.test.ts, guard.test.ts, certificate.test.ts (NEW); generators.ts, purity.test.ts, traceability.test.ts (EDIT)
tests/ui/           certificate-view.test.ts, certificate-golden.test.ts, epitaph-guard.test.ts (NEW); harness.ts, slots.test.ts, a11y.test.ts,
                    tour-script.test.ts, render-tour.test.ts, tokens.test.ts (EDIT)
docs/examples/      death-certificate-friday.md, death-certificate-tour.md (NEW, generated)
docs/               rule.md (appended), video-tour-script.md (regenerated)
```

The reducer, the state, the solver, the diff and the fog do not change. The dependency still points one way: `ui` calls `engine`, and the engine imports only its own files.

## 3. The facts (`facts.ts`)

```ts
export interface NightInput {
  readonly home: ValidBoard;          // the board as loaded: tells which must-haves are exhumes, and the titles of put-down tickets
  readonly board: ValidBoard;         // full team, exhumes and put-downs applied
  readonly freeze: FreezeInput;       // now, freezeAt, marginPct
  readonly away: readonly string[];   // names sent away
  readonly release: string | null;
}

export interface LocalStamp { readonly weekday: string; readonly date: string; readonly time: string }   // 'Fri', '2026-11-20', '18:00'

export type OutsideReason =
  | { readonly kind: 'no-room'; readonly needed: number; readonly left: number }
  | { readonly kind: 'depends-on-buried'; readonly buriedDependencies: readonly Key[] }
  | { readonly kind: 'blocked-by-put-down'; readonly putDownKey: Key }
  | { readonly kind: 'pushed-out-by-exhume'; readonly exhumed: readonly Key[]; readonly needed: number; readonly left: number };

export interface OutsideFact {
  key; title; effort; cod; costParts: CodParts; waitingCost; isZombie; nextUrgency: number | null; reason: OutsideReason
}

export interface SolvedNight {
  status: 'ok'; release: string | null; zone: string; asOf: LocalStamp; freeze: LocalStamp;
  capacity; reservePct; effectiveCapacity; weeks;
  kept: { count; effort; cod };
  fog: { nights; holds; pct; minPct: 80; maxPct: 150; capacity };
  outside: readonly OutsideFact[];                       // waiting cost desc, then key
  outsideTotals: { count; effort; cod; waitingCost };
  zombieThreshold;                                       // the Zombies section is `outside` filtered by `isZombie`, in the same order
  putDown: readonly { key; title: string | null; blocks: readonly Key[] }[];
  away: readonly string[];
  exhumed: readonly { key; title; effort; cod; pushedOut: readonly { key; cod }[] }[];
  keys: readonly Key[];                                  // every key of the board and of the put-down list, for the guard
}
export interface ImpossibleNight { status: 'impossible'; release; zone; asOf; freeze; capacity; reservePct; effectiveCapacity; needed; blockedMustHaves: ...; keys }
export type NightFacts = SolvedNight | ImpossibleNight;
export function nightFacts(input: NightInput): Result<NightFacts>
```

How it is computed, in order:

1. Check `away` against the team. Build the present board (`board` with the away people removed) and validate it, as the UI's `boardFor` does.
2. `solveFreeze(present, freeze)`. An impossible result becomes `ImpossibleNight` and stops.
3. Totals, zombies and the waiting cost come from the solution (`keptEffort`, `savedCod`, `buriedEffort`, `buriedCod`, `Buried.burialCost`, `Buried.isZombie`). The parts come from `codParts`; the next urgency from `effectiveUrgency(urgency, past + 1)`, as the UI already does for the hunger line.
4. The fog is `simulateFog(present, kept, capacity)`: the same call the curve uses for the point at this reserve, so the two always agree (a test).
5. **Leave-one-out.** `exhumed` = keys that are must-have in `board` and not in `home`. If there are none, nothing more is solved. Otherwise: solve `present` with every exhume undone (`mustHave` taken back to `home`'s value) to get `keptWithout`; and, for each exhume `e`, solve with only `e` undone to get `keptWithoutE`. A ticket whose solver reason is `no-room` and which is in `keptWithout` is *pushed out*; its culprits are the `e` for which it is in `keptWithoutE`, and all exhumes if there are none. Undoing a must-have cannot make a freeze impossible, so these solves are always solved; a test asserts it. The boards for these solves are the present board with a changed `mustHave`, cast to `ValidBoard` exactly as `exhume` in `diff.ts` does, since no key, number or dependency changes.
6. The reason of each outside ticket follows the precedence of Requirement 1.5. `put-down` blocks come from `blockedBy(present.tickets, [key])` for each put-down key, so a ticket that reaches two put-down keys is listed under both, although the solver's own reason names the smaller one.
7. Sort: outside by `waitingCost` descending then `compareKeys`; everything else by `compareKeys`. No list takes the order of the board.

Stamps use `Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', … })` with `formatToParts`, as `capacity.ts` does for the offsets. They are pure for a given time-zone database.

`keys` is `board.tickets` keys plus `board.wontDo`, sorted. It is what the guard may accept as a key.

## 4. The guard (`guard.ts`)

```ts
export type TokenKind = 'date' | 'time' | 'key' | 'weekday' | 'decimal' | 'number' | 'signed' | 'word';
export interface Token { kind: TokenKind; text: string; at: number; value?: number; sign?: '+' | '-'; percent?: boolean }
export interface Offending extends Token { reason: 'not-in-facts' | 'wrong-sign' | 'decimal' | 'unknown-key' | 'unknown-date' | 'unknown-time' | 'unknown-weekday' }
export interface GuardFacts { numbers: ReadonlySet<number>; negatives: ReadonlySet<number>; words: ReadonlySet<string>; keys: readonly string[] }
export interface GuardOptions { ignore?: readonly (readonly [number, number])[]; keys?: readonly string[] }

export function extractTokens(text: string, options?: { ignore?, keys? }): Token[]
export function guardFacts(sources: readonly unknown[], options?: { keys?: readonly string[] }): GuardFacts
export function checkNumbers(text: string, facts: GuardFacts, options?: { ignore? }): { ok: boolean; offending: Offending[] }
```

**Scanning.** One left-to-right pass over the text with a sticky regular expression made fresh on every call (so no `lastIndex` survives a call). At each position it tries, in this order, the first that matches:

1. a known key (from `facts.keys`, longest first, not inside a longer word);
2. a date `\d{4}-\d{2}-\d{2}`, a time `\d{1,2}:\d{2}`, each not touching other digits;
3. a key-shaped word `[A-Z][A-Z0-9]*-\d+`;
4. a weekday word (`Mon`…`Sun`, full names);
5. a decimal `\d+\.\d+`;
6. an integer: `\d{1,3}(,\d{3})+` or `\d+`, with an optional sign in front (rule 3 of Requirement 2), and an optional `%` after it (with or without a space) recorded as `percent`;
7. a number word (`zero` … `dozen`), whole word, case-insensitive.

Positions inside an ignored span are skipped. A comma not followed by exactly three digits ends the number (`3,5` is 3 and 5). The text can contain anything, including lone surrogates and very long digit runs (a run above `Number.MAX_SAFE_INTEGER` is offending, `not-in-facts`).

**Facts.** `guardFacts` walks the sources: every finite number goes to `numbers` (negatives also to `negatives`); every string value that looks like a date, a time or a weekday goes to `words`; `options.keys` and any `keys` list become `keys`. It never reads property names, so renaming a field of the facts cannot change what the guard accepts. For the certificate the keys are given in both forms (raw and escaped), because the Markdown escapes `_` and the like in keys.

**Checks.** `number`: offending unless the value is in `numbers` (the magnitude of a negative fact counts). `signed`: `-` needs `-n` in `negatives`; `+` needs `n` in `numbers` and not only in `negatives`; a magnitude present with the other sign is `wrong-sign`. `decimal`: always offending. `key`: must equal a key of the facts. `date`, `time`, `weekday`: must be in `words`. `word`: its number is checked like an integer.

**Limits** (also in the module header): provenance not meaning; no "twice", "half", ordinals as words, Roman numerals; `Mon-Fri` is a weekday, a hyphen and a weekday; bare web addresses are not neutralised.

## 5. The certificate (`certificate.ts`)

**The model.**

```ts
export interface Data { readonly data: string }                 // text from the board: escaped, ignored by the guard
export type Text = readonly (string | Data)[];                  // template words and data text, in order
export type Block =
  | { kind: 'title' | 'heading' | 'paragraph'; text: Text }
  | { kind: 'list'; items: readonly Text[] }
  | { kind: 'table'; label: string; head: readonly Text[]; align: readonly ('left' | 'right')[]; rows: readonly (readonly Text[])[] };
export interface Note { readonly blocks: readonly Block[] }
```

`certificateNote(facts)` builds it; `renderCertificate(facts)` turns it into `{ markdown, data: [start, end)[] }`: it writes each piece through `escapeMarkdown`, remembers the offsets of every `Data` piece, joins blocks with one blank line, and ends with one `\n`. `deathCertificate(facts)` is `renderCertificate(facts).markdown`. The screen turns the same `Note` into DOM (section 6).

**Keys are not `Data`.** They are escaped like all text and checked by the guard as keys. Titles, names and the release are `Data`.

**`escapeMarkdown`.** Order: control and bidi characters become a space or disappear; backslash first, then each of `` ` * _ ~ [ ] < > | & # $ ``; then runs of spaces collapse and the string is trimmed. `\` before an ASCII punctuation character is a literal in CommonMark and GFM, tables included (`\|`). The test helper `splitRow` splits on a `|` preceded by an even number of backslashes and `unescape` removes a backslash before ASCII punctuation; both are used by the properties.

**The template** (the Friday note; the golden file is generated, this is the shape with real numbers from the engine):

```
# Death certificate

Release: Hollow Bank app 3.2

Freeze: Fri 2026-11-20 18:00 (Europe/Madrid)

As of: Mon 2026-11-16 09:00, the start time of the board

## The cut

The team has 59 points before the freeze. With a 0 % reserve, 59 points are available.

- Kept inside: 12 tickets, 59 points, saved cost of delay 167.
- Left outside: 7 tickets, 129 points, cost of delay 101.
- Waiting for the next release costs 202 for all of them (cost of delay × 2 weeks).

## Will it hold?

Estimates are simulated between 80 % and 150 % of their value on 1,000 nights, measured against all 59 points of the team.
The cut holds on 0 of 1,000 nights (0 %).

## Left outside

| Key | Title | Points | Cost of delay | Waiting cost (× 2 weeks) | Reason |
|---|---|---:|---|---:|---|
| HB-119 | Core ledger migration | 48 | value 8 + urgency 5 + risk 8 = 21 | 42 | Does not fit: needs 48 points, 0 left. |
| HB-112 | Multi-currency wallet | 21 | value 5 + urgency 2 → 8 + risk 3 = 16 | 32 | Does not fit: needs 21 points, 0 left. |
| HB-117 | Onboarding rewrite | 21 | value 8 + urgency 3 + risk 5 = 16 | 32 | Does not fit: needs 21 points, 0 left. |
| HB-111 | Savings goals | 13 | imported cost of delay 14 | 28 | Does not fit: needs 13 points, 0 left. |
| HB-110 | Spending insights widget | 13 | value 5 + urgency 2 → 5 + risk 3 = 13 | 26 | Does not fit: needs 13 points, 0 left. |
| HB-114 | FX rate alerts | 5 | value 5 + urgency 3 + risk 3 = 11 | 22 | Follows HB-112, which is left outside. |
| HB-108 | Transaction search | 8 | value 5 + urgency 2 + risk 3 = 10 | 20 | Does not fit: needs 8 points, 0 left. |

## Zombies

A ticket is a zombie when leaving it out again makes 3 releases in a row. Its urgency climbs a step on the scale for each release it is left out.

- HB-112, Multi-currency wallet: left out 3 releases; urgency 8 now, 13 if left out again.
- HB-110, Spending insights widget: left out 2 releases; urgency 5 now, 8 if left out again.

## Put down (Won't Do)

None.

## People away

None.

## Exhumed by decision

None.
```

(These sample numbers come from running the existing engine on the sample board; the zombies are listed in the same order as the table, by waiting cost then key.) The cost-of-delay cell reuses the wording of `formulaText` in `text.ts`; a test asserts that the two give the same string for every ticket of the sample, so the two cannot drift. Singular forms ("1 ticket", "1 release", "1 week") are chosen by the template from the count. Pushed-out rows read "Pushed out by the exhumed HB-108: needs 5 points, 0 left." The impossible note is the header, one paragraph ("The must-haves need 63 points; there are 59 (59 after the 0 % reserve).") and one list item for each must-have blocked by a put-down.

The template and the code of the three files avoid the words banned by `purity.test.ts` (`document`, `window`, `process`, `performance`, `crypto`, `fetch`, `navigator`, `require`), including in strings.

## 6. The UI

**Services.** `Services.clipboard: { writeText(text): Promise<void> }` (rejects when there is no Clipboard API or the browser refuses) and `Services.files: { save(name, text, type): void }`. The browser default of `files` makes the `Blob`, the object URL and a temporary link with `download`, clicks it, removes it, and calls `URL.revokeObjectURL` through `services.timers` after 1,000 ms. The harness gets `RecordingClipboard` (a mode to accept or refuse) and `RecordingFiles`.

**The input.** `nightInputOf(state, release)` is `{ home: state.home, board: state.board, freeze: freezeFor(state), away: state.away, release }`. `freezeFor` already uses the sample's constant `now`.

**The component.** `mountCertificate({ ctx, page, header, main, release })` returns `{ isOpen, open(opener), openForTour(), close(), destroy() }`. It builds the overlay once, hidden, as a child of `page` after the live regions, and fills it on open.

```
div.certificate[hidden]            role=dialog aria-modal=true aria-labelledby=certificate-title
  div.certificate-sheet
    div.certificate-head           h2#certificate-title (tabindex -1) + Copy, Download .md, Close
    p.certificate-status           role=status
    textarea.certificate-fallback  readonly, hidden until Copy is refused
    div.certificate-body           the Note as DOM: h3, p, ul, div.certificate-table-scroll[tabindex=0][role=region][aria-label] > table
```

The controls sit in the head so a long table never pushes them below the fold. The note's `title` block is the h2; `heading` blocks are h3.

| | Modal (the user) | Tour mode |
|---|---|---|
| Opened by | the Tools button | the tour's `show('certificate')` |
| Focus | to the title; Tab wraps inside; returns to the opener on close | not moved, not trapped |
| Page behind | `header`, `main`, skip link `inert` | the tour already made `main` inert; the view is itself `inert` and `aria-hidden` |
| `Esc` | closes (stops propagation, so a visible `#play` prompt stays) | the tour's own `Esc` stops the tour, and the tour closes the view |
| Position | fixed, whole screen, centred sheet | fixed, `bottom: 18rem` (the room the tour already keeps for its bar), no scrim |
| Body scroll | from the top | to the "Left outside" heading |

Opening computes `nightFacts(nightInputOf(state, release))` and builds the DOM from `certificateNote(facts)`; an engine error shows the status line "The note could not be made." and nothing else (a defensive branch the sample never reaches; one test). The Markdown string is made once, at open, and is what Copy writes and Download saves.

**Copy.** `await services.clipboard.writeText(markdown)` inside the click. Success: the status line. Failure (rejection or no API): show the text area with the Markdown, `focus()` and `select()` it, and set the other status line. No `execCommand`.

**Download.** `services.files.save('death-certificate-' + facts.freeze.date + '.md', markdown, 'text/markdown;charset=utf-8')`; the name for an impossible night is the same.

**Tour.** In `render/tour.ts` the host's `show(show)` maps `'certificate'` to `certificate.openForTour()`; any other `show`, `stop`, `ended` and `dispose` call `certificate.close()`; the player's phase `playing` calls `close()` before the first scene. The page host function `regionOf` is unchanged for the other regions. `mountTour` gets the controls as an optional option, so an app mounted without them still works.

**Styles.** Palette tokens only. The sheet is a night panel with a bone border (the sign and the bar already use that look); the title in the painted face; headings in the marker face; body text in the body face at the page's size; table cells at 1rem with the table inside its scroll box; the text area in the mono face. The scrim is `color-mix` over a token if `tokens.test.ts` allows it, otherwise a token with no transparency. Nothing animates.

## 7. The tour scene

New scene, after "someone-insists":

```ts
{ id: 'certificate', actions: [], caption: () => 'One note for the stakeholders: what is out, and why.', durationMs: 4000, show: 'certificate' }
```

| # | Scene | Seconds | Characters | Chars/s |
|---|---|---|---|---|
| 1–6 | unchanged | 32.0 | | |
| 7 | certificate (new) | 4.0 | 52 | 13.0 |
| 8 | fog-zero | 4.5 (was 5.0) | 48 | 10.7 |
| 9–11 | fog-10, fog-15, fog-20 | 3.5 each | 46 | 13.1 |
| 12 | message | 3.5 (was 4.5) | 46 | 13.1 |
| 13 | close | 4.5 (was 5.0) | 65 | 14.4 |
| | **Total** | **59.0** | | max 14.4 |

The subtitle has no number, so it needs no provenance. The player, `simulate.ts` and the restore do not change. The simulated tour runs the scene's `show` only in the page host, so `simulate.ts` and the generated document need to know nothing more than "the app opens the death certificate" (`doc.ts`). The button label stays "Play the night · 60 s".

## 8. Tests

| File | What it checks |
|---|---|
| `tests/engine/guard.test.ts` | the token table of Requirement 2.2 row by row; signs; `1,000`; `13 %`; dates and times not read as numbers; keys of odd shape; spans by position (a title `5` does not hide a wrong `5`); decimals; number words; never throws on any string; the bite tests of 5.4 |
| `tests/engine/facts.test.ts` | the sample at Friday 18:00 and after the tour's actions (every field); the four reasons; leave-one-out on a hand-made board (two exhumes, one culprit; two needed together; none); equality with `solveFreeze`, `simulateFog` and `fogCurve`; the impossible night; unknown name in `away`; permutation property |
| `tests/engine/certificate.test.ts` | sections and order; the table row of a title with every special character (Requirement 3.3, 3.4); `P24`; the note of an empty board and of an impossible night; the template has no digit and no number word; no-promise scan; no mutation of the input; `formulaText` equality |
| `tests/ui/epitaph-guard.test.ts` | `P12` over generated states, plus the three reasons of the templates by example |
| `tests/ui/certificate-golden.test.ts` | the two files of `docs/examples/` by file snapshot; both pass the guard |
| `tests/ui/certificate-view.test.ts` | the button; opening; roles; focus in, trap, `Esc`, focus out; `inert` set and removed; the view equals the Markdown cell by cell; Copy success, refusal and fallback; Download (name, text, type, URL revoked once); a hostile title shown as text (no element created); an empty board; an impossible night; tour mode (no focus move, `inert`, closes) |
| changed | `purity.test.ts` (API list gains `deathCertificate`, `certificateNote`, `renderCertificate`, `guardCertificate`, `escapeMarkdown`, `nightFacts`, `extractTokens`, `guardFacts`, `checkNumbers`); `traceability.test.ts` (P12 and P24, and the scan reads `tests/ui` too); `slots.test.ts` (certificate removed from the slot list; the Tools region keeps three slots); `tour-script.test.ts` (13 scenes, 59 s, captions, `show` list, `docs` strings); `render-tour.test.ts` (the certificate scene); `a11y.test.ts`; `harness.ts` |

**Generators.** `arbTitle` (strings with `|`, `\`, backticks, `*`, `_`, `#`, `<script>`, `&#49;`, newlines, digits, emoji, an empty string); `arbNight` builds a board from `arbBoard({ maxTickets: 30, withWontDo: true })` with titles from `arbTitle`, a zombie threshold of 1 to 3, then applies up to three random engine `exhume` and `putDown` calls on buried keys (skipping the rejected ones), picks a reserve, a freeze from the ten slot ends of the week, and a random subset of the team as away.

**Mutation checks** (one at a time, on a copy of the file, each reverted and re-run): the eight of Requirement 5.5.

## 9. Real browser

A small script (headless Chrome through the DevTools protocol, as in the earlier specs, in `%TEMP%`, deleted afterwards), run on `npm run build` output served locally so the policy applies:

1. 1280 × 720, 360 × 740 and 320 × 640: open the view; measure `scrollWidth` of the page; scroll the table box; check Tab, `Esc` and the focus; screenshots.
2. Download: `Browser.setDownloadBehavior` to a temporary folder, click, compare the file with the page's Markdown; read the console for policy violations.
3. Copy: `Browser.grantPermissions` for the clipboard, click, read it back; then deny and check the fallback.
4. The tour to the new scene at the three widths; the run time.

## 10. Risks

- **The CSP and the download** (D12). Checked first.
- **The headless clipboard** may need page focus and a user gesture; the CDP click supplies the gesture. If it still refuses, the fallback is what gets verified and the report says so.
- **Guard false positives** on a title that is not data: not possible, titles are always data. On a ticket key with an unusual shape: handled by passing the keys.
- **Leave-one-out cost** on 80 tickets with many exhumes: at most `1 + exhumes` solves, only when the note is made. A test measures a worst-looking board and reports the time.
- **A tour tight at 59.0 s**: the measured run is 59.1 s or so; the night-tour spec accepts 1 s.

## 11. What changed while implementing (after your review)

- **Leave-one-out costs 1 + 2 x exhumes solves**, not 1 + exhumes: besides the night with every exhume undone, each exhume is solved alone (to see if it is enough by itself) and undone alone (to see if it is needed). A ticket that one exhume pushes out alone is named with `together: false`; a ticket that only a group pushes out is named with all the exhumes whose undoing alone brings it back (all of them if none does) and `together: true`, and its reason reads "together (none of them is enough alone)". Several exhumes that are each enough alone read "(any of them is enough alone)". The exhumed section says "together with ..." for the joint case. This is the addition you asked for in decision 2.
- `Text` has a third piece, `KeyRef` (a key is escaped like any text but is not ignored by the guard). `renderNote` is exported next to `renderCertificate`; `plainText` is exported for the screen.
- `GuardFacts` is `{ numbers, words, keys }`: signs are read from the numbers themselves (a negative fact is a negative number), so there is no separate set of negatives.
- A known key that is only the start of a longer key-shaped word (`T` in `T-7`) is not that key; found by a test of a wrong key.
- The view's DOM exists only while it is open (a closed note leaves no heading or text area on the page). In tour mode its Copy, Download and Close buttons and its status line are hidden (nobody can press them), and the sheet stops at `bottom: 14rem`, just above the bar.
- The tour scene is scene 7 of 13; the tour is 59.0 s.
