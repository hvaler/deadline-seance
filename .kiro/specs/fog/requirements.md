# Requirements: fog

Scope: the **fog of estimates** (product feature 2), in two places: the pure engine (`src/engine/fog.ts`, plus a seed on the board) and the
screen (the fog slot on the sign, and a strip under the reserve slider). It follows `docs/rule.md` §2 "Niebla de las estimaciones", P19–P21 and
the "Ojo con P20" note; where this spec is more exact (the hash, the seed, the night numbering) it is the later word, and a dated section is
appended to `docs/rule.md` when it is implemented. Out of scope: the death certificate, the MCP tool, CSV import, the chronicle and the tour
(they will read the numbers defined here, and are not built here); any LLM text about the fog.

## Introduction

A cut that fills the capacity exactly is fragile: estimates are wrong. The fog answers one question with a number: **if estimates land
anywhere between 80 % and 150 % of what was written, in how many of 1,000 nights does the kept work still fit the team's full capacity?** The
number comes from a deterministic simulation: integers only, no randomness, no clock. The screen shows it big on the sign, and shows it for
every reserve step (0, 5, … 30 %) in a small strip, so the message "you have to cut more than the arithmetic says" can be seen at a glance
without the app ever saying it.

## Glossary

- **Night**: one simulated outcome, numbered 0 to 999.
- **Draw** `f`: the integer percentage (80 to 150) a ticket's estimate turns into on a given night.
- **Kept set**: the keys the solver keeps for a given reserve. **Capacity**: the full capacity (`capacity`, not `effectiveCapacity`): the fog
  asks whether the work fits the team, not whether it fits the reserve.
- **Holds**: a night holds when the simulated effort of the kept set is ≤ capacity.
- **Chance**: `floor(100 × holds / 1000)` percent, with the raw `holds` count beside it.
- **Curve**: the chance at each reserve step 0, 5, 10, 15, 20, 25, 30.
- **Seed**: the board's `fogSeed`, a 32-bit unsigned integer.

## Requirements

### Requirement 1: The board carries its seed

**User Story:** As someone who shares a board, I want the same board to give the same chance on every machine, so that a number quoted in
a note or a video can be reproduced.

#### Acceptance Criteria

1. `Board` SHALL gain a required field `fogSeed`: an integer in 0 … 4 294 967 295 (an unsigned 32-bit value). It is data, like `nextReleaseWeeks`;
   nothing derives it silently.
2. `validateBoard` SHALL reject a non-integer `fogSeed` with the existing `not-integer` code and one outside the range with a new code
   `seed-out-of-range`, each with `subject: 'board'`, `field: 'fogSeed'` and the value, sorted with the other errors, so the result stays
   independent of ticket order.
3. THE engine SHALL export `DEFAULT_FOG_SEED` (0) for the callers that build a board from data that has no seed (the later CSV and MCP specs);
   the engine itself never applies it.
4. THE sample board SHALL fix one `fogSeed`, chosen before the chance curve is looked at (the date of its `now`, `20261116`) and never changed
   afterwards to make a number look better (Requirement 12).
5. THE seed SHALL survive every board operation that copies a board (exhume, resurrect, put down, reset): the state's board keeps the same value.
6. THE test generators, the fixtures, the sample board, the invalid-board screen (a sentence for `seed-out-of-range`) and the exports test
   SHALL be updated on purpose for the new field and the new code; no existing test is weakened.

### Requirement 2: One draw per ticket and night

**User Story:** As the engine's user, I want each ticket's bad luck to be its own, so that adding or removing a ticket never changes what the
others draw.

#### Acceptance Criteria

1. THE engine SHALL export `fogFactor(seed, key, night)`: an integer from 80 to 150 inclusive, a pure function of exactly those three inputs.
2. THE function SHALL use MurmurHash3 (x86, 32 bit), a well-known public-domain integer hash, over a stream of 32-bit words: the board seed as
   the hash seed; then one word per UTF-16 code unit of the key; then one word with the night number; the length term is the number of words
   × 4; the result goes through the standard finalizer. The factor is `80 + (hash mod 71)`. All of it is integer arithmetic (`Math.imul`,
   shifts, `>>> 0`, `%`); no floating point, no `Math.random`, no clock, no shared mutable state.
3. THE definition SHALL be exactly `MurmurHash3_x86_32` of the little-endian bytes of those words, so published test vectors apply (design,
   section 2). A known-answer test SHALL check the vectors the design lists.
4. THE key SHALL enter as its UTF-16 code units, so a key with an accent, an emoji or markup is hashed like any other and never throws.
5. A draw SHALL NOT depend on any other ticket, on the order of the tickets, on a ticket's effort, title or cost, or on the kept set. This is
   what makes the random numbers common (Requirement 5, P20).
6. THE 71 values SHALL all occur and be roughly even over many draws (a test over 80 000 draws; each value within 20 % of the expected count).

### Requirement 3: The simulation

**User Story:** As someone choosing a cut, I want to know how often it survives wrong estimates, so that I can see how fragile it is.

#### Acceptance Criteria

1. THE engine SHALL export `FOG_NIGHTS` (1000), `FOG_MIN_PCT` (80) and `FOG_MAX_PCT` (150), so the screen and the tests quote the same numbers.
2. THE engine SHALL export `simulateFog(board, kept, capacity)` returning a `Result` with `{ nights, holds, pct }`: for night 0 to 999, each kept
   ticket takes `ceil(effort × f / 100)` with `f = fogFactor(board.fogSeed, key, night)`, computed in integers as
   `floor((effort × f + 99) / 100)`; the night holds when the sum is ≤ `capacity`; `pct = floor(100 × holds / nights)`.
3. `kept` SHALL be read as a set: a repeated key counts once. A key that is not on the board SHALL give `{ ok: false, error: { code: 'unknown-key', key } }`.
   A `capacity` that is not a non-negative safe integer SHALL give `not-integer`.
4. AN empty kept set SHALL hold in every night (100 %, `holds` 1000), whatever the capacity.
5. THE result SHALL NOT depend on the order of `kept` or of `board.tickets`.
6. THE function SHALL be cheap: no allocation per night in the loop (typed arrays are made once per call), integer arithmetic only.
7. FOR a repeated use on one board the engine SHALL export `fogTable(board)` (the simulated effort of every ticket for every night, tickets in
   key order) and `fogFromTable(table, kept, capacity)`, which give the same answer as `simulateFog` and avoid hashing again. `simulateFog` SHALL
   be defined as the table version over the kept tickets, and a test SHALL check the two agree.

### Requirement 4: The curve

**User Story:** As the screen, I want the chance at every reserve step in one call, so that the strip below the slider is one list.

#### Acceptance Criteria

1. THE engine SHALL export `fogCurve(board, { now, freezeAt }, table?)` returning a `Result` with seven `FogPoint`s for `marginPct` 0, 5, … 30, in
   that order. For each step it solves the freeze with that reserve (`solveFreeze`), and for a solved freeze simulates the kept set against
   the **full** capacity.
2. A `FogPoint` SHALL be `{ marginPct, status: 'ok', capacity, effectiveCapacity, keptCount, keptEffort, fog: { nights, holds, pct } }` for a
   solved freeze and `{ marginPct, status: 'impossible', capacity, effectiveCapacity, needed, fog: null }` for an impossible one. Nothing about
   the fog is guessed for an impossible freeze.
3. THE curve SHALL use one table for all seven steps (the draws are the same for the same ticket whatever the reserve), and SHALL accept a table
   made by the caller so the screen can keep it between candle positions.
4. THE point for a given reserve SHALL equal what `simulateFog` gives for the kept set of `solveFreeze` at that reserve, checked by a test over
   generated boards.
5. THE curve SHALL return the engine's own error (for example `margin-invalid` cannot happen here, but a failing `solveFreeze` is passed on) and never throw.

### Requirement 5: Properties P19, P20 and P21

**User Story:** As the author of the rule, I want the fog proved like the rest of the engine, so that I can trust the number I put on a slide.

#### Acceptance Criteria

1. P19 (deterministic): over generated boards, the same board, seed and kept set give the same result; the result is the same when the tickets
   are shuffled; a different seed is allowed to give a different one (a test finds at least one such board, so the seed is not ignored).
2. P20 (fewer inside holds at least as often): over generated boards and generated subsets, for `S' ⊆ S` and any capacity,
   `chance(S') ≥ chance(S)` on `holds`, not only on `pct`. It holds because the draws are common and `ceil` is monotone.
3. P21 (extremes): over generated boards and kept sets, WHEN `Σ ceil(1.5 × effort) ≤ capacity` THEN the chance is 100 % (`holds` 1000); WHEN
   `Σ ceil(0.8 × effort) > capacity` THEN it is 0 % (`holds` 0). The sums are written in integers in the test (`ceil(3 × e / 2)`, `ceil(4 × e / 5)`).
4. Each property SHALL be its own `test('P19 …')`, `test('P20 …')`, `test('P21 …')` in `tests/engine/fog.test.ts`, and the traceability test
   SHALL list P19–P21 as in scope in that file (its "out of scope" comment is updated).
5. AN **independent reference implementation** in the tests SHALL compute the same result with its own hash (written from the design with
   `BigInt` masks, not `Math.imul`) and its own loop, and SHALL agree exactly with `fogFactor`, `simulateFog`, `fogFromTable` and every point of
   `fogCurve` on generated boards (0 to 80 tickets; up to 12 tickets also against the brute-force oracle for the kept set).
6. A generated board of 0 to 12 tickets SHALL give the same kept set from the solver and from the oracle for every reserve step, so the curve
   is checked against the oracle's kept sets, not only the solver's.
7. THE engine purity scan SHALL still pass (no clock, no randomness, no globals), and the exports test SHALL list the new exports on purpose.

### Requirement 6: More reserve does not always mean more chance

**User Story:** As a user, I must not be told something false, so the screen must not promise that a bigger reserve always helps.

#### Acceptance Criteria

1. THERE SHALL be NO property, test or claim that the chance rises with the reserve (docs/rule.md: with the pure optimum a bigger reserve can
   change the kept set into one that is not contained in the previous one).
2. A test SHALL **find** boards where a larger reserve gives a **lower** `holds` than a smaller one, by searching generated small boards with a
   fixed fast-check seed, and SHALL fail if it finds none within its budget (a prototype found such boards among random 3 to 8 ticket boards, for
   example a curve 7, 6, 6, 45, 45, 100, 100 %). It SHALL also keep one hand-written, minimal counter-example (found by the search, then written
   out as an example test) so the claim does not depend on the search alone.
3. THE test SHALL be named so that it reads as the reason the UI says nothing about "more reserve is safer" (Requirement 9.5).

### Requirement 7: The sign shows the chance

**User Story:** As a team lead, I want to see how likely my cut is to survive, as a number I can read from across the room.

#### Acceptance Criteria

1. THE fog slot of the sign (`[data-slot="fog"]`, `Chance the shelter holds: not built yet.`) SHALL be replaced by a fog block
   (`[data-region="fog"]`) with a painted line "Holds in **N %** of 1,000 nights" (the figure large, in the painted face; the numbers from the
   engine: `pct` of the current reserve's point, `FOG_NIGHTS`) and one sentence in the body face with the numbers: "Inside needs 59 points on
   paper; the team has 59; estimates land between 80 % and 150 %. It held on 6 of 1,000 nights." (`keptEffort`, `capacity`, `FOG_MIN_PCT`, `FOG_MAX_PCT`, `holds`, `FOG_NIGHTS`). The percentage is floored, so it can read 0 % while some nights hold; the sentence therefore always ends with the raw count, and the painted figure stays the percentage.
2. THE painted line SHALL be real text (a screen reader reads it), not an image and not `aria-hidden`; the block is a labelled region that is
   not a live region (what changes is announced by the existing announcer, which this spec does not change).
3. THE figure SHALL have one fixed colour; it SHALL NOT change colour or wording by thresholds (that would be the UI deciding), and SHALL NOT
   say "safe", "risky", "good" or "bad".
4. THE sentence SHALL use the full capacity as "the team has", also when a reserve is set; the reserve shows only through the numbers (with
   15 % the sentence reads "Inside needs 49 points on paper; the team has 59; …").
5. WHEN the freeze is impossible THE block SHALL say so with the engine's numbers ("No cut to test: the must-haves need 15 points; the team
   has 12.") and show no percentage.
6. A point whose `pct` is 0 and whose `holds` is above 0 SHALL read "0 %" in the figure and the strip, and its sentence and its strip sentence SHALL still give the count ("It held on 6 of 1,000 nights."; "5 % reserve: holds in 0 % of 1,000 nights (6 nights)"); a render test covers it.
7. WHEN the kept set is empty (a board of no tickets, or every ticket buried) THE block SHALL show 100 % and the sentence "Inside needs 0 points
   on paper; …" (the engine's answer, with no special case in the UI).
8. EVERY number in these sentences SHALL be a fact the engine returned (the number-provenance property of the UI tests is extended to them,
   reading "1,000" as the integer 1000).

### Requirement 8: The strip under the reserve slider

**User Story:** As someone who wants the demo message, I want to see the chance at every reserve at once, so I do not have to drag to find out.

#### Acceptance Criteria

1. UNDER the reserve slider THERE SHALL be a strip of seven items for 0, 5, … 30 %, in that order, each showing the reserve and the chance of
   that step (`pct` from the curve) as **text**, plus a small bar whose height is the chance (layout arithmetic only).
2. THE item of the current reserve SHALL be marked by more than colour: a frame, the text "now" (visible), and `aria-current="true"` (always on exactly one item: the slider always has a value, also when the freeze is impossible).
3. THE strip SHALL be an ordered list with an accessible name ("Chance the shelter holds, at each reserve") whose items read, for example,
   "15 % reserve: holds in 20 % of 1,000 nights (203 nights)", with "(current)" after "reserve" for the current one ("15 % reserve (current): …") and "impossible freeze" for a step with no cut.
4. THE strip SHALL take no focus and have no action in this spec (the slider is the control); it SHALL line up with the slider's seven steps
   on a wide screen and stay readable at 320 px (two lines of text per item if needed; no horizontal scroll).
5. THE strip SHALL NOT mark a "best" or "recommended" step, draw an arrow or a trend line between items, or use words that suggest the
   chance rises with the reserve.
6. THE bars SHALL animate only `transform` (and `opacity`); under `prefers-reduced-motion: reduce` they do not animate; the text carries every
   value, so nothing is lost.

### Requirement 9: No promise

**User Story:** As the author, I want a test that guards the honesty of the screen.

#### Acceptance Criteria

1. NO text of the fog block or the strip SHALL contain: "safer", "safe", "guarantee", "always", "better", "best", "recommend", "more reserve",
   "bigger reserve", "raises", "improves". A test scans the texts of the fog block and the strip in every state it can reach (all candle
   positions × all reserves of the sample board) and fails on any.
2. THE texts SHALL describe the numbers only: what the inside needs, what the team has, the range of estimates, and the chance.
3. THE README and the product text SHALL say that the chance can fall when the reserve grows (the steering "Non-goals" already say it must not
   be implied; this spec does not change that line).

### Requirement 10: The state, the cache and the speed

**User Story:** As someone dragging the candle on a low-end PC, I want the page to stay smooth.

#### Acceptance Criteria

1. THE curve SHALL be derived with the rest of the view (`View.fog`), from the state, by the engine; the UI SHALL NOT compute a chance, a
   count or a sum.
2. THE curve depends on the board, the candle and the present people, **not** on the reserve; the cache SHALL be keyed by the board's identity,
   the candle step and the people who are away, so moving the reserve slider only moves the highlight and never recomputes.
3. THE fog table SHALL be cached per board identity (a `WeakMap`), so dragging the candle costs seven solves and seven passes over the table
   and never any hashing after the first time.
4. A cached curve SHALL never answer for another board: a changed ticket list (exhume, put down) makes a new board object and so a new table.
5. Cost budget, measured and reported (not asserted tightly, because machines differ; the test only has a generous ceiling): on the sample
   board one curve (table cached) SHALL be about 1 ms; on a board of 80 tickets the first curve (table built) about 10 ms and a cached one
   about 3 ms, on the development machine.
6. IF the measured cost of a cached 80-ticket curve is above 8 ms on the development machine THEN the fog values SHALL be computed when the
   gesture settles (the existing 300 ms settle) and the sign SHALL show the last settled values with a visible "updating" mark, in the same
   change; the design describes this as plan B and the report says which plan was used and why.
7. THE sign SHALL NOT change height when the candle or the reserve moves: the fog block reserves the room of its tallest content at each
   width (like the readout of the sign), measured in a real browser at 1280, 820, 480, 360 and 320 px with the candle at all eleven steps and
   every reserve step; the candle region's top SHALL be the same in all of them.

### Requirement 11: Accessibility and look

**User Story:** As a keyboard or screen-reader user, I want the same information as everyone else.

#### Acceptance Criteria

1. THE fog block SHALL be a section of the sign with a heading-level name that does not break the heading order (no new `h2`; the block is
   labelled with `aria-labelledby` on its painted line or `aria-label`), and the strip an `ol` with `role="list"` kept.
2. EVERY colour SHALL come from the palette tokens; text SHALL use the pairs already checked in `contrast.test.ts` (the figure on the night
   panel: amber on night; the strip text on plywood or on the night, bone/tape/stone on night); no new hex colour.
3. THE new CSS SHALL pass the existing style tests (tokens, motion, focus and size rules, no pixel font size under 16 px) without loosening them.
4. THE a11y test SHALL cover the new region and list (names, no live region, no tab stop, `aria-current` on exactly one item when the freeze is
   solved at the current reserve, on none when it is impossible).

### Requirement 12: The demo message comes from the real numbers

**User Story:** As the author of the write-up and the video, I must quote numbers that the app really produces.

#### Acceptance Criteria

1. WHEN the engine and the screen are done THEN the real chance curve of the sample board at Friday 18:00 for 0, 5, … 30 % SHALL be computed
   by the engine and reported (also `holds`, the kept effort and the kept count of each step).
2. THE numbers 0 / 20 / 81 / 100 of the prototype came from its fake board; they SHALL NOT be a target. The sample board and its seed SHALL NOT be
   changed to reproduce them or to make the curve look nicer; if the real curve says something less tidy, the report says it as it is.
3. THE report SHALL also give, for information only, how much the curve moves with the seed (the minimum and maximum chance of each step
   over 20 other seeds), so nobody mistakes one seed for a measurement of the world. This is a report, not a change.
4. THE "Demo message" of `.kiro/steering/product.md` SHALL be rewritten with the real numbers (and only claims that those numbers support), and
   `docs/rule.md` SHALL get a dated section (in Spanish, like the rest) with the hash, the seed, the night numbering, the curve and the real numbers.
5. THE tests SHALL pin the real curve of the sample board (an example-based test, like the sample board's other facts), so a change to the hash,
   the seed or the sample board is a visible, deliberate change.

### Requirement 13: Nothing existing gets worse

**User Story:** As the maintainer, I want the rest of the project untouched except where the new field forces a change.

#### Acceptance Criteria

1. ALL existing tests SHALL stay green; the ones that must change (the exports list, the traceability scope, the generators and fixtures that
   build a board, the sample-board facts, `slots.test.ts` and `render-sign.test.ts` for the fog slot, `invalid-board.test.ts` for the new
   code, `a11y.test.ts` and the number-provenance test) SHALL be changed on purpose, one by one, and listed in the design.
2. `npm run typecheck`, `npm test` and `npm run build` SHALL pass; the gzipped JS plus CSS SHALL stay under the 60 kB budget (the report gives
   the new size).
3. THE solver, the diff, the exhume and put-down functions and their properties SHALL NOT change; `fogSeed` is read by `src/engine/fog.ts` only.
4. THE engine SHALL stay free of the DOM, Node-only APIs and browser APIs, and `fog.ts` SHALL import only engine files.

## Traceability

| Requirement | Verified by |
|---|---|
| 1 seed | `validate.test.ts`, `generators.test.ts`, `sample-board.test.ts`, `reducer.test.ts` (board keeps the seed), `invalid-board.test.ts` |
| 2 draw | `fog.test.ts` (known-answer vectors, range and evenness, reference agreement) |
| 3 simulation | `fog.test.ts` (examples, empty set, unknown key, table = simulate), P19–P21 |
| 4 curve | `fog.test.ts` (curve = simulate at each step; impossible points; oracle) |
| 5 properties | `fog.test.ts` P19, P20, P21; `traceability.test.ts` |
| 6 no promise (engine) | `fog.test.ts` (search for a decrease, pinned example) |
| 7 sign | `render-fog.test.ts`, `render-sign.test.ts`, `slots.test.ts`, `text.test.ts` (provenance) |
| 8 strip | `render-fog.test.ts`, `a11y.test.ts`, `tokens.test.ts` |
| 9 no promise (UI) | `render-fog.test.ts` (scan of all reachable texts) |
| 10 speed, cache, stable height | `derive.test.ts`, `fog-cache.test.ts`, `performance.test.ts` (ceiling), manual measurement in a real browser |
| 11 accessibility, look | `a11y.test.ts`, `contrast.test.ts`, `tokens.test.ts` |
| 12 demo message | `sample-board.test.ts` (pinned curve), `product.md`, `docs/rule.md`, the report |
| 13 nothing worse | the whole suite, `npm run build` |
