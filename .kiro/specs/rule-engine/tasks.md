# Implementation plan: rule-engine

Run `npm run typecheck` and `npm test` before ticking any task; tick it only when both exit 0. Property tests are one `test(...)` per property, named with its number.

- [x] 1. Scaffold the toolchain
  - Vite 8.3.8, TypeScript 7.0.2 (strict), Vitest 5.1.0, fast-check 4.10.2, all pinned; `tsconfig.json` and `tsconfig.engine.json`; scripts
    `dev`, `build`, `typecheck`, `test`.
  - Minimal `src/engine/index.ts` and `tests/engine/smoke.test.ts` so `typecheck` and `npm test` are genuinely green; hook
    `.kiro/hooks/test-on-engine-save.json` runs `npm test` on saves under `src/engine` and `tests/engine`.
  - _Requirements: 13.1, 13.2, 12.3_

- [x] 2. Types, keys and constants
  - [x] 2.1 `src/engine/types.ts` with the model, `Result`, `EngineError` codes, `ValidBoard` brand
  - [x] 2.2 `src/engine/keys.ts` with `compareKeys` (code-unit order) and example test `CRYPT-12 < CRYPT-2`
  - _Requirements: 1.1–1.6_

- [x] 3. Dependency graph and board validation
  - [x] 3.1 `src/engine/chain.ts`: closure, dependents, cycle detection (iterative), `blockedBy` for put-down keys
  - [x] 3.2 `src/engine/validate.ts`: all error codes, sorted output, `board-too-large` check, `wontDo` handling; `src/engine/weights.ts`
    holds the integer weight scale shared with the solver
  - [x] 3.3 `tests/engine/validate.test.ts`: one example per error code, cycle rotation, order independence
  - _Requirements: 2.1–2.5_

- [x] 4. Generators
  - [x] 4.1 `tests/engine/generators.ts`: `arbBoard`, `arbCapacity`, `arbPeople`, `arbAbsences`, `arbCapacityCase` (zone, window, people and four sorted
    instants, replacing `arbInstant`), `arbMargin`, `arbBoardForImpossible`, `arbPermutedBoard`
  - [x] 4.2 Self-test (`generators.test.ts`): every generated board passes `validateBoard`; permutation helper keeps the same board content
  - _Requirements: 13.4_

- [x] 5. Half-day capacity
  - [x] 5.1 `src/engine/capacity.ts`: `capacityBetween`, `effectiveCapacity` (returns a `Result`), formatter and midpoint caches, `range-too-long`
  - [x] 5.2 Example tests: known week, 12:00 edge on both ends, weekend, European DST changes (spring and autumn), Kolkata, New York, `full` and half absences
  - [x] 5.3 `P14 slots` property test
  - [x] 5.4 `P11 capacity never grows` property test (four variants)
  - _Requirements: 3.1–3.9, 6.2_

- [x] 6. Cost of delay and hunger
  - [x] 6.1 `src/engine/cod.ts`: scale, `effectiveUrgency`, `costOfDelay`, `codParts`, `burialCost`
  - [x] 6.2 `P23 hunger` property test and the "urgency 1 → 5 after 3 releases" example
  - [x] 6.3 Example test for imported `cod` (no hunger)
  - _Requirements: 4.1–4.4, 4.5, 4.7_

- [x] 7. Brute-force oracle
  - [x] 7.1 `src/engine/oracle.ts`: enumerate subsets (throws above 16 tickets), own feasibility and ranking code, not exported
  - [x] 7.2 Example tests on hand-made boards, including a tie that only the alphabetical rule resolves and the "C beats A + B" jump from `docs/rule.md`
  - _Requirements: 11.1–11.4_

- [x] 8. Solver
  - [x] 8.1 `src/engine/solver.ts`: preparation, integer weights, branch and bound, reasons, zombies, `solveWithCapacity`, `solveFreeze`
  - [x] 8.2 `P1 fits` and `P22 margin`
  - [x] 8.3 `P2 must-haves`, `P3 dependencies`, `P4 partition`
  - [x] 8.4 `P5 optimal vs oracle` (1,000 runs, savedCod and kept set), plus a tie-heavy variant (tiny efforts and cods) so the tie-breaks decide
  - [x] 8.5 `P6 more capacity`, `P7 determinism` (1,000 runs)
  - [x] 8.6 `P8 nothing left over`, `P27 cascade`
  - [x] 8.7 `P16 formula` property test (in `cod.test.ts`)
  - [x] 8.8 Reason examples (one per kind) and the invariant that a `no-room` ticket has `needed > left`
  - _Requirements: 4.6, 5.1–5.15, 6.1, 6.3, 6.4_

- [ ] 9. Impossible freeze
  - [ ] 9.1 Impossible branch in the solver with `needed`, capacities and blocked must-haves
  - [ ] 9.2 `P9 impossible iff` property test with an independent computation of the needed effort
  - [ ] 9.3 Example: must-haves need 54, capacity 41
  - _Requirements: 7.1–7.3_

- [ ] 10. Diff, exhume, zombies and put down
  - [ ] 10.1 `src/engine/diff.ts`: `diffSolutions`
  - [ ] 10.2 `P15 diff` property test
  - [ ] 10.3 `exhume` and `resurrect`; `P10 exhume` property test; examples: already kept, unknown key, impossible rejected and board unchanged
  - [ ] 10.4 Zombie listing; `P17 zombie` property test
  - [ ] 10.5 `putDown` with `wontDo` blocking; `P18 put down` property test (threshold 1); examples: not a zombie, dependents blocked
  - _Requirements: 8.1–8.5, 9.1–9.6, 10.1–10.4_

- [ ] 11. Public API, purity and performance
  - [ ] 11.1 `src/engine/index.ts` exporting the public API (not the oracle)
  - [ ] 11.2 `tests/engine/purity.test.ts`: forbidden-token scan and no imports outside `src/engine`
  - [ ] 11.3 No-mutation test: deep-freeze inputs, call every public function twice, outputs deeply equal
  - [ ] 11.4 `tests/engine/performance.test.ts`: 20 boards of 80 tickets, each under 2 s; print the median for the record
  - _Requirements: 12.1–12.5, 14.1, 14.2_

- [ ] 12. Checkpoint
  - [ ] 12.1 `npm run typecheck`, `npm test`, `npm run build` all green
  - [ ] 12.2 Check the traceability table: every in-scope property has a test named with its number, none is skipped
  - [ ] 12.3 Update `docs/rule.md` with a dated section for the decisions taken in this spec (put down and `wontDo`, P9 with put downs, epoch milliseconds)
