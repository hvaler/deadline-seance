# Design: night-chronicle
Read with `requirements.md` (decisions D1 to D10). Dependencies point one way: `ui` → `engine`; the engine gets one new module and one new optional input; nothing else in the engine changes.
## 1. Shape of the change
| Where | What |
|---|---|
| `src/engine/chronicle.ts` (new) | `DecisionFacts`, `decisionEffect(before, after)`, `describeDecision(facts): Text`, `describeUndo(...)`. Pure; no state, no DOM, no clock. |
| `src/engine/facts.ts`, `certificate.ts`, `index.ts` | `NightInput.decisions?`, `NightFacts.decisions`, the last section of the note, exports. |
| `src/ui/model.ts` | `AppState.chronicle`, `Entry`, `Chronicle`, three new actions, `Subject` unchanged. |
| `src/ui/chronicle.ts` (new) | Pure state functions: `recordEntry`, `undoTo`, `canUndo`, `CHRONICLE_CAP`. No DOM. |
| `src/ui/state.ts` | The reducer calls them; `decide(state, action)` helper for tests and for the one place that needs "action plus settle". |
| `src/ui/gestures.ts`, `render/candle.ts`, `render/sign.ts` | `onSettle` also receives the start state; the two parts dispatch `chronicle/settle`. |
| `src/ui/render/chronicle.ts` (new), `app.ts`, `context.ts`, `keys.ts` (new) | The panel, `ctx.undo`, the Ctrl+Z handler. |
| `src/ui/night.ts`, `tour/*`, `render/tools.ts` | `nightInputOf` passes decisions; the tour's wrapper; the slot goes. |
## 2. The state
```ts
interface Chronicle {
  readonly entries: readonly Entry[];   // oldest first; at most CHRONICLE_CAP (50)
  readonly dropped: number;             // how many older entries the cap removed
}
interface Entry {
  readonly no: number;                  // dropped + position + 1 when written; never changes
  readonly facts: DecisionFacts;        // from the engine's module; the sentence is computed from it, never stored
  readonly before: Omit<AppState, 'chronicle'>;   // reference to the immutable state before the decision
  readonly previous: Chronicle | null;  // only for load / sample: the chronicle of the board that was replaced
}
```
`AppState.chronicle: Chronicle`, `EMPTY_CHRONICLE = { entries: [], dropped: 0 }` (one shared object). `initialStateFor` sets it. `before` has no chronicle, so no chain of states grows behind it: after a drop nothing points to
the dropped entry. `previous` is the one deliberate link, and only a load or sample entry has it; it dies with that entry.
Why `facts` and not the sentence: the panel, the announcement and the certificate build their text from the same facts with the same function, so they cannot differ, and the certificate's guard sees the numbers as facts.
## 3. Actions and reducer
```ts
| { type: 'chronicle/settle'; from: AppState; subject: Subject }   // a candle or reserve gesture ended
| { type: 'chronicle/undo'; to: number }                           // index into entries; to = last index is "Undo"
| { type: 'tour/step'; action: Action }                            // only the tour sends it (as state/restore)
```
- `candle/set` and `reserve/set` keep their behaviour and write nothing (they are the steps of a gesture).
- `chronicle/settle`: ignored unless `from.chronicle === state.chronicle` (something else was written during the gesture: the entry would lie) and `from.board`, `from.away` and the subject's two values really differ.
  The facts come from `compareStates(from, state)` (both solves are cached: `from` was solved when it was shown, `state` when the last step was applied).
- Discrete decisions (`survivor/toggle`, the three tombstone actions when the engine applied them, `board/reset`, `board/load`, `board/sample`): after computing `next` and its `Change`, the reducer calls
  `recordEntry(state, next, subject, comparison)`. A refused or rejected change is returned as today, with no entry. A reset that returns the same night (same `board`, `candle`, `marginPct`, `away`) is `{...state, change}` with no entry.
- `recordEntry(before, after, subject, comparison)`: `no = before.chronicle.dropped + before.chronicle.entries.length + 1`, or 1 when the action is `board/load` or `board/sample` (decided by the action, not by comparing boards: "back to the sample" is a new night even when the sample is already loaded). Then the new chronicle is `{ entries: [entry], dropped: 0 }` and
  `entry.previous = before.chronicle`. Otherwise the entry is appended (a `board/reset` carries the old chronicle over: `initialStateFor` starts with the empty one, the reducer puts the old one back before appending); if there are 51, `slice(1)` and `dropped + 1`.
- `chronicle/undo { to }`: `undoTo(state, to)`: `entry = entries[to]` (out of range: return `state`, the same object, so nobody is notified);
  `chronicle = entry.previous ?? { entries: entries.slice(0, to), dropped }`; result = `{ ...entry.before, chronicle, sound: state.sound, release }` with `release = entry.before.home === state.home ? state.release : entry.before.release`
  (D10). It writes no entry.
- `tour/step { action }`: `const next = reducer(state, action); return next === state ? state : { ...next, chronicle: next.home === state.home ? state.chronicle : EMPTY_CHRONICLE }`. One wrapper for the player and for `simulate.ts`. `state/restore` is untouched: it returns the snapshot, chronicle included, so it is the same object by construction.
- `decide(state, action)` (exported from `state.ts`, used by tests and by the P25 generator): for `candle/set` and `reserve/set`, `reducer(reducer(state, action), { type: 'chronicle/settle', from: state, subject })`; for everything else, `reducer(state, action)`. The page does not use it: a drag sends many steps and one settle.
### Why not log in `candle/set` and merge
Merging consecutive entries while "open" would put a line in the panel during the drag and need a close action anyway. The brief says on settle; this does exactly that and keeps the reducer's steps pure and cheap.
## 4. Undo and the previous state
P25 needs "previous state, deep equal". Three things could break it, each handled:
- `change`: restored as it was (the sign shows the last decision still in force; after undoing everything, "Nothing has moved yet.").
- `sound`: live. A tour can already do this; it is a preference.
- `release`: live when the board is the same, else the previous board's (a load replaced it).
The fog and solver caches are keyed by board identity, candle, reserve and team, and `before.board` is the same object, so the restored state hits the caches: undo costs no solve.
`ctx.undo(to)` (in `app.ts`): flush pending gestures (each gesture's `commit()`, so its entry exists), pick `to`, compute `target = undoTo(store.getState(), to)` only for the text (the reducer does it again; both pure), build the announcement from
`decisionEffect(solveState(live), solveState(target))`, dispatch `chronicle/undo`, then `announcer.say` or `alert`, then `services.sound.play('undo')` if `state.sound` is on (the one sound event not chosen from a `Change`), then move focus (Requirement 11.6). The tour's restore goes through `restoreInto`, not `ctx.undo`, so it is silent.
## 5. The engine module
```ts
type DecisionSubject =
  | { kind: 'candle'; weekday: string; time: string }       // "Wed", "18:00": the candle step carries them as data
  | { kind: 'reserve'; from: number; to: number }
  | { kind: 'away' | 'back'; name: string }
  | { kind: 'exhume' | 'resurrect' | 'put-down'; key: Key }
  | { kind: 'reset' }
  | { kind: 'load'; file: string; tickets: number; skipped: number }
  | { kind: 'sample'; tickets: number };
type DecisionEffect =
  | { kind: 'diff'; raised: DiffEntry[]; sunk: DiffEntry[]; codDelta: number }
  | { kind: 'impossible'; stillImpossible: boolean; needed: number; available: number }
  | { kind: 'possible-again'; kept: number; savedCod: number }
  | { kind: 'totals'; before: number; after: number }       // both solved, but no ticket-by-ticket diff
  | { kind: 'new-board' };
interface DecisionFacts { no: number; subject: DecisionSubject; effect: DecisionEffect }
```
`decisionEffect(before: Solution, after: Solution): DecisionEffect` is the only place the effect is computed: both solved and `diffSolutions` ok → `diff`; `diffSolutions` error → `totals` (`savedCod` of each); `after` impossible → `impossible`
(`needed`, `effectiveCapacity`; `stillImpossible` when `before` was too); `before` impossible and `after` solved → `possible-again` (`kept.length`, `savedCod`).
A load or sample has `new-board` (the UI chooses it from the action, as `Comparison` does today).
`describeDecision(facts): Text` returns the pieces of the certificate model (`string | Data | KeyRef`): names and file names are `Data`, keys are `KeyRef`. `plainText` gives the panel's string; the certificate uses the same pieces.
Grammar, exactly (`→` is U+2192, the minus U+2212):
```
line      = what " → " effect [ " (" signed ")" ]
what      = name " leaves" | name " is back" | "Freeze moved to " weekday " " time | "Reserve " to " %" | "Exhumed " key | "Resurrected " key | "Put down " key
          | "Reset" | "Loaded " file ": " n " open tickets" (singular for 1) | "Back to the sample board: " n " tickets"
effect    = parts joined by "; " | "no change"            (diff, both lists empty: no brackets)
parts     = [ subjectIn ] [ keys " in" ] [ keys " out" ]    subjectIn = "in" or "in, with " keys  (exhume/resurrect, when the subject is in diff.raised)
          | "impossible: needs " n " point(s), " m " available" | "still impossible: needs …" | "possible again: " k " in, saved cod " c
          | "saved cod " a " → " b                          (totals)
signed    = "+" n | "−" n | "0"
```
`new-board` has no effect part: `Loaded crm.csv: 14 open tickets`; `skipped` is dropped from the line (the banner already says it).
`describeUndo(entry facts, effect): Text` builds the announcement of Requirement 5 from the diff between the live and the restored state; the count in "Undone 3 decisions" is a list length passed in by the UI (`undone`).
A test keeps `describeDecision` and the existing `changeNote` consistent where they overlap (the same keys, the same impossible numbers).
### The guard
`guardFacts([facts], { keys })` reads the numbers of `DecisionFacts` (values, signs included), the weekday and time strings, and the keys. `no` is a fact (the certificate's `1 ·` is a token), `codDelta` is a fact (negative for a loss; the guard accepts the minus U+2212).
`tests/ui/provenance.ts` is used for the panel and announcements: the facts are the entry's `DecisionFacts` plus the compared solutions' totals. No new rule.
## 6. Real numbers (sample board, measured with the reducer before writing this)
The sequence: Friday 18:00, no reserve, nobody away, 12 in (59 of 59), saved cod 167.
| # | Decision | Engine's diff | Line |
|---|---|---|---|
| 1 | Reserve to 20 % | out HB-113 (14), HB-115 (13); delta −27 (167 → 140) | `Reserve 20 % → HB-113, HB-115 out (−27)` |
| 2 | Reserve back to 0 % | in HB-113, HB-115; delta +27 | `Reserve 0 % → HB-113, HB-115 in (+27)` |
| 3 | Candle to Mon 13:00 | impossible: needs 15, 6 available | `Freeze moved to Mon 13:00 → impossible: needs 15 points, 6 available` |
| 4 | Candle to Fri 18:00 | was impossible | `Freeze moved to Fri 18:00 → possible again: 12 in, saved cod 167` |
| 5 | Candle to Wed 18:00 | out HB-105 (11), HB-113 (14), HB-115 (13), HB-118 (16); delta −54 (167 → 113) | `Freeze moved to Wed 18:00 → HB-105, HB-113, HB-115, HB-118 out (−54)` |
| 6 | Ana away | in HB-105; out HB-104, HB-106, HB-107, HB-116; delta −34 (113 → 79) | `Ana leaves → HB-105 in; HB-104, HB-106, HB-107, HB-116 out (−34)` |
| 7 | Put down HB-112 | nothing moves | `Put down HB-112 → no change` |
| 8 | Exhume HB-108 | in HB-108 (10); out HB-105 (11), HB-109 (15); delta −16 (79 → 63) | `Exhumed HB-108 → in; HB-105, HB-109 out (−16)` |
| – | Exhume HB-119 (rejected: needs 63, 35 available) | no entry | the change note says it, as today |
The golden "tour" certificate is made from 5 (candle), 6, 7 and 8: four decisions, numbered 1 to 4. Task 2.3 re-measures all of this through `decide` and the new engine module and fixes the table in the report; the wording may change, the board and the numbers may not.
## 7. The gesture hook
`GestureOptions.onSettle(change, end, start)` gains a third argument, the state at the start (`began`, already kept). `candle.ts` and `sign.ts`: `onSettle: (change, end, start) => { ctx.record(start, change.subject); ctx.settle(change, end); }`.
`ctx.record` dispatches `chronicle/settle`; it runs before the announcement so the panel is in step when the text is spoken. The rest of `gestures.ts` (frame batching, the 300 ms) is untouched.
`ctx.flush()` (new): `commit()` of every registered gesture; the candle and the sign register at mount. Used by `ctx.undo` and by nothing else.
## 8. The panel
```
<section class="region region-chronicle" data-region="chronicle" aria-labelledby="h-chronicle">
  <h2 id="h-chronicle">Night chronicle</h2>
  <p id="chronicle-help">Every decision of tonight, newest first. The number in brackets is the change in saved cod.</p>
  <p class="chronicle-dropped" hidden>The 3 oldest decisions are not listed and cannot be undone.</p>
  <button data-action="undo" aria-describedby="chronicle-help" disabled?>Undo</button>   <!-- text: "Undo" ; reason when disabled in a visible line -->
  <div class="chronicle-list" tabindex="-1" role="region" aria-label="Decisions, newest first"> <!-- fixed height, overflow-y:auto -->
    <ol> <li value="3"> <span class="entry-no">3</span> <span class="entry-text">…</span> <button>Undo to here</button> </li> … </ol>
    <p class="chronicle-empty">No decisions yet. …</p>
  </div>
</section>
```
- The list container is focusable only for keyboard scrolling (`tabindex="0"` when it overflows, `-1` otherwise; set after layout, not on every update) and has an accessible name.
- Updates reuse nodes by entry number (`syncTexts`-style keyed sync as `grounds.ts` does) so a screen reader is not re-read the whole list; the region is not `aria-live` (the announcer speaks).
- The panel sits between `survivors` and `grounds` in `REGIONS`. Its height is `--chronicle-h` per breakpoint, **measured** in task 6.4 from the longest realistic line at 1280, 360 and 320 px (the sample's longest line is the `Mon 18:00` candle move) plus the empty state; the value goes in the report.
  The page's `main` grid already has a gap; adding entries changes nothing outside the box.
- The newest entry has no "Undo to here". Names: `Undo to here: before 3, Exhumed HB-108`.
- CSS: palette tokens only; sizes in `rem`; `overflow-wrap: anywhere`; `min-width: 0` on grid children (as `.region` does); buttons 44 px; a left border in `--accent` on the newest line is decoration only (no meaning).
## 9. Ctrl+Z
`src/ui/keys.ts`: `isTextField(target)` (input types text, search, email, url, tel, password, number, `textarea`, `select`, `isContentEditable`), `isUndoKey(event)` (key `z`, case-insensitive; `ctrlKey` xor `metaKey`; no `shiftKey`, no `altKey`).
`app.ts` registers one `keydown` on the document (bubble): ignore if `defaultPrevented`, the tour is running (`page` has `is-touring`) or the certificate dialog is open (`certificate.isOpen`), or `isTextField(event.target)`; then
`ctx.undo(last)`; `preventDefault` only when it acted or said "Nothing to undo.". The tour's capture handler for Space/Enter and the certificate's Escape handler do not use Z, so there is no clash.
## 10. The tour
Player and `simulate.ts` dispatch/reduce `{ type: 'tour/step', action }` for every scene action (the host's `act` wraps; `ctx.act` is unchanged for everyone else). No scene or caption changes. `restoreInto` is unchanged.
While the tour runs, the panel shows the state's chronicle. Two cases: the user's board is the built-in sample (the tour's first scene `board/sample` gives the same `home`), so the user's entries stay on screen, unchanged and inert;
or the user's board is a CSV (`home` changes), so the panel is empty during the tour. The panel is inside the inert `main` and Undo is unreachable. Tested for a session on the sample with entries, a session with a CSV and entries, and a fresh session.
## 11. The certificate
`NightInput.decisions?: { entries: readonly DecisionFacts[]; dropped: number }`. `nightFacts` copies it into `NightFacts.decisions` (`null` when absent). `certificateNote` adds, last, for both notes:
```
## Decisions tonight
The 3 oldest decisions are not listed.        <- only when dropped > 0
- 1 · Freeze moved to Wed 18:00 → HB-105, HB-113, HB-115, HB-118 out (−54)
```
`null` adds nothing (MCP unchanged: its tests and `docs/mcp.md` stay as they are). `[]` adds the heading and "None.". `nightInputOf(state)` gives `{ entries: state.chronicle.entries.map(e => e.facts), dropped }`.
Names in `Data`, keys in `KeyRef`, so `renderNote` escapes and records the data spans, and `guardCertificate` ignores them by position; the key set already holds every key of the board and the put-down list.
The two golden files get the new last section only; the test reads the committed file, strips the section, and compares with the old text it replaces (kept in the test as a constant). In the Friday note the section is `None.`.
## 12. Tests
| File | Tests |
|---|---|
| `tests/engine/chronicle.test.ts` (new) | grammar examples of §5 and §6; `decisionEffect` equals `diffSolutions` when both solved; impossible, possible-again, totals; generated facts always pass the guard; the sentence never has a digit that is not a fact; singular/plural; no promising words; the section in the certificate: present with `[]`, absent with none, order of items, `dropped` line, P24 extended with generated chronicles (names with Markdown and digits). |
| `tests/ui/chronicle.test.ts` (new) | `P25 undo returns the previous state` (the property of Requirement 12.1: generated boards and sequences, including rejected, refused and no-op actions, gestures, loads, away and back; also `P25 ...` for "undo everything" in its own test if fast-check shrinking is clearer); reducer examples (which actions write, which do not); one entry per gesture; the cap (51, 120, undo to the oldest listed, the dropped line, a dropped load entry); Undo to here; a load undone restores board and chronicle; `release` and `sound` rules; refused/rejected write nothing; reset on a pristine night writes nothing. |
| `tests/ui/chronicle-view.test.ts` (new) | panel structure and names; empty state; newest first with `value`; keyed update; focus after undo; disabled Undo; announcements (once, polite or alert, texts); provenance of every sentence; Ctrl+Z, Cmd+Z, text field, range focus, Shift, tour running, dialog open, nothing to undo; XSS in name and file; Plan B (45 tickets) gesture entry; the layout class-level checks. |
| `tests/ui/tour-player.test.ts`, `tour-script.test.ts` | the tour writes nothing; restore returns the same chronicle (`toBe`) for three starting sessions; stop at any tick; the simulation and the player still agree. |
| `tests/ui/slots.test.ts`, `app-shell.test.ts`, `certificate-golden.test.ts`, `traceability.test.ts` | edited on purpose (Requirement 12.4). |
P25 generator: boards from `tests/engine/generators.ts` with the sample's team put in (a generated board with no people has capacity 0 and every freeze is impossible, which would test only that); the candle steps stay the sample's. Sequences of up to 30 actions, shrinking on. The properties run with `numRuns` as the other UI properties do; boards stay at most 12 tickets so the fog curve comparison is cheap.
## 13. Risks
- `AppState` gains a field: every place that builds one by hand (tests) must go through `initialStateFor`; a search for object literals typed `AppState` is task 1.1.
- `before` states keep boards alive: bounded by the cap (50 entries, each at most one board object newer than the last), and a dropped entry frees its states.
- A chronicle line says "in" for what the engine's diff says rose. If the diff and the line ever disagreed, P25's equality and the engine test (line from facts, facts from the diff) fail first.
- Ctrl+Z on a range input has no native undo; if a browser treated it as a text field the handler would not run. Checked in Chrome and Firefox in task 8.
- The 11-row layout of the page grows by the panel's height: the "no jump" claim is about entries being added, not about the one-time room the panel takes.
