# Implementation plan: board-ui

Run `npm run typecheck` and `npm test` before ticking any task; tick it only when both exit 0 (and `npm run build` for tasks that touch the
build). The engine tests, the traceability test and the engine-save hook must keep passing. Tests in this plan are written with the code they
check, not after it. Run mutation checks one at a time (never in parallel on the same file).

- [x] 1. Engine addition: totals (Requirement 19)
  - [x] 1.1 `types.ts`: add `buriedEffort`, `buriedCod` to `SolvedSolution`; `raisedCod`, `sunkCod` to `Diff`
  - [x] 1.2 `solver.ts` and `diff.ts` fill them from the lists they already build
  - [x] 1.3 `tests/engine/totals.test.ts`: `keptEffort + buriedEffort` = total effort and `savedCod + buriedCod` = total cod over generated boards (names do not start with `P<number>`); `raisedCod`/`sunkCod` equal the sums of their entries
  - [x] 1.4 Extend the P15 test with `raisedCod − sunkCod = codDelta`; update the existing `toEqual` expectations on whole `Diff` objects (`diff.test.ts`, `exhume.test.ts`, `zombie.test.ts`) for the two new fields; run the whole engine suite and the traceability test
  - [x] 1.5 Append a dated section to `docs/rule.md` (in Spanish, like the rest) and a note in the `rule-engine` design
  - _Requirements: 19.1–19.5_

- [x] 2. Test tooling for the UI
  - [x] 2.1 Add `jsdom` as an exact-version dev dependency (check `npm view jsdom version` and its Node engines; CI will use Node 24) and raise `engines.node` in `package.json` to what jsdom needs (jsdom 31 needs `^22.22.2 || ^24.15.0`)
  - [x] 2.2 Keep `environment: 'node'` globally; DOM test files opt in with `// @vitest-environment jsdom`; `tests/ui` is already included by the glob
  - [x] 2.3 A smoke test in `tests/ui` that renders one element in jsdom; `tsconfig.json` (with DOM) already covers `src/ui` and `tests/ui`
  - _Requirements: 17.1_

- [x] 3. Sample board and candle steps
  - [x] 3.1 `src/ui/sample-board.ts`: `SAMPLE_NOW`, the 19 tickets, 4 survivors, product line ("Hollow Bank app 3.2 · release eve"), a `sampleBoard(): Board`
  - [x] 3.2 `src/ui/candle-steps.ts`: the eleven labels and instants
  - [x] 3.3 `tests/ui/sample-board.test.ts` pinning the facts of design section 3 through the engine (capacity 59, 59 of 59, lists, impossible at steps 0–2, rejected HB-119, put-down HB-112, hunger, imported ticket, must-haves, chain of three, all validation passes)
  - [x] 3.4 `tests/ui/candle-steps.test.ts`: labels equal the `Intl` Madrid local time; instants increase; capacity does not decrease
  - _Requirements: 1.1–1.5, 2.2_

- [x] 4. State, store and derive
  - [x] 4.1 `src/ui/state.ts`: types, `initialState`, `boardFor`, `freezeFor`, `reducer`, `compareStates`
  - [x] 4.2 `src/ui/store.ts`: `createStore`
  - [x] 4.3 `src/ui/derive.ts`: `View`, memoized `derive`, chain pairs, must-have list, notches
  - [x] 4.4 `tests/ui/reducer.test.ts`: every action, ignored inputs return the same reference, rejected exhume keeps the same `board`, put down only for zombies, reset, purity and no mutation with a deep-frozen state, `sound/set` keeps `change`
  - [x] 4.5 `tests/ui/derive.test.ts`: capacity numbers equal the solution's, partition, chains only between buried tickets, cache gives equal results
  - _Requirements: 1.2, 1.3, 1.6, 2.3, 2.4, 2.7, 3.2–3.5, 4.2, 7.5, 8.2–8.3, 9.3, 9.5, 14.2, 14.3, 14.6_

- [x] 5. Words
  - [x] 5.1 `src/ui/text.ts`: every sentence of design section 6, plural helper, `epitaphFor`, `describeValidationError` (exhaustive)
  - [x] 5.2 `tests/ui/text.test.ts`: examples for each sentence; the number-provenance property (every integer in a generated sentence is one of its facts)
  - [x] 5.3 `src/ui/sound-events.ts` and `tests/ui/sound-events.test.ts`
  - _Requirements: 5.4–5.6, 7.1–7.4, 7.7, 8.3, 9.3, 10.1, 10.3, 10.4, 11.3_

- [x] 6. DOM base, shell and source scans
  - [x] 6.1 `src/ui/dom.ts` (`el`, `svg`, `setText`, keyed patch, focus helpers) with no `innerHTML`
  - [x] 6.2 `tests/ui/imports.test.ts`: engine imports only through `engine/index`; banned APIs; clock and randomness; `performance` only in `atmosphere/`; no network APIs
  - [x] 6.3 `index.html` (root and entry script only: no fonts link, no other origin, no inline script or style), `src/main.ts` (imports `styles/fonts.css` and the other styles), `src/ui/styles/fonts.css`, `src/ui/app.ts` skeleton with landmarks, skip link, announcer and the decoration container
  - [x] 6.4 `src/ui/render/invalid-board.ts` and `tests/ui/invalid-board.test.ts` (one broken board per validation code)
  - [x] 6.5 `tests/ui/xss.test.ts`: markup in a key, a person name and a value renders as text on everything drawn so far (the invalid-board screen and the helpers); the survivor and ticket-title cases are added in 9.2 and 10.3, when those are drawn
  - [x] 6.6 `build/csp.ts` (the policy constant), `public/licenses/` (the four font licence texts) and `tests/ui/csp.test.ts`: exact policy, no host, no external URL in `index.html`, CSS or sources, licences present
  - _Requirements: 10.3, 12.3, 13.2, 14.1, 14.4, 15.1, 15.2, 15.3, 15.4_

- [x] 7. The sign: verdict, change note and reserve
  - [x] 7.1 `src/ui/render/sign.ts`: verdict, change note, alert for a rejected exhume, reserve range and output, fog slot
  - [x] 7.2 `src/ui/announcer.ts` and `src/ui/gestures.ts` (frame coalescing, settle timer, injected timers)
  - [x] 7.3 `tests/ui/render-sign.test.ts`
  - _Requirements: 4.1–4.3, 7.1–7.7, 8.3, 10.1, 12.4_

- [x] 8. The candle
  - [x] 8.1 `src/ui/render/candle.ts`: drawing (wax height from the step), range input, `aria-valuetext`, notches with capacities
  - [x] 8.2 `tests/ui/candle.test.ts`: one dispatch per frame, one announcement per settle with the start-to-end diff, notches, `aria-valuetext`
  - _Requirements: 2.1–2.7, 12.4, 18.1_

- [x] 9. Survivors
  - [x] 9.1 `src/ui/render/survivors.ts`: switches with `role="switch"`, `aria-checked`, "Here"/"Away"
  - [x] 9.2 `tests/ui/survivors.test.ts`, and a survivor named with markup in `xss.test.ts`
  - _Requirements: 3.1–3.5_

- [x] 10. The safehouse and the yard
  - [x] 10.1 `src/ui/render/grounds.ts`: keyed cards and tombstones, formula, reasons, epitaph, totals, must-have and zombie badges, actions with `data-focus`, put-down line, impossible explanation with the must-have list
  - [x] 10.2 Focus handling when a card changes ground
  - [x] 10.3 `tests/ui/render-grounds.test.ts`, and a ticket titled `<img src=x onerror=alert(1)>` (and a key with markup) in `xss.test.ts`
  - _Requirements: 5.1–5.8, 8.1, 8.4, 8.5, 9.1–9.5, 10.2, 12.5, 18.2_

- [x] 11. Chains and the cascade
  - [x] 11.1 `src/ui/render/chains.ts`: `chainEdges` (pure), SVG drawing in one frame after layout, `ResizeObserver`
  - [x] 11.2 Fallen marks and chained-to text in the tombstones
  - [x] 11.3 `tests/ui/chains.test.ts`
  - _Requirements: 6.1–6.5, 12.8_

- [x] 12. Sound
  - [x] 12.1 `src/ui/audio/reverb.ts`, `recipes.ts`, `sound.ts` (injected factory)
  - [x] 12.2 Wire the sound button (`aria-pressed`), enable on the click, play on settled changes
  - [x] 12.3 `tests/ui/audio.test.ts` with a fake context: lazy creation, four distinct signatures, one convolver, limits, failure tolerance
  - _Requirements: 11.1–11.6, 18.5_

- [x] 13. Atmosphere
  - [x] 13.1 `src/ui/atmosphere/decor.ts` (moon, vignette, scanlines, REC), `timecode.ts`, `fog.ts`
  - [x] 13.2 Reduced-motion handling (and live changes of the setting); pause on hidden tab; 20 fps cap
  - [x] 13.3 Tests with a stubbed `matchMedia`, canvas and timers: nothing animates under reduced motion
  - _Requirements: 12.8, 12.9, 13.4, 18.3_

- [x] 14. Look: tokens, layout, components, motion
  - [x] 14.1 `styles/tokens.css`, `base.css`, `layout.css`, `components.css`, `atmosphere.css`, `motion.css`; font families with their system fallbacks (the font files come from `fonts.css`, task 6.3)
  - [x] 14.2 Title card with the disabled tour slot and the sound button; the sign, the candle, the grounds, the tools with inert slots
  - [x] 14.3 `tests/ui/contrast.test.ts` and `tests/ui/tokens.test.ts`; `tests/ui/slots.test.ts`
  - _Requirements: 12.2, 12.6–12.11, 13.1–13.6, 16.1–16.3_

- [ ] 15. Whole-app properties and accessibility structure
  - [ ] 15.1 `tests/ui/shown-lists.property.test.ts`: random action sequences through the real store and a jsdom render; shown lists equal `solveFreeze`
  - [ ] 15.2 A second, smaller run that drives the DOM (clicks on buttons, `input` events on the ranges) and checks the same equality
  - [ ] 15.3 `tests/ui/a11y.test.ts`
  - _Requirements: 5.8, 12.1, 12.3, 12.4, 12.8, 14.2, 14.6, 14.7, 17.2_

- [ ] 16. Build: CSP, base and size
  - [ ] 16.1 `vite.config.ts`: `base: './'`, `build.assetsInlineLimit: 0`, the build-only CSP plugin reading `build/csp.ts`; keep the Vitest settings (`build` is already in the `tsconfig.json` include)
  - [ ] 16.2 `npm run build`; check `dist/index.html` has the CSP, relative asset paths and no inline script or style; no font was inlined as `data:`; `dist/licenses/` is present; record the gzipped JS and CSS size (budget 60 kB) and the font file sizes
  - _Requirements: 15.3, 18.4, 20.5_

- [ ] 17. Checkpoint
  - [ ] 17.1 `npm run typecheck`, `npm test`, `npm run build` all green; the engine suite and traceability test still pass
  - [ ] 17.2 Manual checklist, in a real browser (`npm run dev` and `npm run preview`), at 360, 820 and 1280 px:
    - no horizontal scroll at 360 px and with 200 % text; the two grounds stack under 820 px
    - Tab through the whole page once: every action reachable, focus ring always visible, no focus lost after exhume, resurrect and put down
    - candle: arrows, Home, End, drag; the note updates; the sign never jumps
    - reduced motion (OS setting): fog, blink, timecode, flicker, falling and shaking all stop; text still carries every state
    - sound: off by default; on gives the four distinct sounds; nothing plays while off
    - screen reader pass (NVDA or Narrator): announcements are one sentence per settled change; the rejected exhume is read as an alert
    - network tab shows no request to any other origin; with a font file blocked the page is readable and nothing shifts badly
    - fog and scanlines on a low-power machine stay smooth
  - [ ] 17.3 Report which checklist items were verified and which were not
  - [ ] 17.4 README: how to run, what the sample board is, what is out of scope; update `docs/rule.md` with a dated section for the UI decisions (sample board, candle table, plain change sentences)
  - _Requirements: 17.3–17.5_

- [ ] 18. Deploy to GitHub Pages (last)
  - [ ] 18.1 `.github/workflows/pages.yml`: triggers, concurrency, top-level `contents: read`, job-level `pages: write` and `id-token: write` on the deploy job only
  - [ ] 18.2 Pin every action to a full commit SHA (look each one up at implementation time) with the release as a comment
  - [ ] 18.3 Validate the workflow (YAML parse and a read-through against the official Pages starter); run the same steps locally (`npm ci`, `npm run typecheck`, `npm test`, `npm run build`) and open `dist/` through `vite preview` to check relative paths
  - [ ] 18.4 README: live address, and the manual setting "Pages source: GitHub Actions"
  - [ ] 18.5 Stop before pushing; tell the user what to push and which setting to change
  - _Requirements: 20.1–20.7_
