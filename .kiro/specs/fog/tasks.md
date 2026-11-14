# Implementation plan: fog

Run `npm run typecheck` and `npm test` before ticking any task; tick it only when both exit 0. Property tests are one `test(...)` per property, named
with its number. Run a mutation check (one at a time, never in parallel on the same file) for the properties and the reference. Do not commit or push.

- [x] 1. The seed on the board (Requirement 1)
  - [x] 1.1 `types.ts`: `Board.fogSeed`; `ValidationErrorCode` gains `seed-out-of-range`; `DEFAULT_FOG_SEED = 0`; `index.ts` exports it
  - [x] 1.2 `validate.ts`: `not-integer` and `seed-out-of-range` for `fogSeed`, sorted with the other errors
  - [x] 1.3 Update, on purpose, every place that writes a `Board`: `tests/engine/generators.ts` (full 32-bit seeds), `fixtures.ts` and the test files listed in
    design section 4, `src/ui/sample-board.ts` (`fogSeed: 20261116`)
  - [x] 1.4 `validate.test.ts`: examples for 1.5, −1, 2^32 and 4 294 967 295 (valid); order independence still holds
  - [x] 1.5 UI: a sentence for `seed-out-of-range` in `describeValidationError`; one more broken board in `invalid-board.test.ts`; `reducer.test.ts` checks the
    seed survives every action
  - [x] 1.6 `typecheck` and the whole suite green before moving on (nothing else changed yet)
  - _Requirements: 1.1–1.6_
- [x] 2. The hash and the draw (Requirement 2)
  - [x] 2.1 `src/engine/hash.ts`: MurmurHash3 x86 32-bit over words (design section 2), no shared state
  - [x] 2.2 `src/engine/fog.ts`: constants and `fogFactor`
  - [x] 2.3 `tests/engine/fog-reference.ts`: the independent BigInt implementation (hash, factor, naive simulation)
  - [x] 2.4 `fog.test.ts`: the published vectors, range for odd keys, evenness over 80 000 draws, reference agreement on `fogFactor`, a draw does not depend on other
    tickets or their order
  - _Requirements: 2.1–2.6_
- [x] 3. The simulation (Requirement 3)
  - [x] 3.1 `fogTable`, `fogFromTable`, `simulateFog` with the error cases (unknown key, bad capacity); no allocation per night
  - [x] 3.2 Examples: empty kept set holds 1000; capacity 0 with efforts 0; a one-ticket board by hand; duplicate and reordered `kept`
  - [x] 3.3 `simulateFog` equals `fogFromTable` on generated boards; both equal the reference
  - [x] 3.4 A board near the largest accepted effort stays exact against the reference
  - _Requirements: 3.1–3.7_
- [x] 4. The curve (Requirement 4)
  - [x] 4.1 `fogCurve` with the shared table, the impossible points and error pass-through
  - [x] 4.2 Tests: each point equals `simulateFog` of the solver's kept set; up to 12 tickets the kept sets equal the oracle's and `holds` equals the
    reference's; impossible points; order independence of the whole curve
  - _Requirements: 4.1–4.5_
- [x] 5. P19, P20, P21 and honesty about the reserve (Requirements 5 and 6)
  - [x] 5.1 `test('P19 …')`, `test('P20 …')`, `test('P21 …')` in `fog.test.ts`, with generators for kept subsets and capacities at the boundaries of the sums
  - [x] 5.2 `traceability.test.ts`: `TABLE` gains 19, 20, 21; update its comment; `purity.test.ts`: new exports and the two new files
  - [x] 5.3 The search test "more reserve can lower the chance" (fixed fast-check seed, fixed runs), then the hand-written minimal example it found
  - [x] 5.4 Mutation checks, one at a time: use `% 70` in the factor (P21 or the reference must fail); drop the length term in the hash (known answers fail); let the draw
    depend on the kept set (P20 must fail); add 98 instead of 99 in the ceiling (reference must fail)
  - _Requirements: 5.1–5.7, 6.1–6.3_
- [x] 6. Speed in the engine
  - [x] 6.1 `performance.test.ts`: the first curve and a cached curve on an 80-ticket board, generous ceiling; log the numbers
  - [x] 6.2 Keep the numbers for the report; decide Plan A or Plan B (design 6.6) from them
  - _Requirements: 10.5, 10.6_
- [x] 7. The real numbers of the sample board (Requirement 12.1–12.2, 12.5)
  - [x] 7.1 Compute the curve of the sample board at Friday 18:00 (kept count, kept effort, `holds`, `pct` for 0, 5, … 30 %) and print it
  - [x] 7.2 Pin it in `tests/ui/sample-board.test.ts` as an example test. Do not change the board or the seed to improve it
  - [x] 7.3 The seed sensitivity table for the report (minimum and maximum `pct` per step over seeds 1 … 20); not committed
  - _Requirements: 12.1–12.3, 12.5_
- [x] 8. The view, the cache and the words (Requirements 7, 9 and 10)
  - [x] 8.1 `src/ui/fog-cache.ts`: table per board, curve per (board, candle, people away); `derive` fills `View.fog` with `currentIndex`
  - [x] 8.2 `text.ts`: `thousands`, `fogHeadline`, `fogSentence`, `fogImpossibleSentence`, `stripItemText`
  - [x] 8.3 Tests: `fog-cache.test.ts` (the reserve never recomputes; a new board misses; the curve of another board is never returned), `derive.test.ts`
    (`View.fog`), `text.test.ts` (examples, provenance extended to the fog sentences, the forbidden-words scan over every candle step and reserve of the sample board)
  - _Requirements: 7.1–7.7, 9.1–9.2, 10.1–10.4_
- [x] 9. The sign and the strip (Requirements 7, 8, 10.7 and 11)
  - [x] 9.1 `src/ui/render/fog.ts`; `sign.ts` places the strip under the reserve slider and the block where the slot was
  - [x] 9.2 CSS: block, strip, bars (`transform` only), reserved height (measured), palette tokens only
  - [x] 9.3 Tests: `render-fog.test.ts` (structure, text, current item, impossible, empty kept set, no tab stop, no live region, `textContent` only with a hostile
    title), `slots.test.ts` and `render-sign.test.ts` (the slot is gone, the block is in the sign), `a11y.test.ts` (names, one `aria-current`), tokens and contrast
  - [x] 9.4 Real browser (headless Chrome, as before): the candle region's top is one value at 1280, 820, 480, 360 and 320 px over all eleven candle steps and
    seven reserves; no horizontal scroll at 360, 345 and 320 px; screenshots of the sign in the solved, impossible and 0 % states
  - [x] 9.5 Drag the candle in the real browser with a trace of frame times; confirm Plan A is smooth or switch to Plan B (design 6.6)
  - _Requirements: 7.1–7.7, 8.1–8.6, 10.7, 11.1–11.4_
- [x] 10. Words outside the code (Requirement 12.4 and 9.3)
  - [x] 10.1 `.kiro/steering/product.md`: rewrite "Demo message" with the real numbers and only what they support
  - [x] 10.2 `docs/rule.md`: a dated Spanish section: hash, seed, night numbering, the curve, the real numbers, the prototype note
  - [x] 10.3 `README.md`: one sentence that a bigger reserve can lower the chance; the strip is how to see it
  - [x] 10.4 Addendum to `.kiro/specs/board-ui/design.md` and `requirements.md`: the fog slot is filled by the `fog` spec
  - _Requirements: 9.3, 12.4_
- [x] 11. Checkpoint
  - [x] 11.1 `npm run typecheck`, `npm test`, `npm run build` all green; gzipped JS plus CSS under 60 kB (report the number)
  - [x] 11.2 Report: the real curve and the seed sensitivity, Plan A or B and the measured times, the sign height check, what was verified and what was not
  - [x] 11.3 Stop. Do not commit or push
