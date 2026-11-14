# Design: fog

Read with `requirements.md` (the numbers in brackets point at its requirements). The rule is `docs/rule.md` §2 and P19–P21; this document
only adds what the implementation must decide.

## 1. Shape of the change

```
src/engine/hash.ts        MurmurHash3 x86 32-bit over 32-bit words            (new, pure)
src/engine/fog.ts         fogFactor, fogTable, fogFromTable, simulateFog, fogCurve, constants   (new, pure)
src/engine/types.ts       Board.fogSeed, ValidationErrorCode 'seed-out-of-range', DEFAULT_FOG_SEED
src/engine/validate.ts    checks fogSeed
src/engine/index.ts       exports the above

src/ui/derive.ts          View.fog (the curve, the current point)
src/ui/fog-cache.ts       the table per board, the curve per (board, candle, people away)
src/ui/text.ts            the fog sentences and the strip items, facts only
src/ui/render/fog.ts      the fog block and the strip (DOM, textContent only)
src/ui/render/sign.ts     places the strip under the reserve slider and the block where the slot was
src/ui/styles/*.css       the look (palette tokens only)
src/ui/sample-board.ts    fogSeed 20261116
```

Dependencies keep pointing one way: `ui → engine`. Nothing in `src/engine` changes behaviour except by adding `fog.ts` and `hash.ts`; the
solver, diff, exhume and put-down are untouched (13.3).

## 2. The hash and the draw (Requirement 2)

**Choice: MurmurHash3, x86, 32-bit** (Austin Appleby, public domain). It is small, well known, has published test vectors, needs only 32-bit
integer operations (`Math.imul`, shifts, xor, `>>> 0`) and mixes well enough that 71 buckets come out even. FNV-1a was the other candidate: it is
simpler but weaker in the low bits, and the factor uses `mod 71`.

**Input as words.** The message is a sequence of 32-bit words:

```
words = [ unit(key[0]), unit(key[1]), …, unit(key[n-1]), night ]       n = key.length in UTF-16 code units
hash  = MurmurHash3_x86_32( bytes = little-endian bytes of the words, seed = board.fogSeed )
```

Because every block is a whole 4-byte word there is no tail, so the algorithm is just:

```
h = seed | 0
for each word w:                       // body of MurmurHash3_x86_32, one block per word
    k = imul(w, 0xcc9e2d51); k = rotl32(k, 15); k = imul(k, 0x1b873593)
    h ^= k; h = rotl32(h, 13); h = imul(h, 5) + 0xe6546b64   (wrapped to 32 bits)
h ^= (number of words) * 4             // the length in bytes
h ^= h >>> 16; h = imul(h, 0x85ebca6b); h ^= h >>> 13; h = imul(h, 0xc2b2ae35); h ^= h >>> 16     // fmix32
factor = 80 + ((h >>> 0) % 71)
```

- **Why the length term matters:** the night word comes last, so a key that happens to contain the code unit 5 cannot collide with a shorter key
  and night 5: the word counts differ.
- **Why `% 71`:** it is plain integer arithmetic (no division by a float). The bias of `2^32 mod 71` is about 1 part in 60 million, far below
  anything the chance can show. A multiply-shift would also work; `%` is easier to reproduce in the BigInt reference.
- **Night numbers:** 0 to 999.
- **Performance trick:** the state after the key words does not depend on the night. `fogTable` runs the key words once per ticket and then only
  one more block and the finalizer per night.
- **Published vectors** (checked with a prototype before this document was written; they become a known-answer test): with no words, seed 0 →
  `0x00000000`; seed 1 → `0x514E28B7`; seed `0xFFFFFFFF` → `0x81F16F39`. One word `0xFFFFFFFF`, seed 0 → `0x76293B50`; one word `0x87654321`, seed 0
  → `0xF55B516B`; one word `0x87654321`, seed `0x5082EDEE` → `0x2362F9DE`; one word 0, seed 0 → `0x2362F9DE`. `hash.ts` exports the hash over
  words so the test can reach it; `index.ts` exports only `fogFactor`.
- **Evenness check** (prototype, 80 keys × 1000 nights): χ² = 59.7 on 70 degrees of freedom; every one of the 71 values between 1059 and 1192
  occurrences (expected 1127). The test keeps a looser version of this (each count within 20 % of the mean).

**Reference implementation in the tests** (`tests/engine/fog-reference.ts`) re-implements the same algorithm from this section with
`BigInt` and explicit `& 0xFFFFFFFFn` masks, with a naive loop (a hash call for every ticket and night, a plain sum). It shares no code with
`hash.ts`; the two must agree on every generated board.

## 3. Types and functions (Requirements 3 and 4)

```ts
export const FOG_NIGHTS = 1000;
export const FOG_MIN_PCT = 80;
export const FOG_MAX_PCT = 150;

export interface FogResult { readonly nights: number; readonly holds: number; readonly pct: number }

export function fogFactor(seed: number, key: Key, night: number): number;            // 80..150

export interface FogTable { /* opaque: seed, nights, keys in order, simulated efforts */ }
export function fogTable(board: ValidBoard): FogTable;                                // all tickets, keys sorted
export function fogFromTable(t: FogTable, kept: readonly Key[], capacity: number): Result<FogResult>;
export function simulateFog(board: ValidBoard, kept: readonly Key[], capacity: number): Result<FogResult>;

export interface FogPointOk { status: 'ok'; marginPct; capacity; effectiveCapacity; keptCount; keptEffort; fog: FogResult }
export interface FogPointImpossible { status: 'impossible'; marginPct; capacity; effectiveCapacity; needed; fog: null }
export type FogPoint = FogPointOk | FogPointImpossible;
export function fogCurve(board: ValidBoard, when: { now: number; freezeAt: number }, table?: FogTable): Result<readonly FogPoint[]>;
```

**The table.** For ticket *i* (keys sorted by `compareKeys`) and night *n*, `data[i × 1000 + n] = floor((effort_i × f + 99) / 100)` with
`f = fogFactor(seed, key_i, n)`, in one `Float64Array` (80 tickets × 1000 × 8 bytes = 640 kB; `Float64Array` so no overflow question arises).
Ticket-major layout so the next step reads contiguous memory.

**Reading it.** `fogFromTable` maps the kept keys to row numbers (a `Set` first, so a repeated key counts once; an unknown key stops with
`unknown-key`), then adds each kept row into one `Float64Array(1000)` of per-night sums (allocated once per call, never per night) and counts the
nights whose sum is ≤ `capacity`. `pct = floor(100 × holds / 1000)`. The kept order cannot matter because addition of integers is exact.

**`simulateFog`** builds the table of the kept tickets only and reads it, so it is the specification of the answer, in the simplest code; the
curve and the screen use the shared table. A test checks the two agree on every generated board and kept set.

**`fogCurve`** loops over the seven reserves, calls `solveFreeze(board, { now, freezeAt, marginPct })`, and for `status: 'ok'` reads the shared
table with `solution.kept` and `solution.capacity` (the **full** capacity). An impossible freeze gives `FogPointImpossible` with the solver's
`needed`. A failing `solveFreeze` returns its error. No cache lives in the engine: the engine stays stateless; the UI caches.

**Safety of the integers.** `validateBoard` already refuses boards whose total effort would overflow the solver's weights
(`board-too-large`); that bound keeps `effort × 150 + 99` and every night's sum far below 2^53. A test builds a board near the largest accepted
effort and checks the fog stays exact against the BigInt reference.

**Empty kept set:** every night's sum is 0, so every night holds: 100 %, whatever the capacity (3.4).

## 4. Where the seed lives, and what it touches (Requirement 1)

`Board.fogSeed: number` (required). Reasons:
- it is part of "the same board gives the same answer": two boards equal except for the seed are different boards;
- a required field cannot be forgotten by a caller that builds a board (the compiler lists every place);
- it travels with the board through the reducer's copies (`{ ...board, wontDo }`) with no code.

Rejected: an optional field with a silent default (a number would depend on a hidden constant), and a parameter of `simulateFog` only (a
quoted number could not be reproduced from the board alone). `DEFAULT_FOG_SEED` exists only for later callers that import data without a seed.

**Validation:** `fogSeed` not a safe integer → `not-integer`; outside 0 … 4 294 967 295 → `seed-out-of-range` (a new member of
`ValidationErrorCode`), `subject: 'board'`, `field: 'fogSeed'`. The error list stays sorted, so the order of tickets still cannot matter.

**What must change on purpose (13.1):**

| Place | Change |
|---|---|
| `src/engine/types.ts`, `validate.ts`, `index.ts` | field, code, constant, exports |
| `src/ui/sample-board.ts` | `fogSeed: 20261116` (the date of `now`; chosen before any number was seen) |
| `src/ui/text.ts` `describeValidationError` (exhaustive) | a sentence for `seed-out-of-range` |
| `tests/engine/generators.ts`, `fixtures.ts`, and the files that write a `Board` literal (`generators.test.ts`, `purity.test.ts`, `solver.test.ts`, `validate.test.ts`, `zombie.test.ts`) | add `fogSeed`; the generator draws a seed from the full 32-bit range |
| `tests/engine/validate.test.ts` | an example for `not-integer`, `seed-out-of-range` (−1, 2^32, 1.5), order independence |
| `tests/engine/purity.test.ts` | the exports list (new names, on purpose); the file list gains `fog.ts` and `hash.ts` |
| `tests/engine/traceability.test.ts` | `TABLE` gains 19, 20, 21 → `fog.test.ts`; the "out of scope" comment drops P19–P21 |
| `tests/ui/invalid-board.test.ts` | the "one broken board per code" list gains the new code |
| `tests/ui/sample-board.test.ts` | the board has the seed; the real curve is pinned (Requirement 12.5) |
| `tests/ui/reducer.test.ts` | after every action the board keeps its `fogSeed` |
| `tests/ui/render-sign.test.ts`, `slots.test.ts` | the fog slot becomes the fog block; the slots list loses `fog` |
| `tests/ui/a11y.test.ts`, `text.test.ts` (provenance) | the new region, the list, the sentences |

## 5. Tests in the engine (Requirements 5 and 6)

`tests/engine/fog.test.ts` (examples and properties), `tests/engine/fog-reference.ts` (the BigInt reference).

- **Known answers.** The vectors of section 2, against `hash.ts` and against the reference.
- **Draw range and evenness.** `fogFactor` is within 80..150 for any seed, key and night (a property, including keys with accents, emoji, lone
  surrogates and the empty key); over 80 000 draws each of the 71 values is within 20 % of the expected count; two keys differ somewhere over 1000 nights.
- **Independence of the others (common random numbers).** For a generated board, the draws of a ticket are the same with or without any other
  ticket, and in any order (this is what P20 stands on).
- **P19 deterministic.** One `test('P19 …')`: the same board, seed and kept set give equal results across calls, with the tickets shuffled and
  with `kept` shuffled and duplicated; a second assertion finds at least one board where changing the seed changes `holds`.
- **P20 fewer inside holds at least as often.** One `test('P20 …')`: for a generated board, `S` a generated subset of keys and `S'` a random subset
  of `S`, and any capacity, `holds(S') ≥ holds(S)`. Because the same table feeds both and `floor((e·f+99)/100) ≥ 0`, the sums satisfy
  `sum(S') ≤ sum(S)` night by night.
- **P21 extremes.** One `test('P21 …')`: with `Σ ceil(3e/2) ≤ capacity`, `holds` is 1000; with `Σ ceil(4e/5) > capacity`, `holds` is 0. The generator
  builds capacities on both sides of the sums (just under, equal, just over), so the boundaries are exercised, not only far-away cases.
- **Reference agreement.** For boards of 0 to 80 tickets and random kept sets and capacities, `simulateFog`, `fogFromTable` and every
  `fogCurve` point equal the reference exactly (`holds` and `pct`).
- **Curve against the oracle.** For boards of 0 to 12 tickets, the curve's kept set at each reserve equals the oracle's (the existing
  `oracleSolve`), and the point's `holds` equals the reference's for that set.
- **Impossible points.** A board with a must-have bigger than the capacity gives `impossible` points with `fog: null` and the solver's `needed`.
- **Order independence.** The whole curve is equal when the tickets are shuffled.
- **No promise (Requirement 6).** Test `more reserve can lower the chance`: a `fc.check` over small boards (3 to 8 tickets) with a **fixed seed** and a
  fixed number of runs looks for a board and two reserves `m1 < m2` with `holds(m2) < holds(m1)`; it asserts one is found (`expect(found).not.toBeNull()`),
  and prints its shape in the failure message. A second test pins a minimal counter-example, written out by hand after the search found it.
  *Risk:* if the search finds nothing in its budget I report it and do not weaken the claim. A throw-away prototype (random boards of 3 to 8 tickets, brute-force
  optimum, no dependencies) found its first three decreases (for example 7, 6, 6, 45, 45, 100, 100 %) before it had looked at 4 000 boards, so the claim is
  expected to hold; the prototype is not kept.
- **Performance.** `performance.test.ts` (existing style, a generous ceiling): the first curve of an 80-ticket board and a cached one. The
  numbers are logged for the report.

## 6. The screen (Requirements 7 to 11)

### 6.1 View and cache

```ts
interface FogView {
  readonly points: readonly FogPoint[];         // seven, from fogCurve
  readonly currentIndex: number | null;         // the index whose marginPct equals the state's reserve (derived, not decided by the renderer)
}
View.fog: FogView | null                        // null only if the engine returned an error (cannot happen for a valid state)
```

`derive` asks `fog-cache.ts`:

- `tableFor(board)`: a `WeakMap<ValidBoard, FogTable>`; the first call hashes (about 3 ms for 80 tickets), later calls are free.
- `curveFor(state)`: a `WeakMap<ValidBoard, Map<string, readonly FogPoint[]>>` keyed by `candle|away` (no reserve in the key), capped like
  `solve.ts` (64 entries per board, cleared when full). Moving the reserve slider hits the cache every time.
- A new board object (exhume, resurrect, put down, reset) misses both caches, so a cache can never answer for another board (10.4).

The renderer only reads `view.fog`. The only comparison on engine data is `currentIndex`, which is selecting an item by the state's own reserve,
not a decision about the chance.

### 6.2 Words (`text.ts`, facts only)

- `fogHeadline(point)` → `{ lead: 'Holds in', figure: '20 %', tail: 'of 1,000 nights' }`. `figure` is `${pct} %`; `1,000` is `FOG_NIGHTS`
  formatted by a small integer formatter (`thousands`), not typed.
- `fogSentence(point)` → "Inside needs 49 points on paper; the team has 59; estimates land between 80 % and 150 %. It held on 6 of 1,000 nights." (`keptEffort`, `capacity`, the two constants, `holds`, `FOG_NIGHTS`). The floored percentage can be 0 while `holds` is above 0, so the count is always there.
- `fogImpossibleSentence(point)` → "No cut to test: the must-haves need 15 points; the team has 12." (`needed`, `capacity`).
- `stripItemText(point, isCurrent)` → "15 % reserve: holds in 20 % of 1,000 nights (203 nights)", with " (current)" appended for the current one, and
  "15 % reserve: impossible freeze" for an impossible point.
- The number-provenance helpers of `text.test.ts` learn to read `1,000` as one integer and to count `FOG_*` constants as facts.

Nothing in these functions compares two points, ranks them or adds a word like "safer".

### 6.3 DOM (`render/fog.ts`)

```
.sign-board
  .sign-readout            (unchanged)
  .reserve                 (unchanged: label, range, output, hint)
  ol.fog-strip[aria-label="Chance the shelter holds, at each reserve"][role=list]       ← new, under the slider
    li.strip-item[data-reserve="15"][aria-current="true"?]
      span.strip-reserve   "15 %"
      span.strip-bar[aria-hidden]       height = chance (transform: scaleY)
      span.strip-chance    "20 %"
      span.strip-now       "now"        (only on the current item; visible text)
      span.visually-hidden the full sentence of stripItemText   (what a screen reader reads; the visible spans are aria-hidden)
  section.fog[data-region="fog"][aria-labelledby=…]                                        ← replaces p[data-slot=fog]
    p.fog-headline#…       "Holds in " + span.fog-figure "20 %" + " of 1,000 nights"      (real text, painted face)
    p.fog-sentence         the sentence of 6.2
```

- The strip's `li`s are fixed in number (7), so the nodes are created once and patched with `setText`/`setAttr`; text only through `textContent`.
- The strip is not interactive (no button, no tab stop). It lines up under the slider's seven positions with the same padding trick the
  candle's notches use (`padding: 0 calc(var(--thumb) / 2)`, a seven-column grid).
- Impossible freeze: the headline line becomes "No cut to test" (the figure is absent), the sentence is the impossible one; every strip item
  that is impossible shows "—" and the hidden sentence says "impossible freeze".
- The existing `.slot-text` dashed style stays for the other, still empty, slots; the fog uses its own classes.

### 6.4 Look (palette tokens only)

- `.fog` sits on a night panel like the verdict figures: headline `--font-sign`, the figure in amber (one colour, never by threshold), the
  sentence in `--font-body`, stone or bone on night (pairs already in `contrast.test.ts`).
- Strip: seven columns on a night panel; the bar is a thin amber column drawn with `transform: scaleY(var(--chance))` from the bottom (`--chance`
  is set from the engine's `pct` with `style.setProperty`, allowed by the CSP); the current item has an amber frame and the word "now".
- No `transition` except `transform`; under `prefers-reduced-motion: reduce` the existing blanket rule already removes it; the numbers carry the meaning.
- No pixel font sizes under 16 px; no new hex.

### 6.5 Stable height

The old fog slot was one line at the bottom of the sign. The new block and strip are taller and the strip's items may wrap, so the sign must
not change height with the candle or the reserve (10.7, the same bug the sign had before):

- the strip's height is fixed by its content (always seven items of the same shape, text length bounded: "15 % / 20 % / now");
- the fog block takes a `min-height` equal to its tallest content (headline + two lines of sentence, or the impossible sentence), by width,
  the way `.sign-readout` does; the numbers are measured in a real browser at 1280, 820, 480, 360 and 320 px over all candle steps and reserves, and
  written in the CSS with a comment.
- the check is the one used for the sign: the candle region's top must have one value at each width.

### 6.6 Speed on the screen (Requirement 10)

Per candle step the new work is 7 solves (the same solver, already measured at a few ms for 80 tickets in the worst case) plus 7 passes over a
cached table (at most 7 × 80 × 1000 additions). The estimate for the sample board is about 1 ms and for 80 tickets about 3 ms after the first call
(prototype: table of 80 × 1000 draws 3 ms including a cold start; the sums of 7 sets of 40 tickets 6 ms cold, expected well under 2 ms warm).
**Plan A** (default): compute in `derive`, synchronously, cached.
**Plan B** (only if the measured cached 80-ticket curve is above 8 ms): `derive` does not compute the curve while a gesture is active; the sign
keeps the last settled curve with `data-stale="true"` and the visible text "updating", and a call on settle (the existing 300 ms settle in `gestures.ts`,
through the injected timers so tests stay deterministic) fills it in. Plan B needs a way for the sign to know a gesture is active (one flag in the
context, set by the two gestures); I will build it only if the numbers ask for it, and say so in the report.

## 7. Demo message (Requirement 12)

After the engine and the screen work:
1. A throw-away script (not committed) or a test run prints, for the sample board at Friday 18:00, each reserve step: kept count, kept effort,
   `holds`, `pct`.
2. The curve is pinned in `tests/ui/sample-board.test.ts` as an example test.
3. Seed sensitivity, for the report only: the same curve with 20 other seeds (`1 … 20`), the minimum and maximum `pct` per step.
4. `.kiro/steering/product.md` "Demo message" is rewritten with the real numbers and only claims they support (if the real curve is not
   monotone or not as dramatic as the prototype's, the text says what it is). `docs/rule.md` gets a Spanish section dated that day with the
   hash, the seed, the night numbering, the curve and the real numbers, and a line that the prototype's numbers came from its fake board.
5. The board and the seed are not changed to improve the result.

## 8. Decisions that I would like you to confirm

1. **`fogSeed` is a required board field** (not optional, not a parameter), validated, with a new error code `seed-out-of-range`.
2. **The sample board's seed is `20261116`**, fixed before seeing any result.
3. **MurmurHash3 x86-32 over words, factor `80 + h % 71`, nights numbered 0 to 999.** The draw is uniform on 80 … 150, so its mean is 115 %: a
   cut that exactly fills the capacity holds almost never. That is how the rule is written (docs/rule.md); the strip is what makes it visible.
4. **"Holds" compares to the full capacity**, not the capacity after the reserve (as the rule says); the sentence says "the team has N", the full capacity.
5. **The strip is not interactive** (the slider remains the one control).
6. **The announcer is unchanged** in this spec (the fog region is read on demand). The alternative is to append "Holds in N % of 1,000 nights." to
   the spoken sentence after each settled change; it costs a few pinned announcement strings in tests. I recommend adding it in a later change
   if you want the fog spoken; say so and I add it here.
7. **Plan A (synchronous) with a measurement gate for Plan B.**
8. **No colour by threshold** for the figure and no wording that ranks reserves; a test scans the texts.
9. **`DEFAULT_FOG_SEED = 0`** is exported for later importers; the engine itself never applies it.

## 9. What was decided while building

- **Plan A was kept.** Measured on the development machine, 80 generated tickets: table 1.4 to 1.6 ms, a curve with the table kept 4.9 to 5.7 ms (the seven solves are most of it), first curve 6.4 to 6.9 ms; on tie-heavy boards, which are the solver's worst case, a cached curve takes 13.4 ms, above the 8 ms gate. The sample board is the only board in this version and its curve is well under 2 ms. In a real browser, dragging the candle back and forth for 240 frames gave a steady 16.7 ms per frame at normal speed; with the CPU slowed 4 times 6 frames in 235 were slow (2 without the fog), and at 6 times about 45 in 235 with or without the fog. Plan B (compute on settle) is the safeguard to build when CSV import brings 80-ticket boards with many ties.
- **The block is `fog-block`, not `fog`**: `.fog` is already the class of the atmosphere canvas, and the first version of the style rule restyled it.
- **The strip's current item is always marked**, also when the freeze is impossible (the slider always has a value); the word "now" keeps its room in every item so the strip does not change height.
- **Heights** (block `min-height`, measured over 11 candle steps × 7 reserves at 14 widths from 320 to 1280 px): 6.5 rem from 1100 px, 7.75 rem to 820 px, 8.25 rem to 480 px, 12.5 rem below. The candle region's top is one value at each of the 14 widths.
- **The percentage is floored** and can read 0 % with nights that hold (the sample board at 5 %: 6 nights): the sentence and the strip's spoken text always give the count.
