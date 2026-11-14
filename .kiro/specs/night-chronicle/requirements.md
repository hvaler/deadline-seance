# Requirements: night-chronicle
Scope: product feature 6, the last one. A log of every decision of the night, each with its effect written from the engine's diff, and step-by-step undo
(Undo, Undo to here, Ctrl+Z). Also: P25 as a property test, a "Decisions tonight" section in the death certificate, and the chronicle's place in the tour
and in Plan B. Everything it shows comes from the engine at that moment (`docs/rule.md` §6 and P25; `board-ui`, `fog`, `night-tour`, `death-certificate`).
Out of scope: redo (Requirement 7), any change to the MCP server, a new tour scene, an LLM, saving the chronicle between visits (no backend, no storage),
and any new rule: the chronicle decides nothing and computes nothing.
## Introduction
A lead moves the candle, sends Ana away, exhumes a ticket, and ten minutes later asks "what did we do, and what did each thing cost?". The chronicle answers
with one line per decision ("Ana leaves → HB-109 out (−15)") and lets the lead go back, one step or to any earlier line, without redoing the work.
## Decisions (the questions the brief left open)
| # | Question | Decision | Why |
|---|---|---|---|
| D1 | Where does the chronicle live? | In `AppState` (`state.chronicle`), written by the reducer. | One mechanism for undo, for the tour's restore (`state/restore` already returns a whole state) and for the certificate. A second store could drift from the state it describes. |
| D2 | Which actions are entries? | Candle moved, reserve changed (both once per gesture, on settle), person away, person back, exhume, resurrect, put down, reset, load a CSV, back to the sample board. | The list in the brief. |
| D3 | Which clear the chronicle? | None erases it. **Load a CSV** and **back to the sample board** start a new chronicle: its entry 1 is the load. That entry keeps the previous chronicle, so undoing entry 1 brings back the previous board and its whole log. | A new board makes the old lines about other keys meaningless on screen and in the certificate, but a mistaken load should not destroy a night. P25 holds for every action, loads included. |
| D4 | What is not an entry? | Sound on/off, the release name, an exhume the engine rejects or refuses (nothing was decided), a gesture that ends where it began, a reset that changes nothing, and everything the tour does. | They do not change the night, or they did not happen. |
| D5 | Order | **Newest first.** | The panel has a fixed height and scrolls inside. The line Undo acts on is always at the top, visible with no scrolling and no script moving the scroll. The certificate lists oldest first (the story). |
| D6 | Cap | 50 entries. | Memory stays bounded; a night has far fewer decisions. |
| D7 | Redo | **No.** | See Requirement 7. |
| D8 | Certificate | Yes: a "Decisions tonight" section. | See Requirement 10. |
| D9 | Where on the page | A region "Night chronicle" between Survivors and the two grounds. Alternative: in Tools, replacing the slot (it is the slot's place today, but it is the last thing on a page 2,700 px tall). | The decisions are made in the sign, candle and survivors above it; the panel sits right under them. |
| D10 | What does undo restore? | The whole state before the entry, except `sound` (a preference, as in the tour's restore) and, when the board loaded is the same, `release` (a label, not a decision). | Exactly the previous night, without throwing away what the user typed since. |
## Glossary
- **Decision**: a user action in the list of D2 that changed the night.
- **Entry**: one line of the chronicle: number, the decision's facts, and the state before it.
- **Chronicle**: the entries of the current board, oldest to newest, plus how many older ones were dropped by the cap.
- **Effect**: the engine's diff between the cut before and after the decision (what rises, what sinks, the change in saved cod).
- **Undo to here**: go back to the state before a chosen entry; that entry and every later one are removed.
## Requirements
### Requirement 1: What gets an entry
**User Story:** As a lead, I want every decision of the night in the log, once, so that I can read what was done.
#### Acceptance Criteria
1. THE reducer SHALL write one entry, in the same step that changes the state, for each of: `survivor/toggle` (away or back), `tombstone/exhume`, `tombstone/resurrect`,
   `tombstone/put-down` when the engine applied them; `board/reset`, `board/load`, `board/sample`; and, once per gesture, a candle move or a reserve change.
2. A candle or reserve gesture SHALL write its entry when it settles (300 ms without input, or its `change` event; `SETTLE_MS` of `gestures.ts`), not per step: a drag across five
   notches is one entry whose effect compares the state at the start of the drag with the state at its end. A gesture that ends where it began (`subjectOf` returns null) SHALL write nothing.
   The per-step actions `candle/set` and `reserve/set` SHALL NOT write entries.
3. An action the engine rejected (an exhume that would make the freeze impossible) or refused (unknown key, not a zombie) SHALL write nothing, and the state's change note SHALL be as it is today.
4. `sound/set` and `release/set` SHALL write nothing. A `board/reset` that leaves the night as it was (same board, candle, reserve and team) SHALL write nothing.
5. THE entry SHALL be written whether the board has 5 tickets or 60 (Plan B of the fog does not apply: the entry uses the solver's diff, never the fog).
6. Entries SHALL be numbered in order, 1, 2, 3, with no clock. The number is stored in the entry, so it does not change when older entries are dropped (Requirement 6).
### Requirement 2: The line of an entry
**User Story:** As a stakeholder, I want one short sentence per decision that says what it did to the cut.
#### Acceptance Criteria
1. THE sentence SHALL be `<what was decided> → <effect> (<change in saved cod>)`, built in the engine (`src/engine/chronicle.ts`) from the facts of the decision and the diff of the two solutions
   (`diffSolutions`), nothing else. Examples on the sample board (numbers from `design.md` §6):
   - `Ana leaves → HB-105 in; HB-104, HB-106, HB-107, HB-116 out (−34)`
   - `Freeze moved to Wed 18:00 → HB-105, HB-113, HB-115, HB-118 out (−54)`
   - `Exhumed HB-108 → in; HB-105, HB-109 out (−16)`
   - `Reserve 20 % → HB-113, HB-115 out (−27)` (from Friday 18:00); a decision that moves nothing reads `Reserve 25 % → no change` (format only: on this board no reserve step is measured to do that, so a test uses a generated board)
   - `Freeze moved to Mon 13:00 → impossible: needs 15 points, 6 available`
2. "What was decided": `<Name> leaves`, `<Name> is back`, `Freeze moved to <Day> <hh:mm>`, `Reserve <n> %`, `Exhumed <key>`, `Resurrected <key>`, `Put down <key>`, `Reset`, `Loaded <file>: <n> open tickets`, `Back to the sample board: <n> tickets`.
3. "Effect": the keys that rise, written `<keys> in`; the keys that sink, `<keys> out`; joined with `; `, raised first, keys in the diff's order. For exhume and resurrect, the subject ticket's own rise is written as `in`
   alone (as in the examples); other tickets that came in with it (its dependencies) follow as `in, with <keys>`. A decision that moves nothing says `no change` and has no brackets.
4. THE brackets SHALL hold the signed change in saved cod (`diff.codDelta`): `−15`, `+8`, `0`. The minus is U+2212, which the guard reads as a sign. The panel explains the brackets once, in its description: "The number in brackets is the change in saved cod."
5. An impossible result SHALL say so with the engine's numbers, in the words of the existing change note: `→ impossible: needs 63 points, 59 available`; if it was already impossible, `→ still impossible: needs …`; if it was impossible and is not now,
   `→ possible again: 12 in, saved cod 167`. Where there is no ticket-by-ticket diff (a reset after a put down: the board changed), the effect is `saved cod 89 → 167`.
6. A sentence SHALL NOT be shortened: a long list of keys wraps (Requirement 11.8). Cutting a list would need a number (`and 4 more`) the engine does not give.
7. EVERY number in a sentence SHALL be a fact of that entry (the guard of `engine/guard.ts` accepts it, and `tests/ui/provenance.ts` accepts it). Names of people and files are board data: escaped and skipped by position, as the certificate does. A test builds the sentence of every entry of generated sequences and checks it.
8. THE sentence SHALL NOT promise or advise ("better", "safer", "should"): the word scan of the certificate golden test is applied to it.
### Requirement 3: Undo
**User Story:** As a lead, I want to take back the last decision, or go back to before any earlier one, with one action.
#### Acceptance Criteria
1. EACH entry SHALL keep the state before it (a reference to the immutable state, not a copy), without the chronicle inside it. A load or sample entry also keeps the previous chronicle (D3).
2. **Undo** SHALL restore the state before the newest entry and remove that entry. **Undo to here** on entry *k* SHALL restore the state before entry *k* and remove *k* and every later entry. The newest entry has no "Undo to here" (it would be Undo).
3. THE restored state SHALL be the previous state: equal by deep equality, including its change note and its chronicle (the entries before *k*), except `sound` (the live setting) and `release` (D10: kept if `home` is the same board, as the user may have renamed it since).
4. Undo SHALL write no entry, play the `undo` sound (a soft rewind, the fifth sound; `tech.md` lists five) once per undo, and only when Sound is on (for the button, "Undo to here" and Ctrl+Z alike; "Nothing to undo." plays nothing; the tour's restore never plays it), and not touch the clipboard, the files or the scroll.
5. A pending gesture SHALL be settled first (its entry written), then undone: Ctrl+Z 100 ms after a keyboard nudge on the candle undoes that nudge.
6. With no entries, Undo SHALL be disabled and `Ctrl+Z` SHALL say "Nothing to undo." (polite, once) and change nothing.
7. Undoing a load or sample entry SHALL bring back the previous board, its state and its whole chronicle exactly, and the candle, reserve, team and tickets of the page with them.
### Requirement 4: Ctrl+Z and Cmd+Z
#### Acceptance Criteria
1. `Ctrl+Z` (and `Cmd+Z`), without Shift or Alt, SHALL undo when focus is not in a text field (an `input` of a text type, a `textarea`, a `select`, or `contenteditable`). A range input (the candle, the reserve) is not a text field.
2. In a text field the key SHALL be left alone (the browser's own undo). The release-name field is such a field.
3. `Ctrl+Shift+Z` and `Ctrl+Y` SHALL NOT be taken: there is no redo (Requirement 7).
4. THE key SHALL do nothing (and not call `preventDefault`) while the tour runs or is paused, while the certificate dialog is open, and when a modifier combination other than the above is pressed. After the tour has ended and restored the state, it works again.
5. `preventDefault` SHALL be called only when an undo happened or "Nothing to undo." was said.
### Requirement 5: The announcement
#### Acceptance Criteria
1. Each undo SHALL be announced once, through the existing announcer, polite: `Undone: Ana leaves. HB-109 is back in.` (one key), `Undone: Ana leaves. HB-104, HB-106, HB-107 and HB-116 are back in; HB-105 is out again.` (several). Rule: the phrase of the decision (Requirement 2.2, without the effect), then, from the engine's diff between the live state and the restored one, the keys that rise as `<keys> is/are back in` and the keys that sink as `<keys> is/are out again`, raised first. Nothing moves: `No change in the cut.`
2. Undo to here SHALL say `Undone 3 decisions, back to before "Freeze moved to Wed 18:00". <effect>.` (the count is a list length; the phrase is the first removed entry's). The effect is the engine's diff between the live state and the restored one, not the sum of the entries' effects.
3. THE undo that results in an impossible freeze SHALL use the alert region and say so with the numbers; the one that ends it says "The freeze is possible again."
4. The text SHALL pass the provenance test: every number is in the diff, the undone entries' facts, or the new state's solution.
5. THE sign's change note SHALL show what the restored state's `change` was (Requirement 3.3). It is not rewritten to talk about the undo; the announcement and the live line of the panel do.
### Requirement 6: The cap
#### Acceptance Criteria
1. THE chronicle SHALL hold at most 50 entries. The 51st decision drops the oldest entry and adds 1 to `chronicle.dropped`; numbering goes on (the 51st decision is entry 51).
2. THE panel SHALL say so: "The 3 oldest decisions are not listed and cannot be undone." (hidden while `dropped` is 0). Undo to the oldest listed entry restores the state before it, not the start of the night.
3. THE dropped entries SHALL be unreachable: nothing keeps them alive (no `previous` chronicle or state chain points to them), so memory is bounded by 50 entries plus the previous chronicles kept by load entries (each at most 50).
4. IF the dropped entry is a load entry, the previous board's chronicle goes with it (the earlier board can no longer be recovered). THE panel line says so in the same sentence.
### Requirement 7: No redo
#### Acceptance Criteria
1. THE app SHALL NOT have redo: no button, no shortcut, no stack. Reasons, written in the design: (a) a redo stack needs its own rules for gestures, loads, the cap and the tour (a new decision after an undo empties it); each is a place for the state and the log to disagree; (b) the app is deterministic, so doing the decision again gives the same line, and the line you just undid says exactly what to do; (c) the brief asks for Undo and Undo to here, and nothing in the product principles needs more.
2. THE panel SHALL NOT show or imply a redo.
### Requirement 8: The tour
#### Acceptance Criteria
1. THE tour SHALL NOT write into the user's chronicle. Every action the tour dispatches goes through one wrapper action (`tour/step`) that runs the reducer for the inner action and leaves the chronicle as it was; if the inner action loads another board (the tour starts with `board/sample`), the chronicle during the tour is empty.
2. THE tour's restore (`state/restore` with the snapshot) SHALL bring the chronicle back exactly: the same object (`toBe`), for a tour started from a session with entries, with a loaded CSV, and with none; stopped at any tick, skipped, or ended.
3. WHILE the tour runs, Undo and Undo to here SHALL be disabled (the page is inert) and Ctrl+Z SHALL do nothing (Requirement 4.4). The chronicle panel is part of the inert `main`.
4. `tour/simulate.ts` SHALL run the scene actions through the same wrapper, so the player and the simulation still agree (the existing test compares states). No scene is added, removed or reworded; `docs/video-tour-script.md` does not change.
### Requirement 9: Plan B and boards of any size
#### Acceptance Criteria
1. On a board over the fog's threshold (`FOG_ON_SETTLE_FROM`), a candle or reserve gesture SHALL write its entry when the values settle, and the entry's text SHALL be built by the same function as on a small board: a test runs the same gesture on a 5-ticket and on a 45-ticket board and compares the two sentences' shape and their provenance.
2. WHILE a gesture is active no entry SHALL appear, and no part of the page SHALL move because of the chronicle.
3. Writing an entry SHALL cost two cached solves and one diff; no fog is computed for it.
### Requirement 10: "Decisions tonight" in the death certificate
**User Story:** As a stakeholder, I want to see how the cut was reached, in order, next to what was left out.
#### Acceptance Criteria
1. THE certificate SHALL gain a last section, "Decisions tonight": the chronicle, oldest first, one list item per entry: `<n> · <sentence of Requirement 2>`. An empty chronicle says "None.". If `dropped` is above 0, a first line says `The 3 oldest decisions are not listed.`
2. THE section SHALL be present in the short, impossible-freeze certificate too (it is how the night got there), after "Nothing can be decided…".
3. THE section SHALL appear only when the caller gives decisions: `NightInput.decisions` is optional. The MCP server gives none, so its notes, tests and `docs/mcp.md` examples do not change.
4. THE text SHALL be built from the same `Text` model as the rest (names and file names are `Data`, keys are `KeyRef`), pass `guardCertificate` (P24 extended to generated chronicles) and be the same string the panel shows for each entry.
5. THE two golden notes in `docs/examples/` SHALL be regenerated, and the change SHALL be only the new last section (a test compares the old files' content with the new files' content minus that section). The Friday note ends with `None.`; the tour's note lists its four decisions (design §6).
6. The certificate view of the page SHALL show the section (the model feeds the screen and the Markdown).
### Requirement 11: The panel
**User Story:** As a user with a keyboard, a screen reader or a phone, I want the chronicle to be as usable as the rest of the page.
#### Acceptance Criteria
1. A region "Night chronicle" (`h2`, `data-region="chronicle"`) between Survivors and the grounds, replacing the old "Night chronicle and undo" slot in Tools (that slot and its "Not built yet." note go; `slots.test.ts` and `TOOL_SLOTS` lose it).
2. It SHALL hold: the heading, a one-line description (what the lines are, and "The number in brackets is the change in saved cod."), an **Undo** button, the list (`ol`, newest first, each `li` with `value` = its number), and, per entry except the newest, **Undo to here**.
3. THE empty state SHALL read "No decisions yet. Move the candle, send someone away or exhume a ticket, and each decision is written here." Undo is disabled (`disabled`, with the reason in `aria-describedby`).
4. THE list SHALL have a fixed height (measured at 1280, 360 and 320 px, as `board-ui` did for the sign) and scroll inside itself (`overflow-y: auto`, focusable, with an accessible name), so adding an entry moves nothing: not the sign, the candle, the shelf or the yard. The list does not scroll by itself when an entry is added; the newest is at the top.
5. Each "Undo to here" SHALL have an accessible name that says which entry (`Undo to here: before 3, Exhumed HB-108`) and SHALL be a button with a visible text and a 44 × 44 px target.
6. After an undo, focus SHALL go to **Undo** if it is still enabled, else to the list container (`tabindex="-1"`); focus is never lost to `body`.
7. THE panel SHALL not use only colour to tell anything, SHALL use the palette tokens, no pixel font under 16 px, and SHALL honour `prefers-reduced-motion` (no animation is needed; an entry may fade in with `opacity` only, off in reduced motion).
8. At 320 px there SHALL be no horizontal scroll: long keys lists and names wrap (`overflow-wrap: anywhere`).
9. THE panel's text SHALL be set with `textContent` (names and file names are user data); a test with `<img onerror>` as a person's name and as a file name.
### Requirement 12: The property, the tests and the traceability
#### Acceptance Criteria
1. **P25 (reformulated)**: over generated boards (0 to 12 tickets, with a team) and generated sequences of up to 30 actions (every decision of Requirement 1, rejected and refused ones included, and gestures of one to five steps), undo after any action gives exactly the previous state (deep equal, `sound` aside) and the previous solution; the diff of the same two states, the fog curve and the certificate text are the same as they were before the action; and undoing everything returns to the first state. The test is named `P25 ...`, lives in `tests/ui/chronicle.test.ts`, and the traceability table gains `25: 'ui/chronicle.test.ts'`.
2. THE traceability test and `rule-engine`'s table SHALL list P25 as in scope (the comment "Out of scope: P25" goes).
3. Example tests SHALL pin: the lines of design §6 on the sample board; the cap (51 and 120 decisions); Undo to here; a load undone; a tour from a session with entries; Plan B; the keyboard rules; the announcement texts; the empty state; XSS; 320 px (class-level, plus the browser check).
4. All existing tests SHALL stay green except those the change must edit on purpose (`slots.test.ts`, the region order in `app-shell`, the two golden notes), each edit listed in the report.
5. `npm run typecheck`, `npm test` and `npm run build` SHALL exit 0; the engine stays free of DOM, clock and randomness (`purity.test.ts`).
6. THE bundle growth SHALL be reported (the panel is small; nothing is lazy-loaded for it).
### Requirement 13: Checks in a real browser
#### Acceptance Criteria
1. At 1280, 360 and 320 px: a sequence of decisions (a candle drag, a reserve change, Ana away and back, an exhume, a put down), the panel updating with the lines of §6, Undo, Undo to here on a middle entry, Ctrl+Z (also with focus on the candle), Ctrl+Z in the release-name field leaving the log alone, the cap's message, a CSV load then its undo, and the tour started from a session with entries and the chronicle intact afterwards.
2. No horizontal scroll at 320 px; the sign and candle do not move when an entry is added (measured by the top of each before and after); no console errors.
3. THE screenshots and the measurements go into the report.
## Out of scope, on purpose
- Redo; saving the log to a file or the browser; an entry for the release name or sound; a "why" written by an LLM; editing or deleting a single entry in the middle (only Undo to here, which removes the entry and what followed).
