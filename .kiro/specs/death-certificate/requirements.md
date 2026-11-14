# Requirements: death-certificate

Scope: product feature 4, the death certificate: a Markdown note for stakeholders on what the night leaves outside and why, and the deterministic **number
guard** that the note must pass (`docs/rule.md` §7 "El epitafio", "4. Certificado de defunción", P12, P24 and the fog section). It has three parts:

1. **Engine** (`src/engine`, pure): the facts of the current night (`facts.ts`), the number guard (`guard.ts`) and the certificate (`certificate.ts`).
2. **UI**: a "Death certificate" control that opens a readable view of the note, with **Copy** and **Download .md**.
3. **Tour**: one scene that opens the certificate, only if the tour still fits in 60 seconds at 15 characters per second.

Out of scope: any LLM call (the app has no backend and `connect-src 'none'`; the fixed template is the product, so the guard here protects the template and
is ready for a later model); the chronicle, CSV import and export, the MCP server; other languages; printing or PDF; showing the guard's verdict on the
screen. The facts and the guard are built so that the epitaph, the change explanations and a later model can use them without changes.

## Introduction

A lead who cuts scope has to explain it the next morning: what is out, why, what waiting costs, and how likely the cut is to hold. The certificate is that
explanation, written by the same engine that decided the cut, so every number in it is a fact the engine computed and none is typed by a person or a model.
A guard proves that: it reads the finished text, finds every number in it, and rejects any that is not in the facts.

## Glossary

- **Night**: what the user is looking at: the board with its exhumes and put-downs, the candle, the reserve and who is away.
- **Facts** (`NightFacts`): plain data, computed by the engine, with every number and name the note may say.
- **Note** (`Note`): the certificate as a small document model (title, headings, paragraphs, lists, one table). The Markdown and the screen are both made from it.
- **Data text**: text that comes from the board (ticket titles, person names, the release name). It is user data: escaped in Markdown, put on the screen with `textContent`, and ignored by the guard (Requirement 2.8).
- **Token**: a number-like thing the guard finds in a text: an integer, a signed integer, a time, a date, a weekday, a ticket key, a number word, a decimal.
- **Offending token**: a token that is not in the facts. The guard returns these, with where they are, not just a false.
- **Leave-one-out**: solving the same night again with one exhume undone, to see what that exhume pushed out (Requirement 1.5).

## Requirements

### Requirement 1: The facts of the night

**User Story:** As the author of the certificate, the epitaphs and later a model, I want one place that computes every fact a text may say, so that no text computes anything.

#### Acceptance Criteria

1. `nightFacts(input)` SHALL be a pure function in `src/engine/facts.ts`, exported from `src/engine/index.ts`, returning `Result<NightFacts>`. The input is
   `{ home, board, freeze, away, release }`: `home` is the board as loaded; `board` is the full team with its exhumes and put-downs applied; `freeze` is `FreezeInput`
   (`now`, `freezeAt`, reserve); `away` lists the names of the people sent away; `release` is a string or `null`. (The brief's `deathCertificate(board, state facts)` becomes
   `deathCertificate(facts)`: the facts already carry the titles. `release` is an input because the board has no name; the sample's is "Hollow Bank app 3.2".)
2. IT SHALL read no clock, no DOM and no randomness. `freeze.now` is the "as of" of the note. A name in `away` that is not on the team is an engine error (`unknown-key`).
3. FOR A SOLVED NIGHT (`status: 'ok'`) the facts SHALL contain: the "as of" and the freeze as local stamps in the board's time zone (`weekday` such as `Fri`, `date` such as `2026-11-20`, `time` such as
   `18:00`) and the zone name; the capacity, the reserve percentage and the effective capacity; the weeks to the next release; what is kept (count, points, cost of delay); the fog chance of the
   current reserve (`nights`, `holds`, `pct`, the two limits 80 and 150, and the full capacity it is measured against); what is left outside in total (count, points, cost of delay, waiting cost);
   the zombie threshold; the people away; the put-down tickets; the exhumed tickets; and the list of tickets left outside.
4. EVERY ticket left outside SHALL carry: key, title, points, cost of delay, its parts (value, urgency, urgency after hunger, risk, and the number of releases left out, or "imported" with the imported number),
   the waiting cost (`cod × nextReleaseWeeks`, the solver's own `burialCost`), whether it is a zombie, the urgency it would have after one more release left out (null for an imported cost), and its **reason**.
5. THE reason SHALL be exactly one of four, chosen in this order: (a) **blocked by a put-down**: the solver says so; it names the put-down key. (b) **follows a buried dependency**: the solver says so; it names
   the buried dependencies. (c) **pushed out by an exhume**: the solver says "no room", and the same night solved with the exhumed tickets' must-have flag taken back to the `home` board's keeps this ticket;
   it names the exhumed ticket or tickets whose undoing **alone** brings it back, and, if no single undo does, all exhumed tickets; it also carries the points needed and left. (d) **does not fit**: the solver says
   "no room" and (c) does not apply; it carries the points needed and left. The brief lists three reasons; the fourth, (a), is a state the app already has and a stakeholder must be told.
6. THE exhumed tickets are those that are must-have in `board` and not in `home`. Each carries key, title, points, cost of delay and the tickets it pushed out (with their cost of delay). Put-down tickets carry their
   key, their title (from `home`; null when `home` does not have it) and the keys of **every** ticket whose chain reaches the put-down key (not only those whose solver reason names it).
7. THE numbers SHALL be the engine's own, not recomputed: kept and outside totals equal the solver's `keptEffort`, `savedCod`, `buriedEffort`, `buriedCod`; the fog numbers equal `simulateFog` for the kept set
   against the full capacity, and the point of `fogCurve` at the same reserve; the waiting cost of the whole outside is the sum of the tickets' waiting cost. A test checks each equality on generated nights.
8. FOR AN IMPOSSIBLE FREEZE (`status: 'impossible'`) the facts SHALL carry the stamps, the capacity, the reserve, the effective capacity, the points the must-haves need and the must-haves blocked by a put-down; no cut list and no fog.
9. ORDER SHALL be deterministic and independent of the order of tickets, people and absences in the board: the outside list is sorted by waiting cost, highest first, then by key; every other list by key or name
   (`compareKeys`). A property test permutes the board and requires equal facts.
10. THE solver, the diff, the fog and the other engine modules SHALL not change. The public API list in `purity.test.ts` changes on purpose (Requirement 12).

### Requirement 2: The number guard

**User Story:** As the author, I want to be sure that a text says no number the engine did not compute, and to be told which token broke the rule.

#### Acceptance Criteria

1. `src/engine/guard.ts` SHALL export `extractTokens(text, options?)`, `guardFacts(...sources)` and `checkNumbers(text, facts, options?)`. `checkNumbers` returns `{ ok, offending }`, where each offending token has its exact `text`,
   its `kind`, a `reason` and its offset `at`; `offending` is ordered by offset and is empty exactly when `ok` is true.
2. WHAT A NUMBER IS (the token kinds, checked in this priority at each position of the text):

   | Kind | Examples | Value | Must be in the facts as |
   |---|---|---|---|
   | date | `2026-11-18` | itself, not three numbers | a date string |
   | time | `18:00`, `9:30` | itself | a time string |
   | key | `HB-108`, `CRYPT-12` (letters, then `-`, then digits) and every key of the facts | itself, not a number and not a sign | a key of the facts |
   | weekday | `Mon`, `Friday` | itself | a weekday string |
   | decimal | `3.5` | not an integer | never (the engine's numbers are integers: always offending) |
   | number | `59`, `1,000`, `13 %`, `13%`, `007` | an integer: digits, with commas only between groups of three; a following `%` is a unit and does not change the value | a number, by the rule of 2.3 |
   | signed number | `−15`, `-15`, `+8` | the integer and its sign | a number with that sign (2.3) |
   | number word | `zero` to `twenty`, `thirty` to `ninety`, `hundred`, `thousand`, `million`, `dozen` | the number it names (`dozen` is 12) | a number, by the rule of 2.3 |

3. A sign is a `-`, `−` (U+2212) or `–` (U+2013), or a `+`, **immediately** before a digit and **not** preceded by a letter, a digit or a `.` (so `HB-108`, `2026-11-18`, `80-150` and `Mon-Fri` have no sign). A number without a
   sign is in the facts when the facts hold it, or hold its negative (a loss is written "16" for a fact of −16). A negative number is in the facts only when the facts hold the negative; a `+n` only when the facts hold `n` with
   a positive sign. A magnitude that is in the facts with the other sign is offending with reason `wrong-sign`.
4. FACTS (`guardFacts(...sources)`) are the numbers found anywhere in the sources' values (nested objects and arrays), the strings found as whole values (dates, times, weekdays, keys), and the keys given explicitly (`options.keys`),
   so the guard works on `NightFacts` or on one part of it (the entry of one ticket, for an epitaph). It reads values only, never property names.
5. A KEY is checked against the keys of the facts; a token that looks like a key (`[A-Z][A-Z0-9]*-<digits>`) and is not one is offending (`unknown-key`). Known keys of any shape are recognised first (longest first, whole
   word), so a key such as `A3` does not leave a stray `3`. A date, a time and a weekday are checked against the strings of the facts (`unknown-date`, `unknown-time`, `unknown-weekday`).
6. A NUMBER WORD is a token like any other: "three tickets" with no 3 in the facts is offending (`not-in-facts`). `twenty-one` is read as the words `twenty` and `one`.
7. THE guard SHALL accept `options.ignore`: a list of `[start, end)` offsets of the text that are data text (Requirement 2.8). Tokens inside an ignored span are not checked.
8. DATA TEXT is ignored **by position**, never by searching for the title: a title that is `5` must not hide a wrong `5` elsewhere. The certificate returns the spans of its data text with the Markdown (Requirement 4.7).
9. THE guard SHALL be a pure, deterministic function: the same text and facts give the same answer, no regular expression keeps state between calls, and it never throws on any string (a property test with arbitrary strings).
10. LIMITS (written in the module's header and in the design): the guard proves **provenance**, not meaning (a wrong number that happens to be another fact passes; the golden notes and the equality tests of Requirement 1.7 cover
    meaning), and it does not read spelled-out forms outside the word list ("twice", "half", "third", Roman numerals). A bare web address is not neutralised in Markdown (Requirement 3.5).

### Requirement 3: Markdown safety

**User Story:** As a stakeholder who pastes the note into a ticket or a wiki, I want a ticket title to be shown as the text it is and never to change the structure of the note.

#### Acceptance Criteria

1. `escapeMarkdown(text)` SHALL turn any string into text that every CommonMark and GitHub-flavoured renderer shows literally: it puts a backslash before `\`, `` ` ``, `*`, `_`, `~`, `[`, `]`, `<`, `>`, `|`, `&`, `#` and `$`;
   it turns every newline, carriage return, tab and other control character into a single space; it removes bidirectional override characters (U+202A to U+202E, U+2066 to U+2069); it collapses runs of spaces and trims.
2. IT SHALL be applied to **every** piece of text that goes into the Markdown, template words included (the template has no special characters, so nothing changes there), and to keys, titles, names and the release.
3. A TABLE ROW SHALL have exactly the expected number of cells for any title: splitting the line on `|` that is not preceded by an odd number of backslashes gives that count (property test over arbitrary strings, including
   `|`, `\`, newlines, `<script>`, `` ` ``, `*`, `_`, `#`, `&#49;` and a lone backslash at the end).
4. NO RAW HTML SHALL reach the Markdown: every `<` and `&` of a title is preceded by an odd number of backslashes (property test), so `<script>` is shown as the text `<script>`.
5. A bare web address in a title stays text in the Markdown; a renderer may turn it into a link on its own. This is stated in the design and is the only known case.
6. ON THE SCREEN the same text is put in with `textContent`: no escaping, no `innerHTML`, no parsing of Markdown (Requirement 7.3).

### Requirement 4: The certificate

**User Story:** As a lead, I want one note that says what is kept, what is left out and why, in a fixed order and in plain English.

#### Acceptance Criteria

1. `deathCertificate(facts)` SHALL return the Markdown string; `certificateNote(facts)` the `Note`; `renderCertificate(facts)` the Markdown **and** the spans of its data text; `guardCertificate(facts)` the guard's verdict on it. All are pure
   and in `src/engine/certificate.ts`, exported from the index.
2. THE text is a fixed English template filled with facts: no model, no clock, no randomness, no network. The same facts give the same Markdown byte for byte (`\n` line ends, one final newline).
3. SECTIONS, in this order, all always present (an empty one says "None."):
   1. **Header**: the title "Death certificate", the release (when there is one), the freeze (weekday, date, time, zone) and "as of" the board's `now` (weekday, date, time).
   2. **The cut**: capacity, reserve and effective capacity; kept tickets, points and cost of delay; left-outside tickets, points and cost of delay; what waiting for the next release costs for all of them and the weeks.
   3. **Will it hold?**: the nights that hold out of the nights simulated and the floored percentage, that estimates are simulated between 80 % and 150 % of their value, and that the chance is measured against the full capacity.
      No sentence says or suggests that a bigger reserve is safer (the "no promise" scan of the fog spec runs over the whole note).
   4. **Left outside**: a table with the columns key, title, points, cost of delay with its formula (`value 5 + urgency 2 → 8 + risk 3 = 16`, or `imported cost of delay 14`), waiting cost (the header says "× N weeks"), and reason; one row per ticket, in the order of Requirement 1.9.
   5. **Zombies**: the threshold; for each zombie its key, title, releases left out and its urgency now and after one more release.
   6. **Put down (Won't Do)**: for each: key, title when known, and the tickets it blocks.
   7. **People away**: the names.
   8. **Exhumed by decision**: for each: key, title, points, cost of delay and the tickets it pushed out with their cost of delay.
4. REASONS read: "Does not fit: needs 8 points, 0 left." / "Follows HB-112, which is left outside." / "Cannot ship: depends on HB-112, which was put down (Won't Do)." / "Pushed out by the exhumed HB-108: needs 5 points, 0 left."
5. FOR AN IMPOSSIBLE FREEZE the note is short and true: the header, the points the must-haves need against the capacity and the reserve, and each must-have blocked by a put-down; no cut, no table.
6. THE template SHALL contain no digit and no number word: every number in the note comes from the facts. A test runs the guard over the note of an empty board (no tickets) and over the template with every fact removed.
7. THE data text of the Markdown (titles, names, release) SHALL be reported as `[start, end)` spans of the returned string. Keys are not data text: they are checked as keys.
8. THE note SHALL not depend on the order of tickets, people or absences (property test: permuted board, equal Markdown), and SHALL not change the facts or the board it was given.

### Requirement 5: Properties and tests that show the guard bites

**User Story:** As the maintainer, I want P12 and P24 to be real properties, and proof that the guard fails when it should.

#### Acceptance Criteria

1. **P12**: for every tombstone the app shows (generated states: candle, reserve, people away, exhumes, put-downs; the three reasons of the existing epitaph templates), the epitaph passes `checkNumbers` against the facts
   of that ticket (its entry in the night facts), with no offending token. The test is `P12 ...` in `tests/ui/epitaph-guard.test.ts`; the epitaph templates in `text.ts` do not change.
2. **P24**: over generated boards and states (candle, reserve, people away, exhumed, put down; titles with digits and Markdown characters), the certificate passes `guardCertificate` with no offending token. Named `P24 ...`.
3. BOTH SHALL be added to the traceability test with their files (`tests/engine/traceability.test.ts`: P24 in `certificate.test.ts`; P12 in `ui/epitaph-guard.test.ts`, so the scan reads the UI test folder too), and its comment about
   out-of-scope properties is brought up to date.
4. THE guard SHALL be shown to bite, each as its own test with a fixed note: one changed digit (`101` to `102`), an invented percentage (`70 %` not in the facts), a wrong key (`HB-190`), a wrong sign (`−16` for a fact of 16), a wrong date, a
   wrong time, a wrong weekday, a decimal, a spelled-out number (`three`), and a number in a data span that the guard must ignore while the same number outside it is rejected. Each test names the offending token it expects.
5. MUTATION CHECKS, one at a time, never in parallel on the same file, each reverted and each caught by a named test: the guard ignores signs; the guard reads `1,000` as 1 and 000; the guard skips the key check; the guard
   ignores spans by searching for the title; `escapeMarkdown` leaves `|`; `escapeMarkdown` leaves `<`; the facts name every exhumed ticket instead of the one that pushed a ticket out; the certificate writes the cost of delay in the waiting-cost column.
6. THE golden notes (Requirement 6) and the equality tests (Requirement 1.7) cover what the guard cannot: that a number is the right fact.

### Requirement 6: Golden notes

**User Story:** As a reviewer, I want to read two real certificates and have a test fail if they change.

#### Acceptance Criteria

1. TWO FILES in `docs/examples/`, compared by Vitest's file snapshot: `death-certificate-friday.md` (the sample board at Friday 18:00, no reserve, nobody away) and `death-certificate-tour.md` (after the tour's actions: Wed 18:00, Ana away,
   HB-112 put down, HB-108 exhumed). The test header gives the command to regenerate them (`npx vitest run tests/ui/certificate-golden.test.ts -u`).
2. THEIR numbers SHALL be checked by hand against the engine when written (the report lists the ones I checked), and the second SHALL show all of its sections filled: zombies, put down, away, exhumed, pushed out.
3. BOTH SHALL pass the guard and the no-promise scan, and the sample board SHALL not change.

### Requirement 7: The view

**User Story:** As a lead, I want to read the note on the screen before I copy it, with the keyboard and with a screen reader.

#### Acceptance Criteria

1. A **"Death certificate"** button SHALL replace the disabled slot of the same name in the Tools region, next to "Reset the sample board" (the slot's "Not built yet" note goes). Reason for the place: the note is an output of the whole
   night, it belongs with the other tools, it needs no new layout in the sign (whose heights are fixed), and the tour opens it for the viewer. The button has `data-focus="certificate"`.
2. PRESSING it SHALL open the view for the night as it is at that moment: the facts and the note are computed when it opens, from the state, and the view never changes while it is open.
3. THE view SHALL be made from the `Note` with DOM nodes (`h2` title, `h3` headings, `p`, `ul`, `table`), text only through `textContent`. There is no `innerHTML`, no Markdown parser and no `DOMParser`. A test proves the screen
   says what the Markdown says: every cell and line of the Markdown, unescaped, is in the view, in the same order.
4. THE table SHALL be a real `table` with a caption (visually hidden), column headers (`th scope="col"`) and the key as the row header (`th scope="row"`), inside a scroll box that has `tabindex="0"`, a name and
   a visible focus ring, so it is reachable and scrollable with the keyboard.
5. THE view SHALL be a dialog: `role="dialog"`, `aria-modal="true"`, named by its title. WHEN it opens (by the user) the focus moves to the title (`tabindex="-1"`); the page behind it (`header`, `main`, the skip link)
   is `inert`; Tab and Shift+Tab stay inside it; `Esc` closes it. WHEN it closes the `inert` is removed and the focus returns to the button that opened it (or to `data-focus="certificate"`, then `reset`, if that is gone).
6. IT SHALL have three controls, native buttons of at least 44 × 44 px: **Copy**, **Download .md** and **Close**. A status line (`role="status"`) says what happened; it exists from the start so a screen reader speaks the change.
7. IT SHALL be an interface of the sample app and of any board: the title, the release (when given) and the data text come from the facts. A board with no tickets, an impossible freeze and a title with every special character show a
   correct view (tests).
8. THE view SHALL be offered only through the app's own mount (`mountApp`), with the release name from `MountOptions.release` (`main.ts` gives the sample's). Without a release, the note and the view have no release line.

### Requirement 8: Copy

**User Story:** As a lead, I want to copy the note in one press, and to know that it worked or what to do if it did not.

#### Acceptance Criteria

1. **Copy** SHALL write the Markdown through an injected `Services.clipboard.writeText(text)` (the browser's Clipboard API by default). On success the status line says "Copied to the clipboard." (visible text, no number).
2. IF the browser refuses or has no Clipboard API (an insecure page, a denied permission) THEN the view SHALL show a read-only text area with the Markdown, move the focus to it and select its whole text, and the status line SHALL say
   "Copy was blocked. The note is selected below: press Ctrl+C." The user can then copy it by hand. Nothing is thrown, nothing is lost.
3. THE copy SHALL be the exact string `deathCertificate` returned, the same one the Download button saves (test).
4. A SECOND press SHALL work the same; closing the view clears the status and hides the text area.

### Requirement 9: Download

**User Story:** As a lead, I want a `.md` file I can attach to the freeze ticket.

#### Acceptance Criteria

1. **Download .md** SHALL save the Markdown through an injected `Services.files.save(name, text, type)`. The default builds a `Blob` (`text/markdown;charset=utf-8`), makes an object URL, clicks a temporary link with `download`, and **revokes the URL**
   (after a short delay through the injected timers, so the browser has started the download), and removes the link. A test with a fake `URL` checks that every URL made is revoked, once.
2. THE file name SHALL be ASCII and made from facts only: `death-certificate-<freeze date>.md` (for example `death-certificate-2026-11-20.md`). It does not contain a title or a name.
3. THE status line SHALL say "Download started." (no number).
4. IT SHALL work under the existing policy (`default-src 'none'; … connect-src 'none'`), **which does not change** (`csp.test.ts` still pins it exactly, with no `blob:`). This is checked in a real browser on the production build
   (Requirement 13); if the browser blocks it, the work stops and reports (it does not loosen the policy).
5. THE code SHALL not use `fetch`, `XMLHttpRequest`, storage, `innerHTML` or any banned API of `imports.test.ts`.

### Requirement 10: Layout, styles and motion

**User Story:** As a user on a phone, I want to read the note without a sideways scroll of the page.

#### Acceptance Criteria

1. AT 1280, 360 and 320 px wide the page SHALL have no horizontal scroll while the view is open; the table scrolls inside its own box; no cell text is clipped except by that box.
2. THE view SHALL use the palette tokens only (no new hex colour), text colours only from the allowed pairs of `contrast.test.ts`, no pixel font size under 16 px, no animation other than `transform` and `opacity`; it has no motion of its own,
   so reduced motion changes nothing. Fonts are the self-hosted ones.
3. THE title and the section headings SHALL use the painted face of the app; the table text the body face; the Markdown text area the mono face.
4. THE view SHALL fit the screen: it scrolls inside itself, its controls stay reachable (at the top of the view, not below a long table), and it never covers the skip link target or breaks the tour bar (Requirement 11.4).
5. `tokens.test.ts`, `contrast.test.ts` and `build.test.ts` keep passing; the gzipped size of JS plus CSS stays under the 60 kB budget (the report gives the number).

### Requirement 11: The tour scene

**User Story:** As a viewer of the video, I want one scene that shows the note, if there is room for it.

#### Acceptance Criteria

1. THE scene SHALL be added **only if** the whole tour still takes at most 60 seconds and every subtitle at most 15 characters per second. Today the tour is 57.0 s with 3.0 s free; the scene needs 4.0 s for its subtitle (52 characters, 13.0 characters per
   second), so the design rebalances three existing durations by 2.0 s (to 59.0 s, which leaves the 1 s of drift of the night-tour spec) and says so. If the rebalancing is not accepted, the scene is not added and the report says that it did not fit.
2. THE scene `certificate` SHALL come after "Someone insists" (scene 6): that is the only state of the tour with a zombie, a put-down, someone away, an exhume and tickets pushed out, so the note on the screen is the full one. It has no actions;
   `show: 'certificate'`; its subtitle is `One note for the stakeholders: what is out, and why.` (no numbers).
3. WHILE the scene runs the view SHALL be open in **tour mode**: not modal (no focus move, no `inert` on the page, no focus trap, no `Esc` of its own: `Esc` stops the tour), itself `inert` and out of the accessibility tree (so the subtitle stays the only live
   region), and placed above the caption bar, scrolled to the "Left outside" heading. It closes when the next scene starts, when the tour stops and when it ends.
4. THE bar SHALL stay fully visible and unchanged (heights per width as measured in the night-tour spec); the view stops above it at every width.
5. THE player SHALL not change. `Show` gains `'certificate'`; the page host maps it to "open the view in tour mode"; `docs/video-tour-script.md` is regenerated, and the tour-script test is changed on purpose (scene list, total, captions, "59.0 seconds").
6. STARTING the tour while the certificate is open (by the `#play` prompt and Space) SHALL close the view first. The measured run time is reported as before (within 1 s of the script total, or by how much).

### Requirement 12: Nothing existing gets worse

**User Story:** As the maintainer, I want the rest of the project untouched except where the feature needs a hook.

#### Acceptance Criteria

1. ALL existing tests SHALL stay green. The ones that change are changed on purpose and listed in the design: `purity.test.ts` (the public API list and the new files), `traceability.test.ts` (P12, P24), `slots.test.ts` (the certificate is no longer a slot),
   `tour-script.test.ts` and `render-tour.test.ts` (the new scene), `a11y.test.ts` (the new states), `imports.test.ts` (the scan sees the new files), `harness.ts` (recording clipboard and files).
2. THE engine SHALL stay free of the DOM, the clock, randomness and the Node globals of `purity.test.ts`: the template and the code of the three new files do not contain the words that scan bans (`document`, `window`, `process`,
   `performance`, `crypto`, `fetch`, `navigator`, `require`), not even in strings.
3. `npm run typecheck`, `npm test` and `npm run build` SHALL pass. No new dependency. `connect-src 'none'` and the whole policy stay.
4. THE reducer and the state SHALL not change: the open or closed view is UI state of the view, not of `AppState`, so the tour's restore and the existing action properties are untouched.

### Requirement 13: Real-browser checks

**User Story:** As the author, I want to know that the view, Copy and Download work where they will be used.

#### Acceptance Criteria

1. ON THE PRODUCTION BUILD, served from a local static server so the policy of `index.html` applies, in headless Chrome driven through the DevTools protocol, at 1280 × 720, 360 × 740 and 320 × 640: open the view from the button; take screenshots (top and the
   table); check no horizontal scroll of the page, the table box scrolls, the controls are visible and at least 44 px, the dialog is named, `Esc` closes it and the focus returns to the button; Tab stays inside.
2. DOWNLOAD: set the download folder through the protocol, press the button, wait for the file, and compare its bytes with the Markdown the page holds. Check the policy did not block it (no console violation) and that the object URL is revoked.
3. COPY: grant the clipboard permission, press Copy and read the clipboard back; then deny it and check that the fallback text area appears, is focused and selected. Say what headless Chrome could not do.
4. THE tour: run it to the certificate scene at the three widths; the view is above the bar, readable, not clipped; the whole run takes the script total to within 1 s (or the report says by how much).
5. THE report says what could not be checked (a screen reader, a real clipboard prompt, a real phone, other browsers).

### Requirement 14: Words outside the code

**User Story:** As a reader of the repository, I want the rule and the README to say what the code does.

#### Acceptance Criteria

1. `docs/rule.md` SHALL get a dated section (append, never rewrite) with the decisions of this spec: what a number is for the guard, the four reasons and how "pushed out by an exhume" is found, the sections of the certificate and the order of the table,
   what P12 and P24 now check, and the limits of the guard.
2. THE README SHALL describe the certificate (what it is, Copy, Download, the two examples in `docs/examples/`), the guard and its limits in two lines, and remove the certificate from "out of scope".
3. THE `board-ui` requirements and design get an addendum: the certificate slot is filled by this spec. `product.md` and `structure.md` do not change.

## Traceability

| Requirement | Verified by |
|---|---|
| 1 facts | `tests/engine/facts.test.ts` (examples, equality with the solver and the fog, leave-one-out, permutation property) |
| 2 guard | `tests/engine/guard.test.ts` (token table, signs, keys, spans, never throws), bite tests of 5.4 |
| 3 Markdown safety | `tests/engine/certificate.test.ts` (escape properties), mutation checks |
| 4 certificate | `tests/engine/certificate.test.ts` (sections, order, impossible, empty board, template has no digits) |
| 5 properties | `P24` in `certificate.test.ts`, `P12` in `tests/ui/epitaph-guard.test.ts`, `traceability.test.ts` |
| 6 golden notes | `tests/ui/certificate-golden.test.ts`, `docs/examples/*.md` |
| 7 the view | `tests/ui/certificate-view.test.ts`, `a11y.test.ts`, `slots.test.ts` |
| 8 copy | `tests/ui/certificate-view.test.ts` (recording clipboard, refusal, fallback) |
| 9 download | `tests/ui/certificate-view.test.ts` (recording files, fake URL), `csp.test.ts`, real browser |
| 10 layout | `tokens.test.ts`, `contrast.test.ts`, real browser |
| 11 tour | `tour-script.test.ts`, `render-tour.test.ts`, `docs/video-tour-script.md`, real browser |
| 12 nothing worse | the whole suite, `npm run build` |
| 13 real browser | the report of the checkpoint task |
| 14 words | review of `docs/rule.md`, `README.md` |
