# Implementation plan: night-tour

Run `npm run typecheck` and `npm test` before ticking any task; tick it only when both exit 0. Run mutation checks one at a time, never in parallel on the same
file. Do not change the sample board or its seed to make a scene work. Do not commit or push.

- [x] 1. Hooks in the app (Requirements 6, 9, 14)
  - [x] 1.1 `model.ts` / `state.ts`: `Action` gains `{ type: 'state/restore'; state: AppState }`; the reducer returns `action.state`; `reducer.test.ts` pins it (the same
    object back; no other action returns a state it was not given); the arbitraries of user actions stay as they are
  - [x] 1.2 `context.ts` / `app.ts`: `act(action, options?: { announce?: boolean })` with the default that keeps today's behaviour; with `announce: false` the sound still plays and
    the announcer says nothing; tests for both
  - [x] 1.3 `services.ts`: `Services.page` (`hash()`, `onHashChange(cb)`, `reveal(element, { instant })`) with browser defaults; the test harness gets a recording `page`
  - [x] 1.4 `mountApp(..., { tour })` option and `MountedBoard.tour` (null without a script); nothing else changes without it
  - _Requirements: 5.5, 6.2, 6.6, 9.2, 14.3_
- [x] 2. The script as data (Requirements 1, 2, 3, 12)
  - [x] 2.1 `tour/types.ts` (`Scene`, `Script`, `SceneFacts`, `Show`, `Phase`) and `tour/sample-script.ts` with the scenes of design section 3 (captions built with the helpers of `text.ts`)
  - [x] 2.2 `tour/simulate.ts`: runs a script through the reducer and returns, per scene, the states, the facts, the caption and the seconds
  - [x] 2.3 Run it on the sample board and **write down the real numbers of every scene** (they go into the report); adjust only the wording, durations and `show`, never the board
  - [x] 2.4 `tour-script.test.ts`: unique ids; every action accepted; sum ≤ 60 000 ms; ≤ 15 characters per second; one sentence each; provenance of every integer in every subtitle
    (the helper reads `1,000` as 1000; the facts are the three states and views); the no-promise and no-decision word scans; every key in a subtitle is on the board
  - _Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.2, 12.1–12.4_
- [x] 3. The player (Requirements 3, 4, 6, 10, 11)
  - [x] 3.1 `tour/player.ts`: phases, 100 ms ticks through the injected timers, start, pause, resume, skip, stop, end, dispose; restore through the host
  - [x] 3.2 `tour-player.test.ts` with fake timers and a recording host: scenes in order; the state after each scene equals the simulation; the number of ticks; pause and resume keep the
    remaining time; skip while playing, while paused and on the last scene; stop and end restore the snapshot (`toBe`) over generated sessions and random stop ticks; the live sound setting is
    kept; play again; dispose clears the timer; a scene added inside the test runs with no change to the player; two runs give the same result
  - [x] 3.3 Sound: with the recording sound player, events are played only when `state.sound` is on, and the tour never toggles it
  - [x] 3.4 Mutation checks, one at a time: restore without the snapshot (restore tests must fail); tick of 90 ms (duration test must fail); skip without resetting the scene time (skip test
    must fail); apply `spot` before the actions (spot test must fail)
  - _Requirements: 3.3, 4.1–4.8, 6.1–6.4, 10.1, 11.1–11.3_
- [x] 4. The generated script (Requirement 13)
  - [x] 4.1 `tour/doc.ts`: `renderTourScript` (header with the regeneration command, the table of scenes, the real numbers, the recording notes)
  - [x] 4.2 `tour-script.test.ts` gains the file snapshot of `docs/video-tour-script.md`; generate the file with `npx vitest run tests/ui/tour-script.test.ts -u`
  - _Requirements: 13.1–13.3_
- [x] 5. The caption bar and the wiring (Requirements 5, 7, 8, 9, 10)
  - [x] 5.1 `render/tour.ts`: the bar (caption in one polite live region, count, progress line, controls), created on start and removed on close; Pause/Resume (the name changes, no `aria-pressed`), Skip,
    Stop, and Play again / Close at the end; Escape; focus rules; `inert` on `main`; `is-touring` on the page; `reveal` per scene; the spot attribute
  - [x] 5.2 `render/title-card.ts`: the tour button when the app has a tour (the disabled slot and its note stay when it has none); disabled while the tour runs; `data-focus="tour"`
  - [x] 5.3 `app.ts`: the bar and the prompt after the skip link; the announcer cleared at start; `#play` shows the prompt at start and on `hashchange` (it never starts the tour); Space or Enter (capture, no modifier) starts it, calling `setEnabled(true)` first when sound is on; Esc and "Not now" dismiss; destroy mid-tour; `main.ts` gives the sample script
  - [x] 5.4 CSS (components, layout): the bar, the progress line, the ring, room at the end of the page; palette tokens only; no pixel font under 16 px; `transform` only for motion
  - _Requirements: 5.1–5.5, 7.1–7.5, 8.1–8.6, 9.1–9.6, 10.1–10.3_
- [x] 6. Tests of the screen (Requirements 7 to 10, 14)
  - [x] 6.1 `render-tour.test.ts` (jsdom), as listed in design section 8, including: no inert ancestor above the header, the Sound button, the prompt and the bar while `main` is inert
  - [x] 6.2 `a11y.test.ts`: states while the tour plays and when it has ended; `slots.test.ts`: the tour slot with and without a script; title-card tests
  - [x] 6.3 `tokens.test.ts`, `contrast.test.ts`, `imports.test.ts` for the new CSS and files; `build.test.ts` still passes
  - _Requirements: 7–10, 14.1, 14.4_
- [x] 7. Real browser (Requirement 15)
  - [x] 7.1 Build; headless Chrome at 1920 × 1080, 1280 × 720, 360 × 740, 320 × 640; run `#play`; screenshots and measurements of every scene (design section 9); look at them
  - [x] 7.2 Fix what they show (a `show` that hides the change, a caption that wraps to four lines, a control under 44 px), and run again
  - [x] 7.3 The prompt: `#play` shows it and nothing starts; Space starts; Pause, Resume, Skip, Stop, Escape and Play again in the browser; a text digest of the page before and after a run is the same; **the real duration of a run, to be within 1 s of the script total (report it otherwise)**
  - [x] 7.4 Reduced motion: the run has the same scenes and the same time; scrolling is instant
  - _Requirements: 15.1–15.4_
- [x] 8. Words outside the code
  - [x] 8.1 `docs/video-tour-script.md` generated and checked in; README: how to play the tour, how to record it (`/#play`, sound first, window sizes)
  - [x] 8.2 Addenda to the `board-ui` requirements and design: the tour slot is filled by the `night-tour` spec when the app is given a script
  - _Requirements: 13, 14_
- [x] 9. Checkpoint
  - [x] 9.1 `npm run typecheck`, `npm test`, `npm run build` all green; gzipped JS plus CSS under 60 kB (report the number)
  - [x] 9.2 Report: the real numbers per scene, the real duration of a run, what each browser size showed and what was changed, what could not be checked
  - [x] 9.3 Stop. Do not commit or push
