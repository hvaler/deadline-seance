# Requirements: board-ui

Scope: the web interface of Deadline Séance, in `src/ui` and `src/main.ts`, on top of the finished rule engine
(`src/engine/index.ts`, spec `rule-engine`). Source of truth: `.kiro/steering/*.md`, `docs/rule.md` (later sections override
earlier drafts, including the 2026-11-13 section) and the visual brief in the request that created this spec.

## Introduction

One screen, one night. A team lead moves a candle (the freeze), sends survivors away, sets a reserve, and watches the rule
bury or keep tickets. Everything the screen says about the cut (who is kept, who is buried, why, what changed, what it
cost) is a fact returned by the engine. The UI draws facts and sends actions; it never decides, never computes the rule,
and never reads the system clock for the rule.

Built-in sample board (a fictional banking app, "Hollow Bank app 3.2 · release eve"), no credentials, and no network request
at all: the fonts are self-hosted. The first release of the UI is complete on its own: features that belong to later specs are visible as clearly
marked, inert slots.

## Glossary

- **Candle**: the freeze time. It moves in half-day steps from `now` (step 0) to Friday 18:00 (step 10).
- **Survivors**: the people of the board. A survivor can be sent away (removed from the team) and brought back.
- **Reserve**: the margin, 0 to 30 % in steps of 5.
- **Safehouse**: the kept tickets (plank cards). **Yard**: the buried tickets (tombstones).
- **Change**: what the last action did, with the engine's `diffSolutions` result (what rises, what sinks, the cod change).
- **Slot**: a visible, labelled, inert placeholder for a feature that is out of scope.
- **Facts**: values returned by the engine (`Solution`, `Diff`, `codParts`, `capacityBetween`, reasons).

## What the UI may and may not compute

The steering rule is "anything that shows a number must be computed by the engine, never in the UI". For this spec:

- **Allowed**: counting the items of an engine list (`.length`), choosing a word from the sign of an engine number
  ("Gain" or "Loss"), formatting an integer for display, and layout arithmetic (percentages for the candle height, pixel
  positions for chain lines).
- **Not allowed**: adding, subtracting or comparing engine quantities to decide anything, or showing a number that is not a
  fact. Where the brief needs a sum the engine does not give yet (cod and effort of the yard, cod of what rises and sinks),
  Requirement 19 adds it to the engine.

## Requirements

### Requirement 1: Built-in sample board and a fixed clock

**User Story:** As a judge, I want to open the page and play with a realistic board, so that I can try it with no setup.

#### Acceptance Criteria

1. THE app SHALL ship one built-in board, "Hollow Bank app 3.2", with 19 tickets `HB-101` to `HB-119`, 4 survivors and the
   data in the design document. It SHALL pass `validateBoard`.
2. THE rule SHALL receive `now = 2026-11-16 09:00` in `Europe/Madrid` (a constant, `Date.UTC(2026, 10, 16, 8, 0)`). `now`
   SHALL NOT come from the system clock, and no module of `src/ui` SHALL call `Date.now`, `new Date()` with no arguments or
   `Math.random` (a test scans for them).
3. THE initial state SHALL be: candle on Friday 18:00 (step 10), reserve 0 %, nobody away.
4. WHEN the board is solved in the initial state THEN the engine SHALL give capacity 59 and the cut SHALL fill 59 of 59
   points; the kept tickets SHALL be `HB-101` to `HB-107`, `HB-109`, `HB-113`, `HB-115`, `HB-116` and `HB-118`, and the
   buried ones `HB-108`, `HB-110`, `HB-111`, `HB-112`, `HB-114`, `HB-117` and `HB-119`. A test SHALL pin these facts so a
   change in the engine or in the sample data is noticed.
5. THE board SHALL contain at least: three must-haves; dependency chains of depth three; one ticket with an imported cost of
   delay; two hungry tickets (`HB-105` with urgency 1 → 5 and `HB-113` with urgency 3 → 8, the doc's examples); two buried
   zombies at the initial state; one cascade at the initial state; one exhumation that is rejected at the initial state.
6. WHEN the user presses "Reset the sample board" THEN the state SHALL return to the initial state and the change report
   SHALL say so.

### Requirement 2: The candle

**User Story:** As a team lead, I want to drag the freeze in half-day steps and see the cut react, so that I can find the
point where it holds.

#### Acceptance Criteria

1. THE candle SHALL be a native `<input type="range">` with `min = 0`, `max = 10`, `step = 1` (one step is half a working day)
   next to a drawing of a melting candle whose wax height follows the value.
2. THE eleven freeze instants SHALL be the fixed table in the design (step 0 is `now`; steps 1 to 10 are the end of each
   morning, 13:00, and each afternoon, 18:00, from Monday to Friday), stored as epoch milliseconds with their labels.
   A test SHALL check that every label is the Madrid local time of its instant.
3. THE capacity at the candle SHALL be shown from `capacityBetween` and the capacity after the reserve from
   `effectiveCapacity`; both SHALL equal the `capacity` and `effectiveCapacity` of the solution (a test checks it).
4. EACH notch of the candle SHALL show the capacity at that freeze, from `capacityBetween`.
5. THE input SHALL have `aria-valuetext` such as "Fri 18:00, 59 points, 59 after the reserve". Home, End and the arrow keys SHALL
   work (native behavior).
6. WHILE the user drags or holds an arrow key THEN the screen SHALL apply at most one candle change per animation frame, and the
   spoken announcement SHALL wait until the value settles (Requirement 12).
7. A candle step outside 0 to 10 SHALL be ignored by the state.

### Requirement 3: Survivors

**User Story:** As a team lead, I want to send people away and bring them back, so that I can see what the team's absence costs.

#### Acceptance Criteria

1. EACH survivor SHALL be a button with `role="switch"` and `aria-checked` ("here" or "away"), showing the name, the points per
   half day (a board fact) and the words "Here" or "Away".
2. WHEN a survivor is sent away or brought back THEN the capacity SHALL be recomputed from the remaining team (the engine gets a
   board with only the present people) and the change report SHALL show the diff.
3. WHEN everybody is away THEN the freeze SHALL be solved with capacity 0 and the screen SHALL say so through the normal
   impossible-freeze message.
4. A name that is not on the board SHALL be ignored by the state.
5. THE survivors' own absences (days off in the board data) SHALL stay in the board and count in the capacity.

### Requirement 4: The reserve

**User Story:** As a team lead, I want to keep some capacity in reserve, so that the cut has room for estimates that fail.

#### Acceptance Criteria

1. THE reserve SHALL be a native `<input type="range">` from 0 to 30 in steps of 5, labelled "Reserve" with its percentage in
   a visible `<output>`, and `aria-valuetext` such as "15 percent, 50 points after the reserve".
2. THE value SHALL be passed to the engine as `marginPct`. Any value outside 0, 5, ..., 30 SHALL be ignored by the state.
3. THE screen SHALL NOT promise that more reserve always keeps more tickets or makes the shelter hold. There is no survival
   number in this spec (the fog slot, Requirement 16, stays empty).

### Requirement 5: The safehouse and the yard

**User Story:** As a team lead, I want to see what is kept and what is buried, with the numbers and the reason, so that I can
trust and explain the cut.

#### Acceptance Criteria

1. THE safehouse SHALL list the kept tickets as plank cards, sorted by key, with a heading showing the count, the total effort
   against the effective capacity ("59 of 59 points") and the saved cod, all from the solution.
2. THE yard SHALL list the buried tickets as tombstones, sorted by key, with a heading showing the count, the effort and the cod
   left outside, from the solution (Requirement 19).
3. EVERY card SHALL show: key (monospace), title, effort, the cost of delay with its formula, a "must-have" badge when it
   applies, and what it needs ("needs HB-104").
4. THE cost of delay SHALL read "value 5 + urgency 3 + risk 3 = 11" for a formula ticket; when hunger applies,
   "value 3 + urgency 1 → 5 + risk 3 = 11" and "left out 3 releases"; for an imported cost, "imported cost of delay 14". The
   parts come from `codParts`.
5. EVERY tombstone SHALL show the engine reason in words: `no-room` ("needs 8 points, 0 left"), `depends-on-buried` ("depends on
   HB-112, which is buried") or `blocked-by-put-down` ("depends on HB-112, which was put down"), the cost of waiting
   (`burialCost`, with the weeks from the board), and an epitaph.
6. THE epitaph SHALL come from one fixed, deterministic template per reason (design), built only from facts, in a single function
   so a later spec can replace it. There is no LLM and no key.
7. WHEN the freeze is impossible THEN both grounds SHALL show an explanation instead of lists (Requirement 10).
8. THE lists SHALL be re-derived from the engine on every change. A property test SHALL check that, after any sequence of
   actions, the keys shown in the safehouse and in the yard equal `solveFreeze` on the current board.

### Requirement 6: Dependency chains and the cascade

**User Story:** As a team lead, I want to see which tombstones drag others down, so that I understand why a cheap ticket is
buried.

#### Acceptance Criteria

1. FOR every pair of buried tickets where one depends on the other, THE yard SHALL draw a chain between their tombstones (an
   SVG line behind the cards, `aria-hidden`). The same relation SHALL also be written as text on the dependent ("chained to
   HB-112") so it does not depend on the drawing.
2. A tombstone whose reason is `depends-on-buried` SHALL be marked as fallen ("fell behind HB-112"), with a short falling
   animation staggered by list position.
3. THE chains SHALL be redrawn after layout when the yard changes and when its size changes, using one layout read and one write
   per frame.
4. WHEN a change buries at least one ticket whose reason is `depends-on-buried` THEN the change is a cascade (Requirement 11).
5. Chain data SHALL be the `dependsOn` of the board tickets filtered by the buried keys; the UI SHALL NOT recompute closures.

### Requirement 7: Every change shows its diff

**User Story:** As a team lead, I want every action to tell me what rose, what sank and what it was worth, so that nothing
changes silently.

#### Acceptance Criteria

1. AFTER every action that changes the cut (candle, survivor, reserve, exhume, resurrect, put down, reset) THE screen SHALL show
   a change note: what was done ("Candle moved to Wed 18:00"), then "Rises: HB-104 (11), HB-106 (16), HB-107 (11)" and "Sinks:
   HB-105 (11), HB-113 (14)", the cod of each side ("together 38", "together 25"; a single entry has none) and "Gain: 13", "Loss: 43" or "No
   change in saved cod". The cod of each side and the change come from the diff (Requirement 19).
2. THE note SHALL show the saved cod before and after ("saved cod 100 → 113"), from the two solutions.
3. WHEN either side is an impossible freeze THEN the note SHALL say "No comparison: the freeze is impossible" with the numbers of
   the impossible side, because `diffSolutions` refuses an impossible solution.
4. WHEN nothing rises or sinks THEN the note SHALL say so.
5. THE note SHALL be derived from `diffSolutions` of the solutions before and after the action, never from the previous screen.
6. THE note SHALL update at every step of a drag, and the spoken announcement SHALL be the one at settle time, comparing the
   state when the gesture started with the state at its end (Requirement 12).
7. AT first load the note SHALL say "Nothing has moved yet."

### Requirement 8: Exhume

**User Story:** As a team lead, I want to dig a ticket up and see what it costs, so that I can decide with eyes open.

#### Acceptance Criteria

1. EVERY tombstone SHALL have an "Exhume" button (a "Resurrect" button for a zombie, Requirement 9) with an accessible name that
   includes the key.
2. WHEN pressed THEN the state SHALL call the engine's `exhume` on the board of the current team. If it is applied, the board
   SHALL take the new must-have and the change note SHALL show the diff ("Sinks: HB-113 (14), HB-115 (13)").
3. IF the engine rejects it as impossible THEN the board SHALL stay exactly as it was (the same value, not a copy), and the screen
   SHALL show, as an alert, "HB-119 stays in the ground. The must-haves with HB-119 need 63 points; there are 59 (59 after the
   0 % reserve). Move the candle later, or drop a must-have." with the numbers from the impossible result. A blocked must-have
   SHALL be named with the key it depends on.
4. AN exhumed ticket SHALL appear in the safehouse with a "must-have" badge.
5. EXHUMING a ticket that is already kept is not offered (kept cards have no action in this spec).

### Requirement 9: Zombies

**User Story:** As a team lead, I want to see which tickets keep being left out and either bring them back or close them.

#### Acceptance Criteria

1. EVERY buried ticket in `solution.zombies` SHALL be marked "Zombie" with a violet badge and text such as "left out 3 releases".
   Colour SHALL NOT be the only cue.
2. A zombie SHALL have two actions: "Resurrect" (the engine's `resurrect`) and "Put down (Won't Do)" (the engine's `putDown`).
3. WHEN a zombie is put down THEN the ticket SHALL leave the board, its key SHALL be recorded as put down, the dependents that can
   never ship SHALL show the reason `blocked-by-put-down`, and the change note SHALL say "HB-112 closed as Won't Do. HB-114 can
   never ship." and "No change in the cut" (the engine guarantees an empty diff).
4. A put-down ticket SHALL NOT be shown as a tombstone; a short line SHALL list the put-down keys ("Closed as Won't Do: HB-112").
5. A put down on a ticket that is not a zombie SHALL not be offered and, if the state receives it, SHALL leave the board unchanged
   and report the refusal.

### Requirement 10: Impossible freeze and invalid boards

**User Story:** As a team lead, I want to be told plainly, with numbers, when the freeze cannot be met or the board is wrong.

#### Acceptance Criteria

1. WHEN the engine returns an impossible solution THEN the sign SHALL say "The must-haves need 15 points; there are 12 (12 after
   the 0 % reserve). Move the candle later, or drop a must-have." with `needed`, `capacity` and `effectiveCapacity` from the
   result. For each blocked must-have it SHALL add "HB-102 can never ship: it depends on HB-120, which was put down."
2. WHILE impossible THE safehouse and the yard SHALL show an explanation ("Nothing can be decided until the must-haves fit"), and
   the must-haves SHALL be listed by key, title and effort (board data) so the user can see what needs room.
3. WHEN the board fails `validateBoard` at start-up THEN the app SHALL not draw the grounds; it SHALL show a list of every error
   in words with its keys and values: duplicate key, unknown dependency, self-dependency, dependency cycle (the keys in order),
   not an integer, negative number, off-scale value, invalid time zone, invalid threshold, put-down key among tickets, invalid
   absence and board too large. A test SHALL cover each code with a deliberately broken board and SHALL fail when a new
   engine error code has no sentence.
4. NO message SHALL come from a language model, and no message SHALL contain a number that is not a fact.

### Requirement 11: Sound

**User Story:** As a judge, I want the night to have a voice, but only if I ask for it.

#### Acceptance Criteria

1. SOUND SHALL be off by default. The "Sound off" button (`aria-pressed`) SHALL turn it on and off. No `AudioContext` SHALL be
   created before the first press that turns sound on.
2. THERE SHALL be four generated sounds, each with its own character: **resurrect** (rising, shimmering), **put down** (a dry
   crack, a low hollow note and a metallic ring), **bury** (a soft low thud that falls in pitch) and **cascade** (a quick roll of
   five falling thuds). The recipes are in the design.
3. ONE sound SHALL play per settled change: resurrect or exhume that is applied plays resurrect; put down plays put down; a
   candle, survivor or reserve change that sinks tickets plays cascade if any sunk ticket is now buried with reason
   `depends-on-buried`, otherwise bury; a change that only raises tickets, a rejected exhume and a reset are silent.
4. NO audio file, no third-party music and no network request SHALL be used. A single `ConvolverNode` SHALL be created once, with
   an impulse generated in code from a deterministic integer sequence, and reused.
5. EACH sound SHALL last less than 1.6 seconds and use fewer than 40 nodes. The master gain SHALL stay at or below 0.3.
6. WHILE sound is off or the context cannot be created THEN playing SHALL do nothing and the app SHALL work the same.

### Requirement 12: Accessibility

**User Story:** As a keyboard or screen reader user, I want the same night as everybody else.

#### Acceptance Criteria

1. EVERY action (candle, reserve, survivors, exhume, resurrect, put down, sound, reset) SHALL be reachable and operable by
   keyboard with native elements (`button`, `input`), in visual order, with no positive `tabindex`.
2. EVERY focusable element SHALL have a visible focus ring (3 px amber `#f1b24a`, 2 px offset) that meets 3:1 against its
   neighbours.
3. THE page SHALL have one `h1`, headings for each section, landmarks (`header`, `main`, labelled sections) and a "Skip to the
   safehouse" link.
4. A hidden live region (`aria-live="polite"`, `aria-atomic="true"`) SHALL announce the verdict and the diff as one sentence, after
   the value settles (300 ms without a candle or reserve input) or at once for a discrete action. A rejected exhume or an
   impossible freeze reached by an action SHALL use `role="alert"`.
5. WHEN a card moves between grounds THEN the focus SHALL stay on the same logical control if it still exists, or move to the card
   of the ticket that was acted on, or to the section heading; focus SHALL never fall back to the page.
6. THE app SHALL work at 360 px width with no horizontal scroll, and with text enlarged to 200 % without loss of content.
7. TEXT SHALL meet WCAG AA contrast: at least 4.5:1 for body text and 3:1 for large text and for non-text parts of controls. The
   allowed colour pairs are listed in the design, and a test SHALL compute them from the palette.
8. EVERY decoration (fog, moon, vignette, scanlines, "● REC", timecode, tape, chains, candle drawing, glow) SHALL be
   `aria-hidden="true"` and `pointer-events: none`.
9. WHILE `prefers-reduced-motion: reduce` THEN the fog, the REC blink, the timecode, the candle flicker, the falling and shaking
   animations and any scroll animation SHALL stop; state SHALL be conveyed by static styling and text instead.
10. EVERY state change SHALL also be conveyed by text, not only by colour or animation.
11. THE tap targets SHALL be at least 44 × 44 px.

### Requirement 13: The look

**User Story:** As a viewer, I want the 80s horror title card on a VHS tape in a post-apocalypse shelter, with nothing borrowed.

#### Acceptance Criteria

1. THE palette SHALL be exactly: night `#110e16`; plywood `#3a2c22` and `#4a3829`; bone `#ebe4d3`; stone `#a49cad` (dim `#6f6779`);
   neon red `#ff3d3d`; toxic green `#8fd47e`; violet `#7d5cff`; masking tape `#d9cfa6`; rust `#b8592f`; candle amber `#f1b24a`.
   Neon red is for the title and danger, green for kept and safe, violet for zombies, amber for focus and the candle.
2. THE fonts SHALL be self-hosted from the `@fontsource` packages, pinned to exact versions, latin subset only, and only the weights
   the app uses: "Rubik Wet Paint" 400 for the title, "Permanent Marker" 400 for painted signs, "IBM Plex Sans" 400 and 600 for body
   text and "IBM Plex Mono" 400 and 600 with tabular figures for every number. They SHALL be imported from the app's own CSS
   (`styles/fonts.css`), so the build bundles the files. The page SHALL stay fully readable with the fallback fonts (`font-display:
   swap`, which the packages set; system fallbacks chosen to avoid layout shifts above 0.1). Rubik Wet Paint, IBM Plex Sans and IBM Plex
   Mono are under the SIL Open Font License 1.1 and Permanent Marker is under Apache-2.0; the README SHALL say so, and the four licence
   texts SHALL ship with the build under `licenses/`.
3. THE title card SHALL show a small "Hollow Bank app 3.2 · release eve" line above a large glowing "Night of the Living Backlog", a
   disabled "Play the night · 60 s" slot and the "Sound off" button.
4. THE atmosphere SHALL include: slowly drifting fog on a canvas; a faint moon at the top right; a vignette; VHS scanlines; a
   blinking "● REC" with a running timecode at the top left.
5. THE layout from top to bottom SHALL be: title card; the taped plywood sign (verdict, change note and reserve slider); the candle
   timeline; the survivors; two grounds side by side ("Inside the safehouse" and "Left outside"); the tools. Under 820 px the
   grounds SHALL stack in one column.
6. THE app SHALL use no image, logo, name, music or text from any existing film, series or game.

### Requirement 14: State and architecture

**User Story:** As a maintainer, I want the UI to be a thin, testable layer.

#### Acceptance Criteria

1. THE UI SHALL be vanilla TypeScript in `src/ui` (and `src/main.ts`), with no UI framework and no runtime JavaScript dependency. The
   font packages are dev dependencies: Vite bundles their files at build time and nothing from them runs in the page.
2. THE state SHALL be one plain value (no functions, no DOM nodes, no class instances) changed only by a pure reducer. THE view
   SHALL be derived from the state by calling the engine, and re-derived on every change.
3. THE reducer SHALL be pure: the same state and action give an equal result, and the input state is never mutated (a test freezes
   the state deeply).
4. THE UI SHALL import only the engine's public entry (`src/engine/index.ts`). A test SHALL scan `src/ui` and `src/main.ts` and fail
   on any other engine path (for example `solver`, `chain`, `oracle`).
5. THE dependency SHALL point one way: `ui → engine`. Nothing in `src/engine` imports the UI (already tested).
6. THE UI SHALL NOT compute the rule: no closure, tie-break, capacity, margin, cost or diff outside the engine.
7. THE app SHALL be deterministic: the same actions from the initial state give the same screen, in any browser.

### Requirement 15: Security

**User Story:** As a user who may load boards written by someone else, I want text on the board to stay text.

#### Acceptance Criteria

1. NO code in `src/ui` or `src/main.ts` SHALL use `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or
   `new Function`. DOM SHALL be built with `createElement`, `createElementNS` and `textContent`. A test SHALL scan for these.
2. A test SHALL render a board whose ticket titled `<img src=x onerror=alert(1)>` (and a person and a key with markup) and prove
   that no `<img>` element exists, the text is shown literally, and `alert` was not called.
3. THE built `index.html` SHALL carry a Content Security Policy that allows only the app's own origin: `default-src 'none'; script-src 'self';
   style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'`. No inline script, no inline style,
   no other host. The build SHALL NOT inline any asset as a `data:` URI (`assetsInlineLimit: 0`), because `font-src 'self'` would block it. Styles set
   from script SHALL use the CSSOM (`style.setProperty`), never a `style` attribute, which `style-src 'self'` blocks.
4. THE app SHALL make no network request at all, beyond loading its own files. A test SHALL fail if `index.html`, any CSS file or any source file
   under `src/ui` or `src/main.ts` mentions an `http(s)://` host (other than in comments), a `<link>` to another origin, `@import url(http…)`,
   `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` or `import()` of a URL; and the CSP policy constant SHALL contain no host.

### Requirement 16: Out-of-scope slots

**User Story:** As a reviewer, I want to see where later features will go, and to be sure they do nothing yet.

#### Acceptance Criteria

1. THE screen SHALL show a labelled, inert slot, `data-slot="<name>"`, for each of: guided tour ("Play the night · 60 s", in the title
   card), fog of estimates and survival odds (in the sign), death certificate, night chronicle and undo, CSV import and export,
   and the MCP server note. Each slot SHALL say "not built yet", be disabled or plain text, and have no behavior.
2. THE epitaph function SHALL be the single place a later spec replaces to add the language model and its number guard. There
   SHALL be no key field, no network call and no mention of a model in the UI.
3. A test SHALL check that each slot exists, says it is not built, and is not focusable if it is a disabled control.

### Requirement 17: Tests and quality gates

**User Story:** As a maintainer, I want the UI to be verified the way the engine is.

#### Acceptance Criteria

1. TESTS SHALL live in `tests/ui` and run with `npm test` (Vitest). DOM tests SHALL use jsdom, chosen per file, pinned to an exact
   version as a dev dependency.
2. THERE SHALL be tests for: the pure reducer; the property that the shown kept and buried lists equal `solveFreeze` after any
   sequence of actions; the plain-text rendering of markup in titles; the engine-import scan and the other source scans (Requirements
   1.2, 14.4, 15.1); the sample board facts; the candle table; the sentences, including a check that every integer in a generated
   sentence is a fact; the audio recipes with a fake context; the palette contrast; the accessibility structure; the slots.
3. THE engine tests, the traceability test and the engine-save hook SHALL keep working and passing.
4. `npm run typecheck`, `npm test` and `npm run build` SHALL pass at the end of every task.
5. THE visual and layout checks that cannot run in jsdom (360 px, focus ring, reduced motion, fog, fonts) SHALL be a written manual
   checklist, and the final report SHALL say which of them were and were not verified.

### Requirement 18: Performance on a low-end PC

#### Acceptance Criteria

1. A candle drag SHALL re-solve and patch the DOM at most once per animation frame; the solver on the sample board takes a few
   milliseconds, and `derive` SHALL cache by board version, candle, reserve and team.
2. THE DOM SHALL be patched by key (no full rebuild of the grounds) so focus and animations survive.
3. THE fog SHALL draw pre-rendered soft sprites at a quarter of the screen resolution, at most 20 frames a second, and SHALL pause
   when the tab is hidden. All other animation SHALL use `transform` and `opacity`.
4. THE production bundle (JavaScript and CSS, without the font files) SHALL be under 60 kB gzipped; the build SHALL report it. The six font files are
   about 190 kB as woff2 (Rubik Wet Paint alone is 76 kB), are cached after the first visit, and load with `font-display: swap` so text is never
   hidden waiting for them.
5. AUDIO SHALL be created only after the first user gesture that turns it on.

### Requirement 19: Engine addition, totals

**User Story:** As the UI, I want the engine to give me the sums the brief shows, so that I never add engine numbers myself.

#### Acceptance Criteria

1. `SolvedSolution` SHALL gain `buriedEffort` (the sum of `effort` of the buried tickets) and `buriedCod` (the sum of their `cod`),
   integers.
2. `Diff` SHALL gain `raisedCod` and `sunkCod` (the sums of the `cod` of the entries in `raised` and `sunk`), integers, with
   `raisedCod − sunkCod = codDelta`.
3. THE engine tests SHALL cover them: `keptEffort + buriedEffort` equals the total effort of the board and `savedCod + buriedCod`
   equals the total cod of the board (so they are not confused with a property of the rule, they are named without a P number);
   the existing P15 test SHALL also assert `raisedCod − sunkCod = codDelta`.
4. THE change SHALL be recorded in `docs/rule.md` (a dated section) and in the `rule-engine` design.
5. NO other engine behavior SHALL change; all engine tests and the traceability test SHALL still pass.

### Requirement 20: Deploy to GitHub Pages

**User Story:** As a judge, I want to open the app from a link.

#### Acceptance Criteria

1. A workflow `.github/workflows/pages.yml` SHALL build with `npm ci`, run typecheck and tests, build, and publish `dist/` to GitHub
   Pages using the official actions `actions/checkout`, `actions/setup-node`, `actions/upload-pages-artifact` and
   `actions/deploy-pages`. (`actions/configure-pages` is not needed because the build uses a relative base, and leaving it out keeps the
   permissions smaller.)
2. EVERY action SHALL be pinned to a full commit SHA, with the version as a comment.
3. PERMISSIONS SHALL be least privilege: `contents: read` for the workflow; `pages: write` and `id-token: write` only on the deploy job.
4. THE workflow SHALL run on pushes to `main` and manually, with a concurrency group that never cancels a running deploy.
5. THE Vite `base` SHALL be relative (`./`) so the same build works at `https://hvaler.github.io/deadline-seance/` and anywhere else.
6. THE README SHALL say how to run the app, the live address, and the one manual step: GitHub Pages source set to "GitHub Actions".
7. THIS task is last; nothing is pushed or deployed by the agent without the user's say-so.

## Traceability

| Requirement | Verified by |
|---|---|
| 1 sample board, fixed clock | `sample-board.test.ts`, `purity.test.ts` (source scan) |
| 2 candle | `candle-steps.test.ts`, `derive.test.ts`, `candle.test.ts` (DOM, fake timers) |
| 3 survivors | `reducer.test.ts`, `survivors.test.ts` |
| 4 reserve | `reducer.test.ts`, `derive.test.ts` |
| 5 safehouse and yard | `render-grounds.test.ts`, `text.test.ts`, `shown-lists.property.test.ts` |
| 6 chains and cascade | `chains.test.ts`, `render-grounds.test.ts` |
| 7 change note | `text.test.ts`, `reducer.test.ts`, `render-sign.test.ts` |
| 8 exhume | `reducer.test.ts`, `render-grounds.test.ts` |
| 9 zombies | `reducer.test.ts`, `render-grounds.test.ts` |
| 10 impossible and invalid | `text.test.ts`, `render-sign.test.ts`, `invalid-board.test.ts` |
| 11 sound | `audio.test.ts`, `sound-events.test.ts` |
| 12 accessibility | `a11y.test.ts`, `contrast.test.ts`, manual checklist |
| 13 look | `contrast.test.ts` (palette), `tokens.test.ts`, manual checklist |
| 14 architecture | `reducer.test.ts`, `imports.test.ts` |
| 15 security | `xss.test.ts`, `imports.test.ts` (scans), `csp.test.ts` (policy and no external hosts), built `index.html` check |
| 16 slots | `slots.test.ts` |
| 17 quality gates | the whole suite |
| 18 performance | `candle.test.ts` (one patch per frame), bundle size in the build report |
| 19 engine totals | `tests/engine/totals.test.ts`, `diff.test.ts` (P15) |
| 20 deploy | workflow lint and a dry local build; real deploy needs a push |

## Decisions taken in this spec (for review)

- **D1. Two small additions to the engine** (Requirement 19). The brief asks for sums the engine does not return, and the steering
  forbids the UI from adding engine numbers. The alternative is to let the UI add them; say so and I will drop Requirement 19.
- **D2. The sample board is new.** `docs/rule.md` mentions HB-105, HB-109, HB-113 and "59 of 59 points" but does not list a board. I
  designed 19 tickets around those facts and checked them with the engine: capacity 59 and a cut of 59 at Friday 18:00; HB-105 `cod` 7 → 11
  and HB-113 `cod` 9 → 14. The example "Ana leaves → HB-109 out (−15)" does not hold on this board (Ana leaving sinks HB-113, HB-115 and
  HB-118), because that line belongs to the chronicle feature, which is out of scope.
- **D3. The candle table is data.** The engine has no function that turns a local date into an instant, and the UI must not do
  time-zone arithmetic, so the eleven freeze instants are constants checked by a test.
- **D4 (changed on review). Fonts are self-hosted** with the `@fontsource` packages (exact versions, latin subset, the weights in use), so the
  app makes no network request at all and the CSP allows only `'self'`. The packages are dev dependencies bundled at build time. Their `.css`
  also lists a `woff` fallback next to each `woff2`; Vite copies both files, but browsers only download the `woff2`.
- **D5. jsdom as the only new dev dependency**, for the DOM tests. It needs Node 22.22+ or 24.15+; CI uses Node 24.
- **D6. One hidden live region** announces the verdict and the diff, instead of making the visible panels live, so a drag does not
  flood a screen reader.
- **D7. Content Security Policy is added only to the production build**, because the dev server needs inline scripts.
- **D8. Plain change sentences.** The change note says "Ana sent away. Sinks: HB-113 (14), ... Loss: 43." It does not use the chronicle's one-line
  format ("Ana leaves → HB-109 out (−15)"), which belongs to the chronicle spec.

## Out of scope (inert slots only)

Fog of estimates and survival probability; LLM epitaphs and the number guard; death certificate; night chronicle and undo; CSV import
and export; guided tour; MCP server. Also out of scope: editing tickets, creating tickets, saving state between visits, and any
network call of any kind.

## Addendum: the fog slot is filled

Requirement 16 left a fog slot on the sign. The `fog` spec (`.kiro/specs/fog`) fills it: the slot `[data-slot="fog"]` is gone, and the sign carries a fog block (`[data-region="fog"]`) and a strip under the reserve slider. The other five slots are unchanged.

## Addendum: the tour slot is filled

The "Play the night · 60 s" slot is filled by the `night-tour` spec when the app is given a script (`mountApp(..., { tour })`); without one it stays the disabled slot. The other four slots are unchanged.

## Addendum: the certificate slot is filled

The "Death certificate" slot of the tools is filled by the `death-certificate` spec: it is now a working button that opens the note for stakeholders (Copy, Download .md). It is no longer a slot (no `data-slot`, no "Not built yet" note); the chronicle, CSV and MCP slots stay as they were.

## Addendum: the CSV slot is filled

The "CSV import and export" slot of the tools is filled by the `jira-csv` spec: the tools have a group "Your tickets" (import, download the sample, export for Jira) and the page a banner while your own tickets are loaded. The chronicle and MCP slots stay as they were.
