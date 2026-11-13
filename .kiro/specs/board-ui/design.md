# Design: board-ui

Implements `requirements.md` in `src/ui` and `src/main.ts`, on the public API of `src/engine/index.ts` only. Follows
`.kiro/steering/{product,tech,structure}.md` and `docs/rule.md`.

## 1. Shape of the app

```
 user input ──► controllers ──► store.dispatch(action)
 (click, key,     (frame coalescing,         │
  range input)     settle timer)             ▼
                                      reducer(state, action)        pure; calls the engine
                                             │
                                             ▼
                                        AppState (plain value)
                                             │
                                             ▼
                                      derive(state) ──► engine: capacityBetween, effectiveCapacity,
                                             │                    solveFreeze, codParts
                                             ▼
                                         View (facts + words)
                                             │
              ┌──────────────┬───────────────┼───────────────┬──────────────┐
              ▼              ▼               ▼               ▼              ▼
          sign + note     candle         survivors    safehouse + yard   announcer, sound
```

- The reducer is the only place state changes. It calls the engine for `exhume`, `resurrect`, `putDown` (they return a new board)
  and for the two solutions that `diffSolutions` compares. It is pure because the engine is.
- `derive` turns state into a `View`: only facts from the engine plus the board data (titles, keys, who depends on whom).
- Rendering patches the DOM by key. Controllers and the audio engine are the only impure parts; the clock is read only by the
  decorative timecode (`performance.now`, no `Date`).

## 2. Modules

```
src/
  main.ts                      imports the styles, builds the services, calls mountApp
  ui/
    sample-board.ts            SAMPLE_NOW, the board data, product line, people
    candle-steps.ts            CANDLE_STEPS: label + freezeAt for steps 0..10
    model.ts                   AppState, Action, Subject, Comparison, Change, initialState(For), presentPeople, boardFor, freezeFor
    solve.ts                   solveState (cached engine call), compareSolutions, compareStates
    state.ts                   the reducer (re-exports the model types)
    store.ts                   createStore(reducer, initial): getState, dispatch, subscribe
    derive.ts                  derive(state): View
    text.ts                    every sentence: verdict, change note, reasons, epitaphs, formulas, errors
    sound-events.ts            soundEventFor(change, view): 'resurrect' | 'put-down' | 'bury' | 'cascade' | null
    dom.ts                     el(), text helpers, setText, keyed list patch, focus helpers (no innerHTML)
    app.ts                     mountApp(root, store, services): builds the skeleton, subscribes, renders
    gestures.ts                frame coalescing and settle timer for the two range inputs
    announcer.ts               hidden live region
    render/
      title-card.ts            title, product line, tour slot, sound button
      sign.ts                  verdict, change note, reserve slider, fog slot
      candle.ts                candle drawing, range input, notches
      survivors.ts             team switches
      grounds.ts               safehouse and yard: cards, tombstones, actions, put-down line
      chains.ts                chain edges (pure) + SVG drawing
      tools.ts                 reset button and the inert slots
      invalid-board.ts         the screen for a board that fails validation
    audio/
      sound.ts                 createSound(factory): enable, disable, play(event)
      recipes.ts               the four recipes, as functions of a context
      reverb.ts                generated impulse response
    atmosphere/
      fog.ts  timecode.ts  decor.ts    canvas fog, running timecode, moon/vignette/scanlines/REC elements
    styles/
      fonts.css  tokens.css  base.css  layout.css  components.css  atmosphere.css  motion.css
build/
  csp.ts                       the Content Security Policy string (read by the Vite plugin and by tests)
public/licenses/               the four font licence texts, shipped with the build
index.html                     root element and the entry script only: no fonts link, no other origin, no inline script or style
tests/ui/                      see section 14
```

`structure.md` lists `ui` as one folder; the sub-folders keep one concern per module. `src/engine` is untouched except for
Requirement 19 (section 13).

## 3. The sample board

### People and time

`now = Date.UTC(2026, 10, 16, 8, 0)` (Monday 2026-11-16, 09:00 in `Europe/Madrid`, CET). Board: `timeZone: 'Europe/Madrid'`,
`nextReleaseWeeks: 2`, `zombieThreshold: 3`, `wontDo: []`.

| Survivor | Points per half day | Days off |
|---|---|---|
| Ana | 2 | none |
| Bruno | 2 | none |
| Carla | 1 | none |
| Dev | 1 | 2026-11-18 afternoon |

Ten counted half days at 6 points per half day, less Dev's one point on Wednesday afternoon, gives capacity **59** at Friday 18:00.

### Candle steps

| Step | Label | Freeze (UTC) | Capacity (all four here) |
|---|---|---|---|
| 0 | Mon 09:00 | 2026-11-16T08:00Z (= `now`) | 0 |
| 1 | Mon 13:00 | 2026-11-16T12:00Z | 6 |
| 2 | Mon 18:00 | 2026-11-16T17:00Z | 12 |
| 3 | Tue 13:00 | 2026-11-17T12:00Z | 18 |
| 4 | Tue 18:00 | 2026-11-17T17:00Z | 24 |
| 5 | Wed 13:00 | 2026-11-18T12:00Z | 30 |
| 6 | Wed 18:00 | 2026-11-18T17:00Z | 35 |
| 7 | Thu 13:00 | 2026-11-19T12:00Z | 41 |
| 8 | Thu 18:00 | 2026-11-19T17:00Z | 47 |
| 9 | Fri 13:00 | 2026-11-20T12:00Z | 53 |
| 10 | Fri 18:00 | 2026-11-20T17:00Z | 59 |

A freeze at the end of a slot counts that slot (its midpoint, 11:00 or 16:00, is earlier). The table is a constant in code
(`Date.UTC(2026, 10, 16 + day, endHour - 1, 0)`, CET is UTC+1 that week); `candle-steps.test.ts` formats each instant with `Intl` in
`Europe/Madrid` and compares it with the label.

### Tickets

Costs are `value + urgency + risk` on the scale 1, 2, 3, 5, 8, 13, 20. "cod" is the engine's value after hunger.

| Key | Title | Effort | Value, urgency, risk | past | cod | Notes |
|---|---|---|---|---|---|---|
| HB-101 | Fix stale balance after a transfer | 5 | 8, 5, 5 | 0 | 18 | must-have |
| HB-102 | Strong-auth callback (PSD2) | 8 | 8, 13, 8 | 0 | 29 | must-have |
| HB-103 | Store listing and release notes | 2 | 2, 3, 1 | 0 | 6 | must-have |
| HB-104 | Biometric login fallback | 5 | 5, 3, 3 | 0 | 11 | |
| HB-105 | Dark-mode statement PDF | 3 | 3, 1, 3 | 3 | 11 | hungry: urgency 1 → 5 (cod 7 → 11) |
| HB-106 | Card freeze toggle | 5 | 8, 5, 3 | 0 | 16 | needs HB-104 |
| HB-107 | Card freeze push alerts | 3 | 5, 3, 3 | 0 | 11 | needs HB-106 (chain of three) |
| HB-108 | Transaction search | 8 | 5, 2, 3 | 0 | 10 | |
| HB-109 | Instant-transfer limits screen | 5 | 5, 5, 5 | 0 | 15 | needs HB-102 |
| HB-110 | Spending insights widget | 13 | 5, 2, 3 | 2 | 13 | zombie when buried (urgency 2 → 5) |
| HB-111 | Savings goals | 13 | imported cod 14 | 0 | 14 | "imported cost of delay" |
| HB-112 | Multi-currency wallet | 21 | 5, 2, 3 | 3 | 16 | zombie when buried (urgency 2 → 8) |
| HB-113 | Accessibility audit fixes | 5 | 3, 3, 3 | 2 | 14 | hungry: urgency 3 → 8 (cod 9 → 14) |
| HB-114 | FX rate alerts | 5 | 5, 3, 3 | 0 | 11 | needs HB-112 (cascade) |
| HB-115 | Phone wallet pass | 8 | 5, 3, 5 | 0 | 13 | |
| HB-116 | Balance home-screen widget | 2 | 3, 2, 2 | 0 | 7 | |
| HB-117 | Onboarding rewrite | 21 | 8, 3, 5 | 0 | 16 | needs HB-104 |
| HB-118 | Referral programme | 8 | 5, 1, 3 | 4 | 16 | hungry: urgency 1 → 8 |
| HB-119 | Core ledger migration | 48 | 8, 5, 8 | 0 | 21 | too big to exhume |

Total effort 188, total cod 268. The must-haves with their chains need 15 points.

### What the engine says about it (checked with the engine on 2026-11-13; a test pins these)

- **Friday 18:00, no reserve, everybody here**: kept effort 59 of 59, saved cod 167. Kept: HB-101 to HB-107, HB-109, HB-113, HB-115, HB-116,
  HB-118. Buried (effort 129, cod 101): HB-108, HB-110 (zombie), HB-111, HB-112 (zombie), HB-114 (depends on HB-112), HB-117, HB-119.
- **Impossible** at steps 0, 1 and 2: the must-haves need 15 points and the capacity is 0, 6 and 12.
- **The candle moving left from Friday 18:00** keeps changing the cut: for example step 5 → 6 (Wed 13:00 → Wed 18:00) raises HB-104, HB-106,
  HB-107 and sinks HB-105, HB-113 (gain 13); step 9 → 10 raises HB-115 (gain 13).
- **Exhume at the initial state**: HB-108 sinks HB-115 (loss 3); HB-110 sinks HB-113 and HB-115 (loss 14); HB-112 sinks HB-113, HB-115 and
  HB-118 (loss 27); HB-119 is **rejected** (the must-haves with it need 63; there are 59).
- **Put down** HB-112: HB-114 can never ship; the cut does not change. HB-110: nothing else changes.
- **Ana away**: capacity 39, sinks HB-113, HB-115, HB-118 (loss 43). **Dev away**: capacity 50, sinks HB-115, HB-116 (loss 20).
- **Reserve** 15 %: effective capacity 50, sinks HB-115 and HB-116 (loss 20). 30 %: effective capacity 41, also sinks HB-118 (loss 36).

The survival odds from the product's demo message ("0 % without reserve, 100 % at 30 %") need the fog simulation, which is a later spec;
this board is not tuned to them.

## 4. State

```ts
export type Action =
  | { type: 'candle/set'; step: number }
  | { type: 'reserve/set'; pct: number }
  | { type: 'survivor/toggle'; name: string }
  | { type: 'tombstone/exhume'; key: string }
  | { type: 'tombstone/resurrect'; key: string }
  | { type: 'tombstone/put-down'; key: string }
  | { type: 'sound/set'; on: boolean }
  | { type: 'board/reset' };

export interface AppState {
  readonly board: ValidBoard;           // full team; exhumes and put-downs applied
  readonly home: ValidBoard;            // the board as loaded, to go back to on reset
  readonly candle: number;              // 0..10
  readonly marginPct: number;           // 0, 5, ..., 30
  readonly away: readonly string[];     // names sent away, sorted
  readonly sound: boolean;
  readonly change: Change;              // what the last action did
}

export type Subject =
  | { kind: 'candle'; from: number; to: number }
  | { kind: 'reserve'; from: number; to: number }
  | { kind: 'survivor'; name: string; away: boolean }
  | { kind: 'exhume' | 'resurrect' | 'put-down'; key: string }
  | { kind: 'reset' };

export type Comparison =
  | { kind: 'diff'; before: SolvedSolution; after: SolvedSolution; diff: Diff }
  | { kind: 'not-comparable'; before: Solution; after: Solution }     // one side is an impossible freeze
  | { kind: 'no-diff'; before: SolvedSolution; after: SolvedSolution }; // both solved, but a ticket exists on only one side (reset after a put down)

export type Change =
  | { kind: 'none' }
  | { kind: 'done'; subject: Subject; comparison: Comparison }
  | { kind: 'rejected'; subject: Subject; impossible: ImpossibleSolution }   // an exhume the engine refused
  | { kind: 'refused'; subject: Subject; error: EngineError };               // unknown key, not a zombie
```

`state.sound` is changed by `sound/set` without touching `change`. All other actions set `change`.

### Reducer rules

- `candle/set`: ignore (return the same state) if `step` is not an integer in 0..10 or equals the current step. Otherwise new state and
  `change = done(candle, compareStates(prev, next))`.
- `reserve/set`: ignore unless `pct` is one of 0, 5, ..., 30 and different. Same pattern.
- `survivor/toggle`: ignore unknown names. Add or remove the name (kept sorted). Same pattern.
- `tombstone/exhume` and `tombstone/resurrect`: call `exhume(boardFor(state), freeze, key)` (`resurrect` is the same engine function). Unknown key
  or other error: `refused`, board unchanged. `rejected` result: `change = rejected`, **the same `board` reference**. Applied: take
  `out.board.tickets` and `out.board.wontDo`, keep the full roster, re-validate with `validateBoard`, `change = done`
  with `{ kind: 'diff', before: out.before, after: out.after, diff: out.diff }`.
- `tombstone/put-down`: same with `putDown`; an error means `refused`.
- `board/reset`: the initial state of `home` with `sound` kept and `change = done(reset, compareStates(prev, initial))`.
- `sound/set`: set the flag only.

`boardFor(state)` is `validateBoard({ ...state.board, people: present })` where `present` is the roster minus `away` (never fails: it only
removes people). `freezeFor(state)` is `{ now: SAMPLE_NOW, freezeAt: CANDLE_STEPS[candle].freezeAt, marginPct }`.

`compareStates(a, b)` solves both states through the cached `solveState` and returns `diff` (with `diffSolutions`), `not-comparable` when either
side is impossible, or `no-diff` when `diffSolutions` refuses two solved freezes because a ticket was put down on one side only (a reset that brings a closed ticket back: only the saved cod before and after is shown). The controllers use it to compare the state at the start of a gesture with the state at its end.

`initialState` is a function so tests can build fresh values.

## 5. `derive` and the view

```ts
export interface View {
  readonly freeze: FreezeInput;
  readonly candle: {
    step: number; label: string; capacity: number; effectiveCapacity: number;   // capacityBetween, effectiveCapacity
    notches: readonly { step: number; label: string; capacity: number }[];
  };
  readonly solution: Solution;
  readonly team: readonly { name: string; pointsPerHalfDay: number; away: boolean }[];
  readonly safehouse: readonly CardView[];       // empty when impossible
  readonly yard: readonly TombstoneView[];       // empty when impossible
  readonly totals: { keptCount: number; keptEffort: number; savedCod: number; buriedCount: number; buriedEffort: number; buriedCod: number } | null;
  readonly chains: readonly { from: string; to: string }[];   // from depends on to; both buried
  readonly mustHaves: readonly { key: string; title: string; effort: number }[];  // listed while impossible
  readonly putDown: readonly string[];            // board.wontDo
}
interface CardView { key; title; effort; mustHave; needs: string[]; cost: CodParts }
interface TombstoneView extends CardView { reason: Reason; burialCost: number; isZombie: boolean; past: number; chainedTo: string[]; fell: boolean }
```

- Sources: `capacityBetween(present, tz, now, freezeAt)` and `effectiveCapacity` for the candle readouts and notches (a test checks they
  equal the solution's `capacity` and `effectiveCapacity`); `solveFreeze` for the solution; `codParts` for every card; the board for titles,
  `dependsOn` and `past`. Sorting is by key with `compareKeys` from the engine.
- `fell` is `reason.kind === 'depends-on-buried'`. `chains` is every `(t.key, d)` with `d ∈ t.dependsOn` where both keys are buried.
- The cache (`solve.ts`) is a `WeakMap` keyed by the identity of the full board object, then by `candle|margin|away`, with up to 64 solutions per board. A new board object (any exhume, put down or reset to another board) starts a new cache, so an answer can never be reused for a different board. It never changes a result.

## 6. Words (`text.ts`)

All sentences are pure functions of facts. Numbers are inserted as integers with no arithmetic. Plural rules are in one helper.

| Sentence | Template |
|---|---|
| Verdict, solved | `Inside the safehouse: {keptCount} tickets, {keptEffort} of {effectiveCapacity} points, saved cod {savedCod}. Left outside: {buriedCount} tickets, cod {buriedCod}.` plus, with a reserve, `Capacity {capacity}, {marginPct} % reserve.` |
| Verdict, impossible | `The must-haves need {needed} points; there are {capacity} ({effectiveCapacity} after the {marginPct} % reserve). Move the candle later, or drop a must-have.` and per blocked must-have `{key} can never ship: it depends on {putDownKey}, which was put down.` |
| Change header | `Candle moved to {label}.` · `Reserve set to {pct} %.` · `{name} sent away.` · `{name} is back.` · `{key} exhumed.` · `{key} resurrected.` · `{key} closed as Won't Do.` · `Back to the sample board.` |
| Change body | `Rises: {key} ({cod}), …; together {raisedCod}.` (a single entry has no "together") · `Sinks: …; together {sunkCod}.` · `Nothing rises and nothing sinks.` · `Gain: {codDelta}.` / `Loss: {abs}.` / `No change in saved cod.` · `Saved cod {before} → {after}.` |
| Not comparable | `No comparison: the freeze is impossible (needs {needed} points; {effectiveCapacity} available).` using the impossible side. No diff (reset after a put down): `Saved cod {before} → {after}.` and `The board changed, so there is no ticket-by-ticket comparison.` |
| Rejected exhume | headline `{key} stays in the ground.`, then `The must-haves with {key} need {needed} points; there are {capacity} ({effectiveCapacity} after the {marginPct} % reserve).`, then for each blocked must-have `{key} can never ship: it depends on {putDownKey}, which was put down.`, then `Move the candle later, or drop a must-have.` |
| Put down | `{key} closed as Won't Do.`, `{k1} and {k2} can never ship.` for the tickets whose reason is now `blocked-by-put-down` because of this key, and `No change in the cut.` |
| First load | `Nothing has moved yet.` |
| Reason | `Needs {needed} points, {left} left.` · `Depends on {keys}, which {is/are} buried.` · `Depends on {putDownKey}, which was put down.` |
| Cost | `value 5 + urgency 3 + risk 3 = 11` · hungry `value 3 + urgency 1 → 5 + risk 3 = 11`, `left out 3 releases` · `imported cost of delay 14` |
| Epitaph, no room | `Here lies {key}. It needed {needed} points and the night had {left} left. Waiting {weeks} {week|weeks} costs {burialCost}.` |
| Epitaph, cascade | `Here lies {key}. It followed {keys} into the ground. Waiting {weeks} … costs {burialCost}.` |
| Epitaph, blocked | `Here lies {key}. {putDownKey} was closed as Won't Do, so it can never ship. Waiting … costs {burialCost}.` |
| Refused | headline `Nothing was done.` and one of `{key} is not on the board.` · `{key} is not a zombie, so it cannot be put down.` · `The freeze is impossible, so there is no cut to change.` |
| Epitaph, zombie suffix | `It has been left out {past} releases in a row.` |

`epitaphFor(tombstone, weeks)` is the single function a later spec replaces. `describeValidationError(e)` is an exhaustive `switch` over
`ValidationErrorCode` (a `never` check makes a new code a compile error), for example `Dependency cycle: HB-1 → HB-2 → HB-1.`, `HB-5 depends
on HB-9, which is not on the board.`, `HB-5: effort must be a whole number (got 1.5).`

Words with signs ("Gain"/"Loss") come from `Math.sign`-style comparison of an engine number with zero; that is wording, not arithmetic.
The absolute value for "Loss: 43" is a display step on an integer; the test keeps it as one helper.

## 7. Rendering

- `dom.ts`: `el(tag, { class, attrs, text }, children)`, `svg(tag, attrs)`, `setText(node, string)` (writes only when changed). The only way
  text enters the page is `textContent`.
- `mountApp` builds the skeleton once (title card, sign, candle, survivors, grounds, tools, decoration, announcer). `render(state)` runs
  `derive`, then each region's `update(view)`.
- **Keyed patch.** `grounds.ts` keeps `Map<key, element>` for cards and for tombstones. Each render: create missing elements, update text
  and classes, then place the elements in order inside their ground (`insertBefore` only when out of place). A ticket moving ground is a
  re-parent of the same element type (card ↔ tombstone are different elements keyed `card:HB-1` and `tomb:HB-1`).
- **Focus.** Every actionable element has `data-focus="<kind>:<id>"` (for example `exhume:HB-110`). Before patching, read the focus id; after,
  if the element still exists focus it; else focus `card:<key>` (an `article` with `tabindex="-1"`), else the section heading
  (`tabindex="-1"`). Focus is only moved when it would otherwise be lost.
- **Announcer.** A visually hidden `<div aria-live="polite" aria-atomic="true">`; `announce(text)` clears it and writes the text in the next
  frame so repeated text is read again. Alerts (`role="alert"`) are separate elements inside the sign.
- **Invalid board.** `mountApp` validates first. On errors it renders `invalid-board.ts` (the list of sentences from `describeValidationError`)
  instead of the grounds.
- **Inert slots** (`tools.ts`, `title-card.ts`, `sign.ts`): `data-slot` = `tour`, `fog`, `certificate`, `chronicle`, `csv`, `mcp`. A `<button disabled>`
  or plain text, with the words "not built yet".

### Gestures (`gestures.ts`)

For each range input (candle, reserve): on `input` store the latest value and, if no frame is pending, `requestAnimationFrame` a single
`dispatch`. On the first input of a gesture remember `startState`. A settle timer (300 ms after the last input, or the `change` event, whichever
is first) calls `compareStates(startState, currentState)`, announces the sentence, plays the sound, and clears `startState`. Discrete actions
(buttons) announce and play immediately. Timers and `requestAnimationFrame` are injected, so tests use fake ones.

## 8. Chains

`chainEdges(view)` is pure and returns the pairs. `chains.ts` draws them into an `<svg aria-hidden="true">` placed behind the tombstones in the
yard: after each render and on `ResizeObserver` callbacks, in one `requestAnimationFrame`, read the rectangles of the tombstones once
(relative to the yard), then write one `path` per edge (a hanging curve from the bottom centre of the dependent to the top centre of its
dependency), styled as a chain (dashed stroke in stone, with a heavier dash). The same relation is also written in text on the dependent
("chained to HB-112").

The cascade: tombstones with `fell` get `data-fell="true"`; CSS gives them a short drop and tilt (`transform`) with `animation-delay` from a
`--i` custom property set to their list position. Under reduced motion there is no animation and the tombstone keeps a static tilt and a visible
"fell behind HB-112" line.

## 9. Sound

```ts
interface AudioLike {                       // the part of AudioContext the recipes use
  currentTime: number; sampleRate: number; state: string; destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscillatorLike; createGain(): GainLike; createBiquadFilter(): FilterLike;
  createBufferSource(): SourceLike; createBuffer(channels: number, length: number, rate: number): BufferLike;
  createConvolver(): ConvolverLike;
}
createSound(factory: () => AudioLike | null): { setEnabled(on: boolean): void; play(event: SoundEvent): void }
```

- `setEnabled(true)` (called from the button's click handler, a user gesture) creates the context (once) and `resume()`s it, builds a master gain
  (0.25) and the single convolver with a 1.2 s stereo impulse from a deterministic integer sequence (`seed = (seed × 1664525 + 1013904223) >>> 0`,
  exponential decay). `setEnabled(false)` suspends the context. If the factory returns `null` or throws, `play` does nothing.
- Recipes (times in seconds from "now"; all outputs go to the master gain, with the reverb in parallel at the stated send):
  - **resurrect** (0.9 s): two sawtooth oscillators at 220 Hz and 223 Hz gliding to 440 Hz and 446 Hz, through a low-pass sweeping 400 → 2400 Hz, a 6 Hz
    tremolo on the gain, then a sine breath at 1320 Hz for 0.2 s; reverb send 0.5.
  - **put down** (1.0 s): a 40 ms high-passed noise crack, a sine at 65 Hz decaying over 0.5 s, and two bell partials at 523 Hz and 811 Hz decaying over
    0.7 s; reverb send 0.25.
  - **bury** (0.5 s): a sine falling from 110 Hz to 48 Hz with an exponential gain decay, plus a 120 ms low-passed noise burst (soil); reverb send 0.2.
  - **cascade** (0.9 s): five bury thuds 70 ms apart, each a semitone lower and 15 % quieter than the one before; reverb send 0.25.
- Each recipe creates fewer than 40 nodes (the cascade, with five thuds, is the largest) and no node outlives 1.6 s. The impulse and the noise buffers are
  created once and reused.
- `soundEventFor(change, view)` (pure): `done(exhume|resurrect)` → `resurrect`; `done(put-down)` → `put-down`; `done(candle|reserve|survivor)` with
  `sunk.length > 0` → `cascade` if some sunk key is in `view.yard` with `reason.kind = 'depends-on-buried'`, else `bury`; everything else → `null`.

## 10. Atmosphere

All elements are children of one `<div class="atmosphere" aria-hidden="true">` with `pointer-events: none`.

- **Fog** (`fog.ts`): a `<canvas>` at a quarter of the viewport size. Six soft sprites are pre-rendered once (radial gradient on an offscreen canvas).
  Positions and speeds come from an integer hash of the index. Each frame draws the sprites with `drawImage` at slowly changing offsets. Frame
  cap 20 fps by timestamp; `visibilitychange` pauses it; `prefers-reduced-motion` draws one frame and stops (and listens for changes).
- **Moon**: a CSS radial gradient at the top right, low opacity.
- **Vignette** and **scanlines**: two fixed pseudo-elements with a radial gradient and a repeating linear gradient (2 px period). Static.
- **REC and timecode** (`timecode.ts`): a "● REC" with a CSS blink (steps) and a text node `HH:MM:SS:FF` updated four times a second from
  `performance.now()` elapsed since load. Under reduced motion it shows `00:00:00:00` and does not blink.
- **Title glow**: `text-shadow` in red; a slow flicker on `opacity` only, off under reduced motion.

## 11. Look and layout

### Tokens (`tokens.css`)

`--night #110e16`, `--ply-1 #3a2c22`, `--ply-2 #4a3829`, `--bone #ebe4d3`, `--stone #a49cad`, `--dim #6f6779`, `--red #ff3d3d`, `--green #8fd47e`,
`--violet #7d5cff`, `--tape #d9cfa6`, `--rust #b8592f`, `--amber #f1b24a`. Fonts: `--font-title "Rubik Wet Paint"`, `--font-sign "Permanent Marker"`,
`--font-body "IBM Plex Sans"`, `--font-mono "IBM Plex Mono"` with `font-variant-numeric: tabular-nums`; fallbacks `Impact, "Arial Black", sans-serif`;
`"Marker Felt", "Comic Sans MS", cursive`; `system-ui, sans-serif`; `ui-monospace, Consolas, monospace`. Body size 16 px minimum.

### Contrast (computed from the palette; a test recomputes them)

Allowed text pairs (at least 4.5:1): bone on night 15.09, on plywood-1 10.60, on plywood-2 8.77; stone on night 7.23, on plywood-1 5.08; red on night 5.45;
green on night 10.82, on plywood-1 7.60, on plywood-2 6.29; amber on night 10.20, on plywood-1 7.17, on plywood-2 5.93; night on tape 12.23; plywood-1 on tape
8.59; night on green 10.82; night on amber 10.20; night on red 5.45.

Not allowed for text below 24 px (or 18.66 px bold): stone on plywood-2 (4.20), red on plywood-1 (3.83), violet on night (4.41), violet on plywood-1 (3.10), rust
(≤ 4.10), dim (≤ 3.54), bone on violet (3.42), bone on red (2.77). So: dim is decoration and disabled controls only; violet is a border, icon or large type, and the
zombie badge is a night fill with a 2 px violet border and bone text; danger text sits on night; the title (large) may be red on night. Non-text parts (borders, focus
ring, switch states) need 3:1: amber on night/plywood passes.

### Layout (`layout.css`)

`main` is a centered column, max width 1120 px, padding 16 px (24 px from 820 px). Sections, top to bottom: title card; sign; candle; survivors;
`.grounds` (`display: grid; grid-template-columns: 1fr 1fr; gap: 24px`, one column under 820 px); tools. The yard is a grid
`repeat(auto-fill, minmax(220px, 1fr))` of tombstones with the chain SVG behind. The candle section is a flex row (drawing left, controls right) that wraps.
Chips, buttons and cards wrap; nothing has a fixed width above 100 %. At 360 px the notches show every second capacity.

Plank cards: plywood-1 with a repeating wood-grain gradient, a green left edge and the word "inside". Tombstones: plywood-2 slab with an arched top
(`border-radius`), an engraved key, and a dashed rust border when buried by cascade. The sign is plywood with two masking-tape corners (`::before`,
`::after`) and painted text in `--font-sign`.

### Motion (`motion.css`)

Animations: REC blink, candle flame flicker, title flicker, tombstone drop (cascade), tombstone shake (rejected exhume), card arrival. All are `transform` or
`opacity`. Under `@media (prefers-reduced-motion: reduce)` they are `none`; the rejected state keeps a thick rust outline and its text.

### Fonts and CSP

Fonts are self-hosted. `styles/fonts.css` is imported from `main.ts` and contains only:

```css
@import '@fontsource/rubik-wet-paint/latin-400.css';
@import '@fontsource/permanent-marker/latin-400.css';
@import '@fontsource/ibm-plex-sans/latin-400.css';
@import '@fontsource/ibm-plex-sans/latin-600.css';
@import '@fontsource/ibm-plex-mono/latin-400.css';
@import '@fontsource/ibm-plex-mono/latin-600.css';
```

Vite resolves the packages, bundles the CSS into the app's one stylesheet and emits the font files with hashed names under `assets/`. Each file set
`font-display: swap`. The packages are exact-version dev dependencies (`5.3.0`). `index.html` has no `<link>` to any other origin, no `preconnect`, no inline
script and no inline style. The four `LICENSE` files are copied once into `public/licenses/` so they ship in `dist/licenses/` (the OFL asks that the licence
travel with the fonts); the README names the licences: Rubik Wet Paint, IBM Plex Sans and IBM Plex Mono are SIL OFL 1.1, Permanent Marker is Apache-2.0.

The policy lives in `build/csp.ts` as an exported constant, so the build plugin and the test read the same string:
`default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'`.
A small Vite plugin (`apply: 'build'`) inserts it as a `<meta http-equiv="Content-Security-Policy">` tag. Because `font-src 'self'` does not allow `data:`,
`build.assetsInlineLimit` is `0` so Vite never inlines a font. Because `style-src 'self'` blocks `style` attributes, script sets styles with the CSSOM
(`element.style.setProperty`, `element.style.transform = …`), which the policy allows; no code calls `setAttribute('style', …)` (the source scan checks).
The dev server does not get the meta tag because Vite's client needs inline script.

## 12. Accessibility design

- **Structure**: `header` (h1, product line, buttons), `main` with `section`s labelled by their headings (h2): "Verdict", "The candle", "Survivors",
  "Inside the safehouse", "Left outside", "Tools". A skip link to the safehouse is the first focusable element.
- **Names**: candle "Freeze time" with `aria-valuetext`; reserve "Reserve" with `aria-valuetext`; survivors `role="switch"` named "Ana, 2 points per half day"
  with `aria-checked`; actions named "Exhume HB-108", "Resurrect HB-110", "Put down HB-110 (Won't Do)"; the sound button `aria-pressed` named "Sound".
- **Live**: the hidden announcer (polite) for verdict + diff; `role="alert"` for a rejected exhume; both written with the same sentences as the screen.
- **Focus ring**: `:focus-visible { outline: 3px solid var(--amber); outline-offset: 2px }` on everything; no `outline: none`.
- **Touch**: buttons and switches at least 44 px high; the candle thumb at least 44 px.
- **Zoom and width**: relative units, wrapping, no horizontal scroll at 360 px or at 200 % text.
- **Decoration**: the `.atmosphere` container, the candle drawing, tape, chain SVG and glow carry `aria-hidden="true"`.
- **Not by colour alone**: kept = "inside" label; zombie = "Zombie" word; fallen = "fell behind" line; rejected = alert text; away = "Away" word.

## 13. Engine addition (Requirement 19)

In `src/engine/types.ts`: `SolvedSolution` gains `buriedEffort: number` and `buriedCod: number`; `Diff` gains `raisedCod: number` and `sunkCod: number`.
`solver.ts` fills the first two from the buried list it already builds; `diff.ts` fills the others from the lists it already builds. Tests (`totals.test.ts`):
`keptEffort + buriedEffort` equals the total effort and `savedCod + buriedCod` the total cod over generated boards; `raisedCod` and `sunkCod` equal the sums of
their entries. The P15 test also asserts `raisedCod − sunkCod = codDelta`. The traceability test is unaffected (no new P number). A dated section in
`docs/rule.md` records it.

## 14. Test design (`tests/ui`)

| File | What it asserts |
|---|---|
| `sample-board.test.ts` | validates; pins the facts of section 3 (capacity 59, 59 of 59, kept and buried lists, impossible at steps 0-2 with needed 15, rejected HB-119 with 63 and 59, put-down HB-112 blocks HB-114, hunger 7 → 11 and 9 → 14, one imported ticket, three must-haves, a chain of three) |
| `candle-steps.test.ts` | eleven steps; strictly increasing instants; labels equal the Madrid local time of each instant; capacities non-decreasing |
| `reducer.test.ts` | each action; ignored inputs return the same reference; rejected exhume keeps the same `board`; put down only for zombies; reset; purity (same input, same output) and no mutation (deep-frozen state); `sound/set` keeps `change` |
| `derive.test.ts` | candle capacity and effective capacity equal the solution's; kept and buried partition the board; chains only between buried tickets; memo returns equal results |
| `text.test.ts` | every sentence template with examples; plural rules; **number provenance**: every integer in each generated sentence is in the set of facts it was built from; `describeValidationError` covers every code |
| `invalid-board.test.ts` | one broken board per validation code renders its sentence with the keys |
| `xss.test.ts` | a title `<img src=x onerror=alert(1)>`, a person name and a key with markup render as text, no `img` element, `alert` not called |
| `imports.test.ts` | `src/ui` and `src/main.ts` import the engine only through `engine/index`; no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, `setAttribute('style', …)`; no `Date.now`, `new Date()` without arguments, `Math.random`; `performance` only in `atmosphere/`; no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, no URL `import()` |
| `csp.test.ts` | the policy in `build/csp.ts` is exactly the string above, has no host, and `default-src` is `'none'`; `index.html`, every CSS file and every UI source have no `http(s)://` host outside comments, no `<link>` to another origin, no `@import url(http…)`, no `preconnect`; the licence files exist in `public/licenses/` |
| `shown-lists.property.test.ts` | random action sequences (candle, reserve, survivors, exhume, resurrect, put down on real and unknown keys, reset) through the real store and a jsdom render; after each action the keys in the safehouse and in the yard equal `solveFreeze` on the current board (computed by the test), partition the tickets, and are empty exactly when the freeze is impossible |
| `render-grounds.test.ts` | cards and tombstones show every field; formula text; reasons; zombie marks and their two actions; non-zombies only "Exhume"; chain text; cascade marks; focus survives a move |
| `render-sign.test.ts` | verdict, change note, alert for a rejected exhume, impossible message with numbers, reserve output and `aria-valuetext` |
| `candle.test.ts` | one dispatch per frame for many inputs; settle after 300 ms announces once with the start-to-end diff; `aria-valuetext`; notches |
| `survivors.test.ts` | switches, `aria-checked`, capacity change |
| `chains.test.ts` | `chainEdges` on the sample board at several steps; redraw requested after changes |
| `sound-events.test.ts` | the mapping of changes to events, including silence for raises, rejects and reset |
| `audio.test.ts` | with a fake context: no context before enabling; off by default; four distinct signatures; one convolver across many plays; durations under 1.6 s; fewer than 40 nodes; master gain at most 0.3; no play when disabled or when the factory fails |
| `a11y.test.ts` | one h1; landmarks; every button and input has an accessible name; no positive tabindex; every decoration is `aria-hidden`; announcer is `aria-live="polite"`; switches have `aria-checked`; reduced motion stops fog and timecode (stubbed `matchMedia`) |
| `slots.test.ts` | each out-of-scope slot exists, says "not built yet", and is disabled or plain text |
| `contrast.test.ts`, `tokens.test.ts` | the allowed pairs meet 4.5:1 or 3:1 as listed; the hex values in `tokens.css` equal the palette in the requirements |

The DOM tests use `// @vitest-environment jsdom`. Layout, real focus rings, reduced motion in a browser, fog performance, fonts and the 360 px width
cannot run in jsdom; they are the manual checklist in the last task, and the final report says which were verified.

## 15. Build and deploy

- `vite.config.ts`: `base: './'`; `build.assetsInlineLimit: 0`; a small plugin adds the CSP meta tag (from `build/csp.ts`) in the build only; `build.target` stays the Vite default. The build report prints
  the gzipped size (budget in Requirement 18.4).
- `.github/workflows/pages.yml`: trigger `push` on `main` and `workflow_dispatch`; `concurrency: { group: pages, cancel-in-progress: false }`; top-level
  `permissions: { contents: read }`. Job `build`: `actions/checkout`, `actions/setup-node` (Node 24, npm cache), `npm ci`, `npm run typecheck`, `npm test`,
  `npm run build`, `actions/upload-pages-artifact` with `path: dist` (no `configure-pages`: the base path is relative). Job `deploy` (needs `build`, `environment: github-pages`) with
  `permissions: { pages: write, id-token: write }` and `actions/deploy-pages`. Every action is pinned to a full commit SHA found at implementation time, with
  the release in a comment. The repository's Pages source must be "GitHub Actions" (a manual setting).
- The URL will be `https://hvaler.github.io/deadline-seance/`.

## 16. Risks and what cannot be verified here

- **No browser in this environment.** Layout, focus rings, motion, fog performance, fonts and real screen-reader output are not checked by the tests. The last
  task gives a manual checklist; the final report will list what was and was not checked.
- **jsdom and `requestAnimationFrame`/`ResizeObserver`/`matchMedia`**: stubbed in tests; the real behavior is in the manual checklist.
- **Font weight on the wire.** Six woff2 files, about 190 kB (Rubik Wet Paint is 76 kB), same-origin and cached; `swap` keeps text visible meanwhile. The app has no network
  request other than its own files.
- **The solver is exponential in the worst case** but takes a few milliseconds on this board; a drag solves once per frame, with a cache.
- **Pages deployment** needs the repository setting and a push; the agent does neither.

## Addendum: visual pass and checkpoint decisions

- **Epitaph.** One line of mood and the cause, a fixed template per reason (`epitaphFor(tombstone)`, no `weeks`). The waiting cost, the releases left out and the hunger are in the stone's details block and its hunger line, from engine facts, so a later language-model epitaph cannot change any number on screen.
- **Grounds.** The kept tickets are rows of one framed shelf; the buried ones are stone slabs (R · I · P, epitaph as the main line, two-column details). From 1100 px the two grounds stack so a shelf row fits on one line and the yard gets four stones across; from 820 to 1099 px they sit side by side.
- **A sign that does not move.** The verdict and the change note share `.sign-readout`, whose `min-height` is the tallest thing they say together (15.5 rem, 21 rem under 820 px, 29 rem under 480 px; measured in a real browser). The candle below stays put while it is dragged.
- **Build.** `base: './'`, `assetsInlineLimit: 0`, and a build-only plugin writes the policy of `build/csp.ts` into `index.html`. `tests/ui/build.test.ts` builds into a temporary folder and checks the result (policy, relative paths, no inline code, no `data:`, fonts and licences, size budget). It needs `@types/node` (dev only; the engine's tsconfig does not load it).
- **Pages.** `.github/workflows/pages.yml`: build job read-only, deploy job alone has `pages: write` and `id-token: write`; every action pinned to a commit. `tests/ui/workflow.test.ts` checks that.
