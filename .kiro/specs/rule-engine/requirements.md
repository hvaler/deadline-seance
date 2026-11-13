# Requirements: rule-engine

Scope: `src/engine` only. The pure, deterministic rule that decides which tickets to keep and which to bury. No UI, no fog
simulation (feature 2), no MCP server (feature 8), no CSV, no certificate, no LLM guard. Source of truth: `docs/rule.md`
(later sections override earlier drafts) and the steering files.

## Introduction

Given a board (tickets, people, absences), a clock reading (`now`), a freeze time (`freezeAt`) and a safety margin, the
engine computes the capacity, picks the optimal set of tickets to keep, and explains the result with structured facts. It
also re-solves after exhuming a tombstone or putting down a zombie, and diffs two solutions. Every quantity is an integer.
The engine never reads the clock, never uses randomness, and has no DOM or Node-only dependency.

## Glossary

- **Ticket**: `key`, `title`, `effort` (points left, integer ≥ 0), cost of delay, `mustHave`, `dependsOn[]`, `past`
  (releases in a row it has been left out, integer ≥ 0).
- **Kept / Buried**: tickets inside / outside the release. Buried tickets are the tombstones.
- **Closure** of a ticket: the ticket plus everything it depends on, in chain.
- **Dependents** of a ticket: every ticket whose closure contains it.
- **Slot**: a half day. Morning 09:00–13:00 (midpoint 11:00), afternoon 14:00–18:00 (midpoint 16:00), Monday to Friday, in
  the board time zone.
- **Capacity**: points available between `now` and `freezeAt`. **Effective capacity**: capacity after the margin.
- **Zombie**: a buried ticket with `past + 1 ≥ zombieThreshold`.
- **Put down** ("rematar"): a zombie closed as Won't Do and removed from the board.
- **Saved cod**: sum of `cod` of the kept tickets.

## Requirements

### Requirement 1: Data model and integer arithmetic

**User Story:** As the author of the UI and the MCP server, I want one typed, integer-only input and output model, so that
no number is ever computed outside the engine.

#### Acceptance Criteria

1. THE engine SHALL define types for `Ticket`, `Person`, `Absence`, `Board`, `FreezeInput`, `Solution`, `Reason`, `Diff` and
   the engine errors, in `src/engine/types.ts`, with no `any`.
2. A `Ticket` SHALL carry its cost of delay as either formula components (`value`, `urgency`, `risk`) or an imported `cod`
   (a single integer), never both.
3. A `Board` SHALL hold `tickets`, `people`, `timeZone` (IANA name, default `Europe/Madrid`), `nextReleaseWeeks` (integer
   ≥ 0, default 2), `zombieThreshold` (integer ≥ 1, default 3) and `wontDo` (keys of tickets put down).
4. `now` and `freezeAt` SHALL be integer epoch milliseconds passed in by the caller. `marginPct` SHALL be an integer.
5. WHEN any engine function returns a quantity (capacity, effort, `cod`, cost, probability-free counts) THEN it SHALL be a
   safe integer. The engine SHALL NOT use floating point in any decision.
6. THE sort order for keys SHALL be plain UTF-16 code-unit order (`a < b`), never locale-dependent comparison.

### Requirement 2: Board validation

**User Story:** As a user loading a board, I want a bad board to be rejected with the exact cause, so that I can fix it.

#### Acceptance Criteria

1. `validateBoard` SHALL return either a validated board (a branded type that the other functions require) or the complete
   list of errors, each with a stable `code` and the offending key, person or value.
2. THE validator SHALL report: `duplicate-key`, `unknown-dependency` (key not in `tickets` and not in `wontDo`),
   `self-dependency`, `dependency-cycle` (the keys of the cycle, rotated so the smallest key is first), `not-integer`,
   `negative-number`, `urgency-off-scale` (not in 1, 2, 3, 5, 8, 13, 20; the same scale applies to `value` and `risk`),
   `invalid-time-zone`, `invalid-threshold`, `wont-do-key-in-tickets`, `invalid-absence` and `board-too-large`.
3. WHEN the board is too large for the solver's exact integer arithmetic (see design: the scalar weight would exceed
   `Number.MAX_SAFE_INTEGER`) THEN validation SHALL report `board-too-large` rather than risk wrong results.
4. A dependency on a key in `wontDo` SHALL be valid. It is not an unknown key.
5. THE validator SHALL be independent of the order of `tickets`, `people` and `dependsOn`: the same set of errors, sorted
   deterministically.

### Requirement 3: Half-day capacity

**User Story:** As a team lead, I want capacity counted in half days with absences and time zone, so that dragging the candle
or removing a person changes it exactly as I expect.

#### Acceptance Criteria

1. `capacityBetween(people, timeZone, from, to)` SHALL return the sum, over every person, of `pointsPerHalfDay` for each slot
   that counts and where the person is present.
2. A slot SHALL count if and only if its midpoint (11:00 or 16:00 local time on a Monday to Friday) satisfies
   `from ≤ midpoint < to`.
3. An `Absence` SHALL be a local date `YYYY-MM-DD` with a part (`morning`, `afternoon` or `full`). A person is absent for the
   slots it covers.
4. Local times SHALL be resolved through the IANA zone, so daylight saving changes do not shift a slot. The engine SHALL use
   only the ECMAScript `Intl` API for this.
5. IF `to ≤ from` THEN the capacity SHALL be 0.
6. **P14 (slots)**: for any `from ≤ b ≤ to`, `capacityBetween(from, to) = capacityBetween(from, b) + capacityBetween(b, to)`.
7. **P11 (capacity never grows)**: moving `from` (now) later, moving `to` (freezeAt) earlier, removing a person, or adding an
   absence SHALL never increase the capacity.
8. IF the range spans more than 366 civil days THEN the function SHALL return a `range-too-long` engine error.
9. Example-based tests SHALL pin: a known week, the 12:00 cut (a freeze at 12:00 keeps the morning), a start at 12:00 (drops
   the morning), a weekend, and the European daylight-saving change.

### Requirement 4: Cost of delay and zombie hunger

**User Story:** As a team lead, I want the cost of delay to be a visible formula that grows when a ticket keeps being left
out, so that the same ticket does not get buried forever without anyone noticing.

#### Acceptance Criteria

1. THE scale SHALL be 1, 2, 3, 5, 8, 13, 20.
2. `effectiveUrgency(urgency, past)` SHALL be the urgency raised `past` steps on the scale, capped at 20.
3. For a formula ticket, `cod = value + effectiveUrgency(urgency, past) + risk`. For an imported ticket, `cod` is the
   imported integer and hunger is not applied.
4. THE engine SHALL expose the parts (value, urgency, effective urgency, risk, `past`) so the UI can show "urgency 1 → 5,
   3 releases out".
5. **P23 (hunger)**: `effectiveUrgency` never decreases when `past` increases, is never below the original urgency, and never
   exceeds 20.
6. **P16 (formula)**: raising `value`, `urgency` or `risk` of a ticket to a higher step of the scale (or raising an imported
   `cod`), with everything else equal, never makes the engine bury that ticket if it was kept before.
7. THE cost of burying a ticket SHALL be `cod × nextReleaseWeeks`, exposed per buried ticket.

### Requirement 5: The solver (pure optimum)

**User Story:** As a team lead, I want the best possible cut that respects what I cannot drop, so that I can trust the list.

#### Acceptance Criteria

1. `solveWithCapacity(board, capacity, marginPct)` and `solveFreeze(board, freezeInput)` SHALL return a `Solution` with the
   kept keys, the buried tickets (each with a reason), `savedCod`, `keptEffort`, `capacity`, `effectiveCapacity` and the
   zombies. Output arrays SHALL be sorted by key.
2. THE kept set SHALL satisfy all of: it fits the effective capacity; it contains every must-have; it is closed under
   `dependsOn`; it contains no ticket whose closure reaches a key in `wontDo`.
3. AMONG sets that satisfy 2, THE solver SHALL choose the one that maximizes `savedCod`; then buries fewer tickets; then
   buries less effort; then has the alphabetically smaller list of buried keys (sorted lists compared element by element).
4. THE result SHALL NOT depend on the order of `tickets`, `people` or `dependsOn`.
5. EACH buried ticket SHALL have one structured reason: `depends-on-buried` (with the buried direct dependencies),
   `blocked-by-put-down` (with the put-down key), or `no-room` (with the effort needed and the points left).
6. The solver SHALL use branch and bound over dependency closures with an integer bound (see design), not enumeration.
7. **P1 (fits)**: `keptEffort ≤ capacity`.
8. **P2 (must-haves)**: no must-have is buried when the solution is not impossible.
9. **P3 (dependencies)**: if a ticket is kept, every ticket it depends on is kept.
10. **P4 (partition)**: kept and buried do not overlap and together are exactly the board's tickets.
11. **P5 (optimal)**: for boards of at most 12 tickets, `savedCod` equals the brute-force oracle's, and the kept set equals the
    oracle's kept set (stronger than the doc: it also checks the tie-break).
12. **P6 (more capacity)**: if the capacity grows, `savedCod` does not drop.
13. **P7 (determinism)**: the same board with tickets, people and dependencies in a different order gives exactly the same
    solution.
14. **P8 (nothing left over)**: WHEN the solution status is `ok`, no buried ticket with `cod > 0` fits in the remaining gap
    together with its buried dependencies (gap = effective capacity − kept effort). Buried tickets whose reason is
    `blocked-by-put-down` are excluded from the check, because they can never be kept. The property is not checked for an
    `impossible` solution.
15. **P27 (cascade)**: if a ticket is buried, every one of its dependents is buried.

### Requirement 6: Integer margin

**User Story:** As a team lead, I want to keep a reserve, so that the cut survives estimates that fail.

#### Acceptance Criteria

1. `marginPct` SHALL be an integer from 0 to 30 in steps of 5. Any other value SHALL be an engine error.
2. `effectiveCapacity = floor(capacity × (100 − marginPct) / 100)`, using integer arithmetic only.
3. THE solver SHALL fit the kept set to the effective capacity.
4. **P22 (margin)**: the effort of the kept set never exceeds the effective capacity.

### Requirement 7: Impossible freeze

**User Story:** As a team lead, I want the engine to say plainly when the must-haves cannot fit, with the numbers, so that I know
what to change.

#### Acceptance Criteria

1. WHEN the union of the closures of all must-haves needs more effort than the effective capacity, OR any must-have is
   blocked by a put-down key, THEN the solver SHALL return `status: 'impossible'` instead of a kept set.
2. THE impossible result SHALL carry: `needed` (effort of the must-have union), `capacity`, `effectiveCapacity`, and for a
   blocked must-have the must-have key and the put-down key. The engine SHALL NOT produce prose; the numbers are the facts
   the UI formats.
3. **P9 (impossible iff)**: the solver returns impossible exactly when `needed > effectiveCapacity` or a must-have is
   blocked. In particular, with no put-down keys it is exactly "the must-haves with their dependencies exceed the capacity".

### Requirement 8: Exhume

**User Story:** As a team lead, I want to bring a tombstone back and see what it costs, so that I can decide with eyes open.

#### Acceptance Criteria

1. `exhume(board, freezeInput, key)` SHALL mark the ticket as a must-have and re-solve, returning the new board, the old and
   new solutions and their diff (Requirement 10).
2. IF the key is unknown THEN it SHALL return an engine error.
3. IF exhuming makes the freeze impossible THEN it SHALL return the impossible result with its numbers, the board SHALL be
   left unchanged and the exhumation SHALL NOT be applied.
4. Exhuming a ticket that is already kept SHALL succeed and keep the same solution.
5. **P10 (exhume)**: after a successful exhume the ticket is kept and `savedCod` is not greater than before.

### Requirement 9: Zombies and putting down

**User Story:** As a team lead, I want to see which tickets keep getting left out and either revive or close them.

#### Acceptance Criteria

1. THE solution SHALL list the zombies: the buried tickets with `past + 1 ≥ zombieThreshold`. Kept tickets are never zombies.
2. **P17 (zombie)**: a ticket is a zombie if and only if it is buried and `past + 1 ≥ zombieThreshold`.
3. Resurrecting a zombie SHALL be the same operation as `exhume` (exported as an alias).
4. `putDown(board, freezeInput, key)` SHALL accept only a zombie. For any other key it SHALL return an engine error and leave
   the board unchanged.
5. A successful put down SHALL remove the ticket from `tickets`, add its key to `wontDo`, and re-solve. Tickets that depend on
   a key in `wontDo` SHALL be buried with reason `blocked-by-put-down` (the dependency is gone, so they cannot ship).
6. **P18 (put down)**: putting down a zombie does not change `savedCod` nor which tickets are kept.

### Requirement 10: Diff between two solutions

**User Story:** As a team lead, I want to know what rose, what sank and what it cost whenever the rule re-solves.

#### Acceptance Criteria

1. `diffSolutions(before, after)` SHALL return `raised` (buried before, kept after), `sunk` (kept before, buried after), both
   sorted by key and each entry with its `cod`, and `codDelta = after.savedCod − before.savedCod`.
2. WHEN either solution is impossible THEN `diffSolutions` SHALL return an engine error rather than a partial diff.
3. **P15 (diff)**: `Σ cod(raised) − Σ cod(sunk) = codDelta`, and no key is in both `raised` and `sunk`.
4. THE diff SHALL be the data the UI uses for sentences like "CRYPT-4 rises (30). CRYPT-1 and CRYPT-2 sink (22). Gain: 8".

### Requirement 11: Brute-force oracle

**User Story:** As a maintainer, I want an independent reference, so that the solver is proven and not just trusted.

#### Acceptance Criteria

1. `src/engine/oracle.ts` SHALL enumerate every subset of tickets, filter by the constraints of Requirement 5.2 and rank
   by the order of Requirement 5.3, returning the best.
2. THE oracle SHALL throw for more than 16 tickets.
3. THE oracle SHALL be written from the rule text and SHALL NOT import the solver's comparison or closure code.
4. THE oracle SHALL NOT be exported from `src/engine/index.ts`.

### Requirement 12: Purity and determinism

**User Story:** As a maintainer, I want the engine to stay pure, so that the same input always gives the same output in the browser,
in Vitest and in the MCP server.

#### Acceptance Criteria

1. `src/engine` SHALL NOT contain `Date.now`, `new Date()` with no arguments, `Math.random`, `window`, `document`,
   `localStorage`, `fetch`, `process` or `require`. A test SHALL scan the sources and fail if any appears.
2. `src/engine` SHALL NOT import from `src/ui`, `mcp` or `tests`.
3. `tsconfig.engine.json` (lib `ES2022` only, no DOM) SHALL compile `src/engine` and `tests/engine`.
4. THE public API SHALL be exported only from `src/engine/index.ts`.
5. Functions SHALL NOT mutate their inputs. Calling a function twice with the same input SHALL give deeply equal output.

### Requirement 13: Project scaffold and test setup

**User Story:** As a maintainer, I want a reproducible toolchain.

#### Acceptance Criteria

1. THE project SHALL use Vite, TypeScript in strict mode, Vitest and fast-check, all pinned to exact versions in
   `package.json` and locked in `package-lock.json`.
2. `npm test`, `npm run typecheck` and `npm run build` SHALL pass.
3. Each property in the traceability table SHALL be its own `test(...)` whose name starts with the property number (for
   example `P5 optimal vs oracle`), using fast-check with at least 200 runs (1,000 for P5 and P7).
4. Shared generators SHALL live in `tests/engine/generators.ts`: acyclic boards of 0–12 tickets (oracle) and up to 80
   tickets (other properties), people with absences, times around daylight-saving changes, and scale values.
5. WHEN a property fails THEN the seed and the shrunk counterexample SHALL be reported by fast-check; the failure is a solver
   bug unless the property is proven wrong in `docs/rule.md`.

### Requirement 14: Performance on a low-end PC

#### Acceptance Criteria

1. THE solver SHALL solve a generated board of 80 tickets in well under 100 ms on a typical laptop, so the candle can be
   dragged and re-solved live. A test SHALL fail if any of 20 generated 80-ticket boards takes more than 2 seconds (a generous
   ceiling that catches blow-ups without being flaky).
2. THE capacity function SHALL not allocate per slot beyond what the `Intl` conversion needs, and SHALL cache the formatter per
   time zone.

## Property traceability

| Property | Requirement | Test file | In scope |
|---|---|---|---|
| P1 fits | 5.7 | `tests/engine/solver.test.ts` | yes |
| P2 must-haves | 5.8 | `solver.test.ts` | yes |
| P3 dependencies | 5.9 | `solver.test.ts` | yes |
| P4 partition | 5.10 | `solver.test.ts` | yes |
| P5 optimal | 5.11, 11 | `solver.test.ts` | yes |
| P6 more capacity | 5.12 | `solver.test.ts` | yes |
| P7 determinism | 5.13 | `solver.test.ts` | yes |
| P8 nothing left over | 5.14 | `solver.test.ts` | yes |
| P9 impossible iff | 7.3 | `impossible.test.ts` | yes |
| P10 exhume | 8.5 | `exhume.test.ts` | yes |
| P11 capacity never grows | 3.7 | `capacity.test.ts` | yes |
| P12 epitaph guard | n/a | n/a | **no**: belongs to the guard module (out of scope) |
| P13 CSV round trip | n/a | n/a | **no**: belongs to the csv module (out of scope) |
| P14 slots | 3.6 | `capacity.test.ts` | yes |
| P15 diff | 10.3 | `diff.test.ts` | yes |
| P16 formula | 4.6 | `cod.test.ts` | yes |
| P17 zombie | 9.2 | `zombie.test.ts` | yes |
| P18 put down | 9.6 | `zombie.test.ts` | yes |
| P22 margin | 6.4 | `solver.test.ts` | yes |
| P23 hunger | 4.5 | `cod.test.ts` | yes |
| P27 cascade | 5.15 | `solver.test.ts` | yes |

P12 and P13 fall inside the range P1–P18 but need the number guard and the CSV module, which this spec leaves out. They go in
the next specs. P19–P21 (fog), P24 (certificate), P25 (undo) and P26 (CSV import) are also out of scope.

## Decisions taken in this spec (not explicit in `docs/rule.md`)

- **Put down vs dependents.** `docs/rule.md` says removing a buried ticket does not change the solution (P18) but does not say what
  happens to tickets that depend on it. If the dependency simply vanished, those tickets could become keepable and P18 would
  break. So the key goes to `wontDo` and its dependents stay buried (`blocked-by-put-down`).
- **Put down only for zombies.** The doc gives the two actions to zombies. P18 tests use `zombieThreshold = 1`, where every
  buried ticket is a zombie.
- **P9 with put downs.** A must-have blocked by a put-down key also makes the freeze impossible. Without put-down keys this is
  the doc's statement.
- **Time as epoch milliseconds.** Keeps the engine free of date parsing and of the system clock. The UI converts.
- **Key order.** UTF-16 code-unit order, so `CRYPT-12` sorts before `CRYPT-2`.
