# Requirements: night-tour

Scope: the guided tour "Play the night" (product feature 5): 60 automatic seconds that drive the **real app** through the same reducer actions
a user would trigger, with a subtitle bar, always-visible controls and a restore of the user's own state when it ends. It is also the core of
the demo video (YouTube, under 3 minutes, English), so it must look good recorded at 1920×1080 and at phone width. Everything it shows comes from
the engine at that moment. Source of truth for the numbers: the sample board (`docs/rule.md`, the `board-ui` and `fog` specs).

Out of scope: the rest of the video (intro, how Kiro was used), the death certificate, the chronicle, CSV, the MCP server, and any LLM text.
The tour is built so the first three can add scenes later without touching the player.

## Introduction

A person who has never seen the app should understand in one minute what it does: a freeze is coming, the team has so many points, some
tickets go under, and the fog shows that a cut that fills the capacity exactly does not survive wrong estimates. The tour shows that by
pressing the app's own buttons, in order, with one subtitle per scene.

## Glossary

- **Scene**: one step of the tour: some actions (maybe none), one subtitle, a duration, and a part of the page to show.
- **Script**: the ordered list of scenes. It is data.
- **Player**: the small machine that runs a script: it plays, pauses, skips, stops, ends.
- **Snapshot**: the app state at the moment the tour starts. **Restore**: putting it back when the tour ends or stops.
- **Facts**: the state and view before the scene, after it, and at the start of the tour, handed to a subtitle builder.
- **Caption bar**: the fixed bar at the bottom of the screen with the subtitle and the controls.

## Requirements

### Requirement 1: Scenes are data

**User Story:** As the author of later specs (certificate, chronicle, CSV), I want to add a scene by adding data, so that I never touch the player.

#### Acceptance Criteria

1. A `Scene` SHALL be `{ id, actions, caption, durationMs, show, spot? }`: `actions` is a list of reducer actions dispatched, in order, at the start of
   the scene (it may be empty); `caption(facts)` returns the subtitle as one sentence; `durationMs` is an integer; `show` names the part of the page
   to bring into view; `spot` optionally names tickets to ring. (The brief's triple `{ action, caption builder, duration }` gains `show` and `spot`
   because a one-minute recording of a page 2,700 px tall has to look where the change is.)
2. A `Script` SHALL be a readonly list of scenes, with unique ids. The player SHALL know nothing about any scene: no key, no number, no sentence.
3. A caption builder SHALL be a pure function of `facts` (`{ first, before, after }`, each a state and its view; `first` is the state after the first scene, the plain night). It SHALL NOT read the DOM, the clock or
   the store, and SHALL NOT do arithmetic on engine numbers (the rule of `text.ts`: counts of lists, a word chosen from a sign, formatting).
4. The sample board's script SHALL live in its own module (`src/ui/tour/sample-script.ts`); the player and the DOM live in others.
5. Adding a scene SHALL need no change outside that list: the duration check, the provenance test, the generated script document and the player
   tests iterate over the data.

### Requirement 2: The story and its real numbers

**User Story:** As the viewer, I want a story I can follow in a minute, with numbers that are true.

#### Acceptance Criteria

1. THE sample script SHALL follow this story, checked against the real sample board (numbers in `design.md` §3; the board is never changed to make a scene work):
   1. the baseline: the sample's `now` and freeze, the team's points, the tickets inside, the tickets and points outside;
   2. the candle burns down (two steps): what goes under and the cost of delay lost;
   3. someone is away: what goes out because of it;
   4. a zombie (a ticket left out many releases): what its hunger will be, then put down (Won't Do): what that does and does not change;
   5. someone insists on one ticket: exhume it; what must go out instead, and the cost of that choice;
   6. the fog on the plain board: the cut that fills the capacity holds on 0 of 1,000 nights; then the reserve steps; the message that you have to cut
      more than the arithmetic says;
   7. the close: the rule decides, not the loudest voice, and the viewer can play with their own night.
2. EVERY number in a subtitle SHALL be a fact from the engine at that moment (Requirement 12). The proposal said "Monday 08:00" and "N points of work":
   the sample's `now` is Monday 09:00, and the engine has no single "points of work" number, so scene 1 says what it does have (the team's points, the
   tickets inside, the tickets and points outside); the design records both adjustments.
3. A zombie's put-down changes no points (the engine says "No change in the cut"). The subtitle SHALL say what the engine says (the yard shrinks, the
   dependent can never ship) and SHALL NOT claim that it frees capacity.
4. THE fog scenes SHALL start from the plain sample night (a `board/reset` action, the same as the Reset button), so the numbers are the curve of
   the `fog` spec: 0, 6, 134, 347, 707, 959, 996 nights. The subtitles SHALL NOT say or imply that more reserve always helps; they state the number at
   each step and the message "you have to cut more than the arithmetic says".
5. IF a scene's action is refused or rejected by the engine (for example on another board) THEN its subtitle SHALL still be a true sentence about what
   happened, never a pre-written claim; a test runs the script on the sample board and requires every action to be accepted.

### Requirement 3: Time

**User Story:** As someone with a video limit, I want the tour to take at most a minute, and be readable.

#### Acceptance Criteria

1. THE sum of the scenes' `durationMs` SHALL be at most 60 000, checked by a test with injected timers that also runs the whole tour and counts the
   timer ticks.
2. EVERY subtitle SHALL be readable in its time, with the eyes also on the screen: at most **15 characters per second** of its scene (a test). A scene with no
   sentence is not allowed. A subtitle carries one key number; the screen (the sign, the strip, the ring) carries the rest.
3. THE player SHALL read no clock: time comes from the injected timers (`Date.now` and `performance` stay out of the UI logic, as the source scan requires).
   A scene ends with **one timer set for its whole duration**, so a browser's lateness is paid once per scene and not once per tick (the first version counted
   100 ms ticks and ran 3.4 s long in a real browser); 100 ms ticks only count the time spent, for the progress line and for what is left after a pause. A real run SHALL take the sum of the durations to within 1 second, measured in a real browser; if it does not, the report says by how much.
4. THE button label SHALL stay "Play the night · 60 s".

### Requirement 4: The player

**User Story:** As a viewer, I want to pause, skip and stop, so that moving content never traps me (WCAG 2.2.2).

#### Acceptance Criteria

1. THE player SHALL have the phases `idle`, `playing`, `paused`, `ended`; it starts a script from `idle` or `ended`, and `stop()` always returns it to `idle`.
2. THE caption bar SHALL show, while the tour runs, three controls that are always visible and always reachable: **Pause/Resume** (one button that
   changes its name, so it carries no `aria-pressed`), **Skip scene**, **Stop**. Each is a native button of at least 44 × 44 px with a visible focus ring.
3. PAUSE SHALL stop the scene timer exactly where it is; Resume SHALL continue with the time that was left. Skip SHALL apply the next scene at once
   (also while paused, which stays paused); skipping the last scene ends the tour.
4. STOP and the Escape key (while the tour is playing, paused or ended) SHALL stop it, restore the user's state (Requirement 6) and remove the bar.
5. WHEN the last scene's time is over THEN the tour SHALL end: the user's state is restored, and the bar stays with the last subtitle and two buttons,
   **Play again** and **Close**.
6. "PLAY AGAIN" SHALL run the same script again from the beginning, from the restored state.
7. THE player SHALL be deterministic: given the script, the injected timers and the injected page, the same sequence of states results, every time.
8. THE player SHALL be testable without a DOM: it talks to the app through a small interface (dispatch, snapshot and restore, show a scene, set the subtitle).

### Requirement 5: Starting it

**User Story:** As the author recording the video, I want to choose the moment the tour starts, without a cursor or a click.

#### Acceptance Criteria

1. THE header button "Play the night · 60 s" SHALL start the tour when pressed; while the tour runs the button is disabled.
2. THE URL hash `#play` SHALL NOT start the tour. WHEN the page loads with `#play` (and when the hash changes to `#play` later) it SHALL show a large prompt,
   **"Press Space to play the night"**, over the page, and wait. `Space` or `Enter` pressed anywhere SHALL start the tour and remove the prompt; `Esc` or the
   prompt's "Not now" button SHALL remove it. The prompt also has a "Play the night" button, for a phone or a mouse. The hash is read through an injected page
   interface so tests set it.
3. THE key that starts the tour is a user gesture: when `state.sound` is already on, starting the tour from the prompt SHALL call the sound player's
   `setEnabled(true)` inside that key press, so a suspended audio context is resumed and the tour's sounds can be heard. The tour still never turns sound on or
   off by itself (Requirement 11).
4. FOCUS: WHEN started from the header button or the prompt's own button THE focus SHALL move to the Pause button. WHEN started by the key (Space or Enter)
   THE focus SHALL NOT move (nothing is focused, and a ring on "Pause" would appear in the video).
5. THE prompt SHALL be large and high-contrast (the painted face, amber on night, at least 2 rem at 320 px and about 72 px at 1920 px wide), with a real
   "Play the night" button and a "Not now" button, early in the document so a keyboard reaches them. It SHALL not be shown while a tour runs and SHALL not come
   back after the tour ends or stops (until the hash changes again).
6. SOUND SHALL stay what the user chose: the tour never turns it on or off. (A browser lets sound start only after a user gesture, so a recording with sound first
   presses "Sound on" and then changes the address to `#play` without reloading: the prompt appears with sound still on; the README says so.)
7. THE tour SHALL be offered only to an app that was given a script (`mountApp(..., { tour })`). Without one, the button stays the disabled slot it
   is today and every existing test keeps its meaning. `main.ts` gives the sample script to the sample app.

### Requirement 6: The user's state comes back, exactly

**User Story:** As a user who started the tour in the middle of my own session, I want it back as it was.

#### Acceptance Criteria

1. AT START the player SHALL keep the whole app state (the object the store holds).
2. WHEN the tour ends or stops THE player SHALL put it back through one action (`state/restore`, only the tour sends it) and the state SHALL be
   **the very same object** (`toBe`), including the board with its exhumes and put-downs, the candle, the reserve, who is away and the last change note,
   checked over generated sessions.
3. EXCEPTION: `sound` keeps the value it has when the tour ends (a user who turned sound on during the tour keeps it); the rest is the snapshot's.
   When sound did not change, the restored state is the snapshot object itself.
4. THE first scene SHALL start from the plain sample night whatever the user had (its first action is `board/reset`); the user's own state is what
   comes back.
5. THE page scroll position at the start SHALL come back too (instantly), and the focus returns to the header button (Requirement 9).
6. `state/restore` SHALL not be reachable from the page: no control sends it; the reducer test covers it.

### Requirement 7: The page while the tour runs

**User Story:** As a viewer, I want to see the change, not a screen that jumps around.

#### Acceptance Criteria

1. WHILE the tour is playing or paused THE page content (`main`) SHALL be `inert`, so a click or a key cannot change the state under the tour; the
   header (with the Sound button), the prompt and the caption bar are **outside** the inert subtree and stay live (a test checks that none of them has an inert
   ancestor while the tour plays, and that `main` has). When the tour ends or stops the `inert` is removed.
2. AT EVERY scene the player SHALL bring the scene's `show` region into view, with the region's top near the top of the screen and the caption bar
   below it; with smooth scrolling normally and an instant jump under `prefers-reduced-motion`. `show` is a region name of the page (`top`, `sign`,
   `fog`, `candle`, `survivors`, `safehouse`, `yard`).
3. A scene MAY ring tickets (`spot`: the ids the page already has for focus, such as `card:HB-108` or `tomb:HB-112`); the ring is a static amber outline
   with a dark halo, set at the start of the scene and removed at its end. No animation is needed for it.
4. THE caption bar SHALL not change the layout of the page (it is `position: fixed`) and the stable heights of the sign and the fog block SHALL be
   unchanged; the page SHALL have enough room at its end to scroll the last region above the bar.
5. THE existing animations of the app (falling stones, candle, fog canvas) SHALL run as they do for a user: the tour reuses them, it does not add its own.

### Requirement 8: The subtitle bar

**User Story:** As a viewer of the video, I want large, high-contrast subtitles that I can read at a glance.

#### Acceptance Criteria

1. THE bar SHALL sit at the bottom of the screen, on a night panel, with the subtitle in the body face, bone on night (15:1), large: about 36 px at 1920 px
   wide and never under 22 px at 320 px (`clamp()` in rem), at most three lines on a phone and two on a desktop.
2. THE subtitle SHALL be one sentence, with its numbers; it changes at the start of each scene and not in between.
3. THE bar SHALL show the progress: a thin bar (a transform, not a width) and "scene n of N" as text; both are decoration for the viewer and
   hidden from assistive technology.
4. THE controls SHALL sit on the same panel, to the right on a wide screen and under the subtitle on a phone, never covering it.
5. EVERY colour SHALL come from the palette tokens and every text pair from `contrast.test.ts`; no new hex colour; no pixel font size under 16 px; no animation
   except `transform` and `opacity`.
6. AT 1920 × 1080 THE bar SHALL be contained to the page's column (`--max-width`) and centred, so a recording shows it inside the picture; at 360 and 320 px
   it SHALL take the full width without horizontal scroll.
7. THE page's own text and controls SHALL stay readable behind and above the bar in every scene (checked in a real browser, Requirement 15).

### Requirement 9: Screen readers and focus

**User Story:** As a screen-reader user, I want the tour spoken once, in order.

#### Acceptance Criteria

1. THE subtitle SHALL be in one polite, atomic live region that exists only while the bar is shown; nothing else on the page is live for the tour.
2. WHILE the tour runs the app's own announcer SHALL not speak the changes the tour makes: the tour dispatches through `ctx.act(action, { announce: false })`,
   which still plays the sound. No change is spoken twice.
3. THE focus SHALL move only: to the Pause button when the tour is started from the header button or the prompt's button (not by the Space or Enter key); to "Play again" when the tour ends while the focus was in
   the bar; to the header button when the tour is stopped (Stop, Escape, or Close). It SHALL never move to a region of the page the tour is showing.
4. THE bar SHALL be early in the document (after the skip link) so Tab reaches the controls first, and be placed at the bottom by CSS only.
5. THE controls SHALL have accessible names that say what they do ("Pause the tour", "Resume the tour", "Skip this scene", "Stop the tour", "Play the
   night again", "Close"), and the Pause button's name SHALL change with what it does (no `aria-pressed`: the name already says it).
6. `inert` on `main` SHALL not remove anything from the accessibility tree that the tour needs: the live region and the controls are outside `main`.

### Requirement 10: Reduced motion

**User Story:** As someone who asked for less motion, I want the tour without the motion.

#### Acceptance Criteria

1. UNDER `prefers-reduced-motion: reduce` THE tour SHALL still run, with the same scenes, the same timing and the same subtitles.
2. IT SHALL scroll instantly, the progress bar SHALL not animate, and the app's own animations SHALL already be off (the existing blanket rule).
3. NOTHING in the tour SHALL depend on an animation finishing.

### Requirement 11: Sound

**User Story:** As a user who muted the app, I want silence; as the author, I want the app's own sounds in the video if I turned them on.

#### Acceptance Criteria

1. THE tour SHALL play the same sound events a user's actions play (resurrect, put down, bury, cascade) through the same path, and only when `state.sound` is on.
2. THE tour SHALL play no music and no sound of its own.
3. WITH sound off NOTHING SHALL be played (a test with the recording sound player).

### Requirement 12: The numbers in the subtitles are facts

**User Story:** As the author, I want to be sure the video never shows a number the app did not compute.

#### Acceptance Criteria

1. THE number-provenance test of the UI SHALL be extended to subtitles: for every scene, every integer in the subtitle (with `1,000` read as 1000)
   is a number found in the facts it was built from (the three states and views).
2. A TEST SHALL pin every subtitle exactly as the script document shows it (Requirement 13), so a changed number is a visible change.
3. THE subtitles SHALL pass the "no promise" scan of the `fog` spec (no "safer", "better", "always", "more reserve", "raises", "improves", …) and SHALL
   contain no word that decides for the user ("you must", "the best").
4. THE story's counts and lists (how many tickets, which keys) SHALL come from the engine's lists. A key named in a subtitle is either a constant of the
   script (the same one its action uses) or comes from an engine list; a test checks that every such key is on the board.

### Requirement 13: The video script is generated

**User Story:** As the author of the video, I want the script of the tour in a document that cannot drift from the app.

#### Acceptance Criteria

1. `docs/video-tour-script.md` SHALL be generated from the script data by running it through the reducer (no DOM): for each scene its number, time
   range, the part of the page shown, what the app does in words (the action), the exact subtitle with the real numbers, and the totals.
2. A TEST SHALL compare the generated text with the file (Vitest's file snapshot) and fail on any difference, with the one command that regenerates it
   (`npx vitest run tests/ui/tour-script.test.ts -u`) written in the file's header.
3. THE document SHALL also give the real numbers behind the story (the fog curve of the sample board) and the recording notes (open the page, press "Sound on" if the video has sound, change the address to `#play`, press Space; window sizes), written in the generator so they cannot drift either.

### Requirement 14: Nothing existing gets worse

**User Story:** As the maintainer, I want the rest of the project untouched except where the tour needs a hook.

#### Acceptance Criteria

1. ALL existing tests SHALL stay green; the ones that must change (the action list of the reducer's arbitraries if needed, `slots.test.ts` for the tour
   slot, `a11y.test.ts` for the new states, the title-card children, `imports.test.ts` allow-lists) SHALL be changed on purpose and listed in the design.
2. `npm run typecheck`, `npm test` and `npm run build` SHALL pass; the gzipped JS plus CSS SHALL stay under the 60 kB budget (the report gives the new size).
3. THE engine SHALL not change. The reducer gains one internal action (`state/restore`); the context's `act` gains an options argument with a default that
   keeps today's behaviour.
4. NO board text enters the page as markup (`textContent` only); the tour adds no `innerHTML`, no network request and no new dependency.

### Requirement 15: Real-browser checks

**User Story:** As the author of a video, I want to know it looks right where it will be recorded.

#### Acceptance Criteria

1. IN A REAL BROWSER (headless Chrome through the DevTools protocol, as before) at 1920×1080, 1280×720, 360×740 and 320×640, the tour SHALL be run from
   `#play` and Space, and a screenshot taken in every scene (when its subtitle has just changed and again just before it ends).
2. FOR EACH width the report SHALL say: the subtitle is fully visible and not clipped; the scene's region is visible above the bar; the controls are
   visible; no horizontal scroll; the real duration of the run; and which scenes need a different `show`.
3. THE report SHALL also exercise Pause, Resume, Skip, Stop and Escape in the browser, and check that the state before and after a run is the same.
4. THE report SHALL say what could not be checked (a screen reader, real audio, the feel of smooth scrolling).

## Traceability

| Requirement | Verified by |
|---|---|
| 1 scenes are data | `tour-script.test.ts`, `tour-player.test.ts` (a scene added in the test runs without changes) |
| 2 story and real numbers | `tour-script.test.ts` (every action accepted; exact subtitles), `docs/video-tour-script.md` |
| 3 time | `tour-script.test.ts` (sum, reading speed), `tour-player.test.ts` (ticks), real browser |
| 4 player | `tour-player.test.ts` (phases, pause, skip, stop, end, play again, determinism) |
| 5 starting | `render-tour.test.ts` (button, prompt, Space and Enter, hash, focus, audio unlock), `slots.test.ts` |
| 6 restore | `tour-player.test.ts` (generated sessions, `toBe`), `reducer.test.ts` (`state/restore`) |
| 7 the page while it runs | `render-tour.test.ts` (inert, scroll calls, spot), real browser |
| 8 subtitle bar | `render-tour.test.ts`, `tokens.test.ts`, `contrast.test.ts`, real browser |
| 9 screen readers and focus | `a11y.test.ts`, `render-tour.test.ts` (one live region, announcer silent, focus moves) |
| 10 reduced motion | `render-tour.test.ts` (instant scroll, same timing), `tokens.test.ts` |
| 11 sound | `tour-player.test.ts` (recording sound player) |
| 12 numbers | `text.test.ts` or `tour-script.test.ts` (provenance, no-promise scan, pinned subtitles) |
| 13 generated script | `tour-script.test.ts` (file snapshot of `docs/video-tour-script.md`) |
| 14 nothing worse | the whole suite, `npm run build` |
| 15 real browser | the report of the checkpoint task |
