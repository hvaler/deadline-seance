# Design: rule-engine

Implements `requirements.md` in `src/engine`. Follows `.kiro/steering/{product,tech,structure}.md` and `docs/rule.md`.

## Module map

```
src/engine/
  types.ts        data model, Result, EngineError, constants (scale, slots)
  keys.ts         compareKeys (code-unit order), sorted helpers
  chain.ts        closure, dependents, cycle detection (iterative, no recursion limits)
  validate.ts     validateBoard -> ValidBoard | ValidationError[]
  weights.ts      integer weight scale (K0, K1) shared by validation and the solver
  capacity.ts     capacityBetween, effectiveCapacity (margin)
  cod.ts          SCALE, effectiveUrgency, costOfDelay, burialCost
  solver.ts       solveWithCapacity, solveFreeze (branch and bound)
  diff.ts         diffSolutions, exhume, resurrect, putDown
  oracle.ts       brute force, tests only, not exported
  index.ts        public API
tests/engine/
  generators.ts   fast-check arbitraries
  capacity.test.ts  cod.test.ts  solver.test.ts  impossible.test.ts
  exhume.test.ts    zombie.test.ts  diff.test.ts  validate.test.ts
  purity.test.ts    performance.test.ts
```

`structure.md` lists `facts`, `guard`, `csv`, `fog`, `chronicle` and `certificate`. They are not part of this spec.
`oracle.ts` lives in `src/engine` as the module list says and is excluded from `index.ts`.

## Types (`types.ts`)

```ts
export type Key = string;
export type Part = 'morning' | 'afternoon' | 'full';

export interface Absence { date: string; part: Part }            // 'YYYY-MM-DD' local date
export interface Person { name: string; pointsPerHalfDay: number; daysOff: readonly Absence[] }

export type Cost =
  | { kind: 'formula'; value: number; urgency: number; risk: number }
  | { kind: 'imported'; cod: number };

export interface Ticket {
  key: Key; title: string; effort: number; cost: Cost;
  mustHave: boolean; dependsOn: readonly Key[]; past: number;
}

export interface Board {
  tickets: readonly Ticket[]; people: readonly Person[];
  timeZone: string;            // IANA, default 'Europe/Madrid'
  nextReleaseWeeks: number;    // default 2
  zombieThreshold: number;     // default 3
  wontDo: readonly Key[];
}
export type ValidBoard = Board & { readonly __valid: unique symbol };   // only validateBoard makes one

export interface FreezeInput { now: number; freezeAt: number; marginPct: number }   // epoch ms, integers

export type Reason =
  | { kind: 'depends-on-buried'; buriedDependencies: Key[] }
  | { kind: 'blocked-by-put-down'; putDownKey: Key }
  | { kind: 'no-room'; needed: number; left: number };

export interface Buried { key: Key; reason: Reason; cod: number; burialCost: number; isZombie: boolean }

export interface SolvedSolution {
  status: 'ok'; capacity: number; effectiveCapacity: number; marginPct: number;
  kept: Key[]; buried: Buried[]; keptEffort: number; savedCod: number; zombies: Key[];
}
export interface ImpossibleSolution {
  status: 'impossible'; capacity: number; effectiveCapacity: number; marginPct: number;
  needed: number; blockedMustHaves: { key: Key; putDownKey: Key }[];
}
export type Solution = SolvedSolution | ImpossibleSolution;

export type Result<T> = { ok: true; value: T } | { ok: false; error: EngineError };
```

`ValidBoard` is a brand: solver, exhume and put down accept only validated boards, so an invalid board cannot reach them.
Functions that rewrite the board (`exhume`, `putDown`) return a new `ValidBoard` (it is valid by construction).

Arrays in results are always sorted by key. Inputs are never mutated; functions copy before sorting.

## Validation (`validate.ts`)

Collects every error, then sorts by `(code, key/person, detail)`. Cycle detection runs an iterative DFS with colors over keys
sorted ascending. Each cycle is reported once, rotated to start at its smallest key. The check ignores edges to `wontDo` keys.

`board-too-large` check (see the solver weights): `Σweight × (Σeffort + 1) ≤ Number.MAX_SAFE_INTEGER`. For an 80-ticket board with
`cod ≤ 60` and effort ≤ 100 this is about 10^13, far under 9×10^15.

## Capacity (`capacity.ts`)

```
capacityBetween(people, timeZone, from, to): Result<number>
effectiveCapacity(capacity, marginPct): Result<number>   // floor(capacity*(100-m)/100), m in {0,5,...,30}; else margin-invalid
```

Slot midpoints are local 11:00 (morning) and 16:00 (afternoon). Algorithm:

1. If `to ≤ from` return 0.
2. Convert `from` and `to` to local civil dates with `Intl.DateTimeFormat(…, {timeZone}).formatToParts`. Iterate civil days
   from the first to the last date using `Date.UTC(y, m, d)` arithmetic (arguments always given), skipping Saturday and Sunday.
3. For each day and each of the two midpoints compute the epoch instant of that local time: guess `Date.UTC(y,m,d,h)`, subtract the zone
   offset at the guess, re-check the offset at the result and correct once. Offsets come from `formatToParts` of the instant.
   11:00 and 16:00 exist on every day in the supported zones; for an odd zone where they do not, the instant after the gap is used.
4. A slot counts if `from ≤ midpoint < to`. For each person add `pointsPerHalfDay` for every counted slot that is not covered by one of their
   absences (`full` covers both slots).
5. If the range spans more than 366 civil days return `range-too-long` (guards against a runaway loop).

The formatter for each time zone is created once and kept in a module-level `Map` (a cache of a pure function; it does not affect
results). `Intl` is part of ECMAScript and exists in browsers, Node and Vitest, so the engine stays portable.

P14 follows from the half-open `from ≤ midpoint < to` rule. P11 follows because each of the four changes only removes counted
(slot, person) pairs.

## Cost of delay (`cod.ts`)

```
SCALE = [1,2,3,5,8,13,20]
effectiveUrgency(urgency, past): index = SCALE.indexOf(urgency); SCALE[min(index + past, 6)]
costOfDelay(ticket): formula -> value + effectiveUrgency(urgency, past) + risk ; imported -> cod
codParts(ticket): { value, urgency, effectiveUrgency, risk, past, imported }
burialCost(ticket, board) = cod * nextReleaseWeeks
```

## Solver (`solver.ts`)

### Preparation

1. `byKey`: map of tickets. `blocked`: tickets whose closure reaches a `wontDo` key; the smallest such key is kept for the reason.
2. `closure(i)` and `dependents(i)` via `chain.ts`, memoized (graph is acyclic after validation).
3. `base` = union of closures of all must-haves. If any must-have is blocked, or `effort(base) > effectiveCapacity`, return the
   impossible solution (`needed = effort(base)`; blocked must-haves listed). This is the exact P9 condition.
4. Candidates = tickets not blocked and not in `base`. Their cost to add is `effort(closure \ base)`.

### Exact lexicographic objective as one integer

The order is: more `savedCod`, then more kept tickets (= fewer buried), then more kept effort (= less buried effort, because total effort
is fixed), then the alphabetical rule. The first three fold into one integer weight per ticket:

```
E  = Σ effort over all tickets          K0 = E + 1          K1 = (N + 1) × K0
w_i = cod_i × K1 + K0 + effort_i
```

For a set with `c` tickets and effort `e ≤ E`: `Σw = savedCod × K1 + c × K0 + e`, and `c × K0 + e < K1`, so comparing `Σw` is the same as comparing
`(savedCod, c, e)` lexicographically. `board-too-large` guarantees the arithmetic below stays under 2^53.

### Branch and bound

- Candidates are ordered by ratio `w_i / effort_i` descending, ties by key. Zero-effort tickets go first. The ratio comparison is
  done with cross-multiplication in integers. The order only affects speed, never the result.
- State: `included` (closed set, starts as `base`), `excluded`, `weight`, `effort`. Depth-first over the ordered candidates:
  - **Include** `i` (if undecided): add `closure(i) \ included`; allowed only if the added effort fits the remaining capacity.
  - **Exclude** `i`: mark `i` and all `dependents(i)` as excluded (this is what makes P27 hold, and it tightens the bound).
- **Bound**: `weight + fractional knapsack` over the undecided, non-excluded candidates individually with the remaining capacity (this ignores
  precedence, so it is a valid upper bound). Integer only: take whole items in ratio order, add `floor(w × left / effort)` for the first one that
  does not fit.
- **Prune** only when `bound < bestWeight` (strict), so equal-weight alternatives survive to the alphabetical tie-break.
- **Shortcut**: if the effort of all undecided, non-excluded candidates fits, include them all and evaluate the leaf.
- **Leaf**: the kept set is `included`. If `weight > bestWeight`, take it. If equal, compare the sorted buried-key lists element by element
  with `compareKeys` and keep the smaller. (The sets have equal size at equal weight, so the lists have equal length.)

Worst case is exponential (the problem is NP-hard); for real boards of about 80 tickets the ratio order and the strict bound keep it fast.
The performance test guards this (Requirement 14).

### Output

After the search: `buried` = tickets not kept. Reason per buried ticket, checked in this order:

1. `blocked-by-put-down` if the ticket is blocked.
2. `depends-on-buried` if any direct dependency is buried (list those). This makes the cascade visible.
3. `no-room` with `needed = effort(ticket)` and `left = effectiveCapacity − keptEffort`. If all direct dependencies are kept and the
   ticket still did not fit, then `needed > left`: otherwise adding it would raise the weight, contradicting optimality. The code asserts this
   invariant in a test, not at runtime.

`isZombie = past + 1 ≥ zombieThreshold` for buried tickets; `zombies` lists them. `burialCost = cod × nextReleaseWeeks`.

`solveFreeze` = `capacityBetween` + `solveWithCapacity`. `solveWithCapacity` exists so P6 can vary the capacity directly.

## Diff, exhume, put down (`diff.ts`)

```
diffSolutions(before, after): Result<Diff>        // both must be status 'ok'
Diff = { raised: {key,cod}[]; sunk: {key,cod}[]; codDelta: number }

exhume(board, freeze, key): Result<
  | { kind: 'applied'; board: ValidBoard; before: SolvedSolution; after: SolvedSolution; diff: Diff }
  | { kind: 'rejected'; impossible: ImpossibleSolution }>
resurrect = exhume
putDown(board, freeze, key): Result<{ board: ValidBoard; before: SolvedSolution; after: SolvedSolution; diff: Diff }>
```

- `exhume`: copy the board with `mustHave: true` on that ticket, solve. If impossible, return `rejected` with the original board untouched.
  If `before` is already impossible, the result is also `rejected`.
- `putDown`: solve; the key must be buried and a zombie, else `not-a-zombie` / `unknown-key`. Remove the ticket, append the key to `wontDo`
  (kept sorted), re-solve. Tickets that depended on it are blocked and stay buried.
- A solution lists the `cod` of its buried tickets only, so `diffSolutions` takes the `cod` of a raised ticket from `before.buried` and of a sunk
  ticket from `after.buried`. Both solutions must come from boards with the same costs (true for a new candle, team, exhume or put down).
  A put-down ticket was buried, so it is never in `raised` or `sunk`.

### Why P18 holds with this design

In the new board every candidate set that does not contain the removed ticket `R` is still a candidate with the same weight; sets that
contained `R` no longer exist. The old optimum did not contain `R`, so it remains feasible and best. The tie-break order is preserved
because `R` was in every compared buried list: deleting a common element does not change the symmetric difference of two sorted lists, and
equal-size sorted lists are ordered by their smallest differing element. Dependents of `R` could not be in any candidate before (their
closure contains `R`), so blocking them changes nothing.

## Later addition: totals (spec `board-ui`, 2026-11-13)

`SolvedSolution` also carries `buriedEffort` and `buriedCod`, and `Diff` carries `raisedCod` and `sunkCod`, so a UI can show sums without adding engine
numbers itself. They are plain sums of values already in the solution; no decision of the rule changes. `tests/engine/totals.test.ts` checks them (named
without a P number), and P15 also asserts `raisedCod − sunkCod = codDelta`.

## Testing design

### Generators (`tests/engine/generators.ts`)

- `arbBoard({ maxTickets, withMustHaves, withWontDo })`: keys `T-01`…; a ticket may only depend on lower-index tickets (acyclic), then
  the list is shuffled by a fast-check permutation; effort 0–13 (0–30 for large boards), formula costs from the scale, some imported `cod`,
  `past` 0–5, mustHave probability about 10 % (low, so impossible freezes are rare unless asked for).
- `arbCapacity(board)`: integer from 0 to total effort + a few, so fits and no-fits both appear.
- `arbPeople`, `arbAbsences`, `arbInstant`: instants in a window of a few weeks that includes the European and US daylight-saving changes
  for the zones `Europe/Madrid`, `America/New_York`, `Asia/Kolkata` (a non-whole-hour offset) and `UTC`.
- `arbMargin`: one of 0, 5, …, 30.
- `arbBoardForImpossible`: boards with enough must-haves to hit the impossible branch half of the time (P9).

### Property tests

| Test | How |
|---|---|
| P1, P22 | solve; assert `keptEffort ≤ capacity` and `keptEffort ≤ effectiveCapacity` |
| P2 | status ok implies no must-have buried |
| P3, P27 | for every kept ticket all dependencies kept; for every buried ticket all dependents buried (also with `wontDo`) |
| P4 | kept ∪ buried = all keys, kept ∩ buried = ∅ |
| P5 | boards ≤ 12 tickets; compare `savedCod` and the kept set with `oracle`; 1,000 runs |
| P6 | solve with `c` and `c + k`; `savedCod` not lower |
| P7 | solve a board and a permuted copy (tickets, people, `dependsOn`); `toEqual` |
| P8 | only when status is `ok`; skip buried tickets with reason `blocked-by-put-down`; for each other buried ticket with `cod > 0`, effort of itself plus its buried transitive dependencies `> gap` (boards include `wontDo` keys so the exclusion is exercised) |
| P9 | independently compute the must-have closure effort in the test; impossible exactly when it exceeds `effectiveCapacity` or a must-have is blocked |
| P10 | exhume a random buried ticket; if applied, it is kept and `after.savedCod ≤ before.savedCod`; if rejected, the numbers match P9 |
| P11 | four variants (later `now`, earlier `freezeAt`, remove a person, add an absence); capacity not higher |
| P14 | `from ≤ b ≤ to` on random instants; capacities add up |
| P15 | two solutions of the same board with different capacity (and after exhume); the sums match and the sets are disjoint |
| P16 | raise one component to a higher scale step of a kept ticket; it stays kept |
| P17 | `zombies` equals the buried tickets with `past + 1 ≥ threshold` (random thresholds from 1) |
| P18 | threshold 1 so any buried ticket is a zombie; put one down; same `savedCod` and same kept set |
| P23 | `effectiveUrgency` monotone in `past`, ≥ urgency, ≤ 20 |

Example-based tests cover: validation errors (each code, a three-ticket cycle rotated to the smallest key, unknown key, key in `wontDo`
is accepted), capacity (known week, 12:00 edge, weekend, European DST change, `full` absence), reasons (one example per kind), impossible
numbers (54 needed versus 41), the `CRYPT-12 < CRYPT-2` key order, and the purity scan.

The purity test uses `import.meta.glob('../../src/engine/**/*.ts', { query: '?raw', eager: true })` and searches the sources, so it needs no Node
types. `performance.test.ts` generates 20 boards of 80 tickets and fails above 2 s each.

### Error handling summary

Invalid board: `ValidationError[]` from `validateBoard`. Invalid arguments at call time (`margin-invalid`, `range-too-long`, `unknown-key`,
`not-a-zombie`): `{ ok: false, error }`. A freeze that cannot be met is not an error; it is `status: 'impossible'` with numbers.
