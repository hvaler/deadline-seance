# Design: night-tour

Read with `requirements.md` (numbers in brackets point at its requirements). The tour is a **client of the app**: it uses the reducer, the store,
`derive` and the existing animations, and adds a player, a script, a caption bar and one internal action. The engine does not change.

## 1. Shape of the change

```
src/ui/tour/types.ts          Scene, Script, SceneFacts, Phase                                   (new, pure types)
src/ui/tour/sample-script.ts  the sample board's scenes: data and caption builders               (new, pure)
src/ui/tour/player.ts         the state machine: phases, ticks, pause, skip, stop, restore       (new, no DOM)
src/ui/tour/simulate.ts       runs a script through the reducer, no DOM: what each scene did     (new, pure)
src/ui/tour/doc.ts            renders docs/video-tour-script.md from a simulation                (new, pure)
src/ui/render/tour.ts         the caption bar, controls, live region, inert, scroll, spot, hash  (new, DOM)
src/ui/model.ts, state.ts     Action gains `state/restore`; the reducer returns the given state
src/ui/context.ts, app.ts     `act(action, { announce })`; `MountOptions.tour`; the bar goes after the skip link
src/ui/services.ts            `Services.page`: the hash, a reveal-element call, with browser defaults
src/ui/render/title-card.ts   the tour button when the app has a tour (the disabled slot stays when it has none)
src/ui/styles/*.css           the bar, the progress line, the spot ring, room at the end of the page
src/main.ts                   gives the sample script to the sample app
docs/video-tour-script.md     generated; checked by a file snapshot
```

Dependencies keep pointing one way. `player.ts`, `simulate.ts`, `doc.ts` and the script import no DOM and run in Vitest's node environment.

## 2. Scenes as data (Requirement 1)

```ts
export type Show = 'top' | 'sign' | 'fog' | 'candle' | 'survivors' | 'safehouse' | 'yard';   // a region of the page

export interface Scene {
  readonly id: string;
  /** Dispatched in order at the start of the scene, as if the user had pressed the controls. May be empty. */
  readonly actions: readonly Action[];
  /** One sentence, from facts only. */
  readonly caption: (facts: SceneFacts) => string;
  readonly durationMs: number;
  readonly show: Show;
  /** Focus ids the page already has (`card:HB-108`, `tomb:HB-112`), ringed while the scene lasts. */
  readonly spot?: readonly string[];
}

export interface Snapshot { readonly state: AppState; readonly view: View }
export interface SceneFacts {
  /** The state after the first scene: the plain night every later number is compared with. (Not the user's own state.) */
  readonly first: Snapshot;
  /** Just before this scene's actions. */
  readonly before: Snapshot;
  /** After them. */
  readonly after: Snapshot;
}
export type Script = readonly Scene[];
```

- The player runs `actions` through `host.act` one by one; the facts are made with `derive(state)` before and after. A caption builder is allowed what
  `text.ts` is allowed: counts of engine lists, a word chosen by a sign, formatting. No arithmetic on engine numbers. The cost of delay lost is
  `diff.sunkCod` or `|codDelta|`, which the engine returns; "saved cost of delay 167 → 113" quotes two totals.
- The sample script uses the existing sentence helpers (`thousands`, `count`, `listOf`, the candle labels) so the wording stays in one place.
- A later spec adds scenes by appending to a script (or building one from several lists); nothing in the player changes.

## 3. The story on the real sample board (Requirement 2)

Computed by the engine on the sample board (seed 20261116), cumulative from the plain night. Board and seed are not touched. The captions are the
proposal; the generated `docs/video-tour-script.md` will carry the final ones.

| # | Scene | Action | Show | Real facts | Subtitle (one key number) | s |
|---|---|---|---|---|---|---|
| 1 | baseline | `board/reset` | sign | now Mon 09:00; freeze Fri 18:00; team 59 points; 12 inside (59 pts, cod 167); 7 outside (129 pts, cod 101) | "Mon 09:00, freeze Fri 18:00: 59 points, and 7 tickets stay outside." | 5.5 |
| 2 | the candle burns down | `candle/set` Wed 18:00 (two steps merged) | candle | 35 points; HB-105 (11), HB-113 (14), HB-115 (13), HB-118 (16) go under, 11 outside; saved cod 167 → 113 | "The candle burns down to Wed 18:00: 35 points. Saved cost of delay falls from 167 to 113." | 6.5 |
| 3 | someone is away | `survivor/toggle` Ana | sign | 23 points; HB-104, HB-106, HB-107, HB-116 sink (45), HB-105 comes in; saved cod 113 → 79; 14 outside | "Ana is away: 23 points left, and saved cost of delay falls to 79." | 5.0 |
| 4a | a zombie | none, spot `tomb:HB-112` | yard | left out 3 releases; urgency 8 → 13 next release | "HB-112, left out 3 releases, climbs from urgency 8 to 13." | 4.0 |
| 4b | put it down | `tombstone/put-down` HB-112 | yard | engine: "No change in the cut"; HB-114 can never ship; yard 14 → 13 tickets | "Put down: HB-114 can never ship, and the yard has 13 tickets left." | 5.0 |
| 5 | someone insists | `tombstone/exhume` HB-108, spot `card:HB-108` | safehouse | HB-108 (10) rises; HB-105 (11), HB-109 (15) sink; loss 16; saved cod 79 → 63 | "Someone insists on HB-108: it comes in, and saved cost of delay falls to 63." | 6.0 |
| 6a | the fog | `board/reset`, `reserve/set` 0 | fog | 59 of 59 points; holds on 0 of 1,000 nights | "0 % reserve: the cut holds on 0 of 1,000 nights." | 5.0 |
| 6b | | `reserve/set` 10 | fog | 134 nights (13 %) | "10 % reserve: it holds on 134 of 1,000 nights." | 3.5 |
| 6c | | `reserve/set` 15 | fog | 347 nights (34 %) | "15 % reserve: it holds on 347 of 1,000 nights." | 3.5 |
| 6d | | `reserve/set` 20 | fog | 707 nights (70 %) | "20 % reserve: it holds on 707 of 1,000 nights." | 3.5 |
| 6e | the message | none | fog | 0 nights at 0 %; 707 at 20 % | "You have to cut more than the arithmetic says." | 4.5 |
| 7 | close | none | top | no numbers | "The rule decides, not the loudest voice: now play your own night." | 5.0 |
| | | | | | **total** | **57.0** |

What the detail is carried by, since a subtitle has one number: the sign (verdict figures and the change note list what rose and sank), the ring on HB-112 or HB-108,
and the fog strip. The final subtitles and their characters per second (every scene at most 15) are in the generated `docs/video-tour-script.md` and in the report.

What the real board changed in the proposal (each is a report item, none touches the board):

1. **"Monday 08:00"**: the sample's `now` is Monday 09:00 (Madrid). The subtitle uses the engine's own label, `Mon 09:00`.
2. **"N points of work"**: the engine has no single number for the whole board's effort; `keptEffort + buriedEffort` would be a sum made in the UI. Scene 1
   says the team's points and the tickets outside instead.
3. **The zombie "frees"**: putting a zombie down does not change the cut (the engine says "No change in the cut"); it removes a ticket that comes back every
   release and blocks what depends on it. The subtitle says that, with the yard count after, and does not claim freed points.
4. **The order of the story**: scenes 2 to 5 pile up on one night (Wed 18:00, Ana away); scene 6 begins with a `board/reset`, the same as the Reset button,
   so the fog numbers are the curve already pinned in `sample-board.test.ts` (0, 6, 134, 347, 707, 959, 996 nights).
5. **Exhume**: at Wed 18:00 with Ana away most exhumes are refused (the must-haves would need 28 or 41 points; the team has 23). HB-108 is accepted.
6. **The fog steps**: the 5 % step (6 nights, reads 0 %) is skipped to keep the pace; the strip under the slider shows every step anyway.

Time and reading: the gate is **15 characters per second** of the scene, because the viewer is also watching the screen. The total is 57.0 s, 3 s under the limit,
so a scene added by a later spec has room for about 3 s. The `60 s` of the button label is the name of the tour, not a computed value.
## 4. The player (Requirements 3, 4, 6, 9, 10, 11)

```ts
export type Phase = 'idle' | 'playing' | 'paused' | 'ended';

export interface TourHost {                       // the only way the player touches the app
  getState(): AppState;
  act(action: Action): void;                     // ctx.act(action, { announce: false }): the sound still plays, nothing is spoken
  restore(state: AppState): void;                // dispatches `state/restore`
  show(show: Show): void;                        // reveal the region
  spot(ids: readonly string[]): void;            // ring these (replaces the previous ones; [] clears)
  scene(info: { index: number; total: number; caption: string }): void;
  progress(elapsedMs: number, totalMs: number): void;
  phase(phase: Phase): void;
}

export interface Player {
  readonly phase: Phase;
  start(): void;  pause(): void;  resume(): void;  skip(): void;  stop(): void;  dispose(): void;
}
export function createPlayer(options: { script: Script; host: TourHost; timers: Timers }): Player;
```

- **Time is one timer per scene, plus ticks.** A scene ends with one `timers.set(endScene, duration)`; a 100 ms tick adds to the time spent in the scene (the progress line, and what is
  left after a pause). No clock is read (the source scan bans `Date.now` and `performance` outside the atmosphere). Pausing clears both timers; resuming sets the end timer for the time
  left. The first version let the ticks end the scene and ran 3.4 s long in a real browser (each 100 ms timer fired about 5 ms late); with one timer per scene the lateness is paid 12
  times, not 570. After a pause the scene runs a little longer than it should (the ticks that counted the time were late too); a test with every timer 5 ms late pins the run at the
  total plus 5 ms per scene.
- **Starting.** `start()` takes the snapshot (`host.getState()`), clears the announcer, applies scene 1, then schedules the first tick. From `ended` it does
  the same (the snapshot is the restored state).
- **A scene** = `host.act` for each action; `facts = { first, before, after }` made with `derive`; `host.scene({ caption })`; `host.show(scene.show)`;
  `host.spot(scene.spot ?? [])` after the actions (so the ringed element exists). `first` is the snapshot after scene 1.
- **Skip** applies the next scene now and resets the scene time; skipping the last scene ends the tour. **Stop** clears the timer, clears the spot, restores
  and goes to `idle`. **End** (the last scene's time is over) restores and goes to `ended`.
- **Restore** (Requirement 6): `host.restore(snapshot)`; the render layer implements it as `store.dispatch({ type: 'state/restore', state })` where
  `state` is the snapshot, or `{ ...snapshot, sound: live.sound }` when the user changed sound in between. The reducer returns `action.state` unchanged,
  so with sound unchanged `store.getState()` is the snapshot object (`toBe`).
- **`state/restore`** is the one new action: `{ type: 'state/restore'; state: AppState }`. The reducer returns `action.state`. No control sends it; the
  arbitraries that generate user actions do not include it; `reducer.test.ts` pins it.
- **Announcements.** `ctx.act(action, options = { announce: true })`; with `announce: false` the reducer runs, the sound event plays if sound is on,
  and nothing goes to the announcer. The tour passes `false`. On start the announcer is cleared so an earlier sentence is not read late.
- **Sound.** Because the tour uses `act`, the sound events are exactly a user's. The tour never calls `setEnabled`.
- **Reduced motion** changes nothing in the player: same scenes, same ticks. Only `reveal` (instant instead of smooth) and the CSS differ.
- **Dispose** (the app is destroyed while a tour runs) clears the timer, the spot and the `inert`, and removes listeners.

## 5. Restoring a session exactly (Requirement 6)

`AppState` holds the board with its exhumes and put-downs, the candle, the reserve, who is away, sound and the last change. The snapshot is that object; nothing in
it is copied or rebuilt, so restoring is returning the same reference. The test generates sessions (`arbMeaningfulAction` sequences, plus a sound toggle),
starts the tour from each, runs it to its end (and, in a second property, stops it at a random tick), and checks `store.getState()` is the snapshot.
`board/reset` at the start of the tour touches `home` only through the reducer's own rule (`initialStateFor(state.home)`), and the snapshot is untouched.

## 6. The page while it runs (Requirements 7, 8, 9)

```
div.page
  a.skip-link
  div.tour-bar[data-region="tour"]            ← created on start, removed on close; fixed to the bottom by CSS
    p.tour-caption[aria-live="polite"][aria-atomic="true"]
    div.tour-meta[aria-hidden="true"]  span.tour-count "3 of 13"  span.tour-progress > span.tour-progress-fill
    div.tour-controls  button Pause|Resume  button Skip  button Stop      (ended: Play again · Close)
  div.atmosphere-back
  header.title-card      (the "Play the night · 60 s" button, enabled only when the app has a tour)
  main[inert while the tour plays or pauses]
  …
```

- **The bar** is a two-row grid: the subtitle across the whole width, then the count with the progress line and the three buttons. (With the buttons beside the subtitle the longest sentence took three lines at 1920 px and the bar changed height from scene to scene.)`n- **Order in the document**: the bar is right after the skip link, so Tab reaches Pause first; `position: fixed; bottom` puts it at the bottom.
- **Inert**: `main` gets `inert` while the phase is `playing` or `paused`; the header (Sound) and the bar are outside `main`. The tour button is disabled meanwhile.
- **Reveal**: `Services.page.reveal(element, { instant })` scrolls so the element's top is about 16 px from the top of the screen. The default implementation
  computes `getBoundingClientRect().top + scrollY - 16` and calls `window.scrollTo({ top, behavior })`; `instant` comes from `motionPreference(matchMedia)`.
  Elements by `show`: `top` → the page top; `sign` → `[data-region="sign"]`; `fog` → the reserve control (`.reserve`: the slider the scene moves and the strip under it; the block with the figure follows below, about 430 px together, so the figure fits above the bar even on a phone). When the ticket a scene rings would sit under the bar (a tall yard on a 720 px screen or a phone), that ticket is revealed instead of the top of the region; `candle`, `survivors`, `safehouse`, `yard` → their sections. Tests inject a recording `page`.
- **Room**: while the tour is shown, `.page` gets `is-touring`, which adds bottom padding to `main` (the height of the bar plus a margin), so the last region
  can scroll above it.
- **Spot**: `[data-tour-spot]` on the elements named by `spot` (found by `data-focus`); CSS draws a 3 px amber outline with a night halo (`outline` plus
  `box-shadow`, no animation); it is removed at the end of the scene and when the tour stops.
- **The prompt** (`#play`): `Services.page.hash()` and `onHashChange(cb)`; after the first render `mountApp` shows the prompt if the hash is `#play`, and again on a later
  change to `#play`. The prompt is a `div.tour-prompt[role="group"][aria-label="Play the night"]` fixed over the page (night at 80 % behind it, above the atmosphere layers), early in the
  document, holding the big text "Press Space to play the night" (painted face, amber on night, `clamp(2rem, 6vw, 4.5rem)`), a small line "Enter works too · Esc to look around first",
  and two buttons, "Play the night" and "Not now". A `keydown` listener on the document, in the capture phase, starts the tour on Space or Enter (no modifier) while the prompt is
  shown and the target is not one of the prompt's own buttons (they handle their own press): `preventDefault()` so the page does not scroll or activate a button under it,
  call `sound.setEnabled(true)` first when `state.sound` is on (the audio unlock, inside the gesture), remove the prompt, start. Esc and "Not now" remove it.
- **Start sources and focus** (9.3): `button` (the header) and `prompt-button` → focus moves to Pause; `key` → no focus move; the end while the focus was in the bar →
  "Play again"; stop (Stop, Escape, Close) → the header button, and the page's scroll position goes back to where it was at the start (instantly).
- **Escape**: one `keydown` listener on the document while the bar or the prompt exists.

### Look

- The bar: night panel, 2 px amber top border, `max-width: var(--max-width)`, centred, padding from the page gutter; the caption in `--font-body`,
  `clamp(1.375rem, 1.1vw + 1rem, 2.25rem)` (22 px at 320 px, about 36 px at 1920 px), bone on night; the count in stone (small, 0.8125 rem); the progress
  line is a 4 px track with an amber fill scaled by `transform` (`scaleX`); the controls are `.button`s (44 px min), Pause in the primary (green) style.
- At 1920 × 1080 the page is a 1,120 px column on the fog and vignette; the bar has the same width, so the recording shows it inside the picture. If the
  empty sides look bare, widening the column from 1,600 px up is a separate change (the report says what the screenshots show).
- On a phone the controls drop under the caption in one row (three buttons), each flexible, never under 44 px high; no horizontal scroll at 320 px.
- Palette tokens only; pairs: bone/night, stone/night, amber/night; the focus ring is the global amber ring (it is visible on night); nothing animates except
  `transform` (the progress line, and nothing else); the global reduced-motion rule already removes that.

## 7. The generated script (Requirement 13)

`simulate(script, initialState)` runs the scenes through the reducer in plain TypeScript: for each scene, the state before and after, the facts, the caption,
the start and end second, and the sentence for the actions ("Moves the candle to Thu 18:00", "Sends Ana away", "Exhumes HB-108", "Sets the reserve to 10 %").
`renderTourScript(simulation)` returns the Markdown: a header with the regeneration command, a table of scenes (number, seconds, shows, what the app does,
subtitle), the real numbers behind the story (the fog curve of the plain night), and recording notes (open `/#play`; 1920 × 1080; press "Sound on" first if
the video has sound; Escape stops). `tests/ui/tour-script.test.ts` does `expect(markdown).toMatchFileSnapshot('../../docs/video-tour-script.md')`: a difference
fails the test, and `npx vitest run tests/ui/tour-script.test.ts -u` rewrites the file.

## 8. Tests (Requirements 1 to 15)

| File | Checks |
|---|---|
| `tour-script.test.ts` (node) | unique ids; every action accepted by the engine on the sample board; duration sum ≤ 60 000 and the label; ≤ 15 characters per second; each subtitle one sentence; exact subtitles pinned through the file snapshot; provenance of every integer (extending the helper with the three states and views, `1,000` as 1000); the no-promise and no-decision word scans; every key typed in the script exists on the board |
| `tour-player.test.ts` (node, fake timers) | phases; scenes in order with the state after each equal to the simulation; total ticks; pause/resume keeps the remaining time; skip (also paused, also last); stop and end restore the snapshot (`toBe`) over generated sessions and random stop ticks; sound kept; play again; dispose; a scene added in the test needs no change; determinism (two runs equal); the announcer receives nothing; the recording sound player gets the events only when sound is on |
| `render-tour.test.ts` (jsdom) | the button enabled with a tour and the slot kept without; the bar's structure and names (no `aria-pressed`); one polite live region with the caption; the announcer's region stays empty; `inert` on `main` while playing and removed after, with no inert ancestor above the header, the Sound button, the prompt or the bar; the prompt (shown for `#play` and on `hashchange`, never starts by itself, Space and Enter start it and call `preventDefault`, other keys and modified keys do not, Esc and "Not now" dismiss, it does not return after a run); the audio unlock when sound is on; focus moves (header button and prompt button → Pause; key start no move; end → Play again; stop → button); Escape; reveal calls per scene with `instant` under reduced motion; spot attributes set and removed; the tour button disabled while it runs; no `innerHTML`; destroy mid-tour |
| `reducer.test.ts` | `state/restore` returns the given state; nothing else returns a state it was not given |
| `a11y.test.ts` | the states while the tour plays and when it has ended: names, live regions (two, one silent), no positive tabindex, the bar is early in the document |
| `tokens.test.ts`, `contrast.test.ts` | the new rules use tokens only, no pixel font sizes under 16 px, motion rules; the pairs used |
| `imports.test.ts` | the new files read no clock and use no `innerHTML` |

Existing tests that change on purpose: `slots.test.ts` (the tour slot is still a disabled button without a script; a case with a script), the title-card
children test, `a11y.test.ts` (new states), and the exports of `src/ui` are not asserted anywhere else.

## 9. Real-browser checks (Requirement 15)

A temporary DevTools-protocol script (not committed), as for the earlier specs: a static server with the `dist/` build, headless Chrome at 1920 × 1080,
1280 × 720, 360 × 740 and 320 × 640, `#play`. It polls the caption text every 200 ms; at each change and just before the next one it takes a screenshot of
the visible screen and measures: the caption box (inside the viewport, not clipped, line count), the `show` region's rect (above the bar), the controls'
rects (≥ 44 px, visible), `scrollWidth` against `clientWidth`, and the run time from the first caption to the end. Then it runs the controls (Pause for
2 s and Resume; Skip; Stop; Escape; "Play again") and compares a text digest of the page (verdict, note, candle value, reserve value, the two lists)
before and after a run. The screenshots are looked at and the report says what needed a different `show`.

## 10. Decisions (answered by the review)

1. **Scenes carry `show` and `spot`** besides the brief's triple. Yes.
2. **Monday 09:00, no UI-made total, the zombie wording.** Yes.
3. **`main` is `inert` while the tour plays**, provided the controls and the Sound button are outside the inert subtree: a test checks that none has an inert ancestor. Yes.
4. **`state/restore` and the opt-in `tour` option.** Yes.
5. **15 characters per second**, scenes 2a and 2b merged, one key number per subtitle. Done (section 3).
6. **`#play` shows a prompt instead of starting.** "Press Space to play the night"; Space or Enter starts; Esc or "Not now" dismisses; the header button still starts directly.
   A key start does not move the focus; a start from a button does. When sound is already on, the key press calls `setEnabled(true)` so the audio context is resumed inside a gesture.
7. **Timer drift**: measured in a real browser at 1920, 1280, 360 and 320 px and under reduced motion: the first subtitle to the end took 57.10 to 57.12 s for a script of 57.0 s (+0.1 s), after the timing was changed to one timer per scene (the first version ran 60.4 s).
8. **The restored state keeps the live `sound` setting.** (Unchanged.)
9. **The Pause button changes its name and has no `aria-pressed`** (a toggle with a changing name should not also expose a pressed state).