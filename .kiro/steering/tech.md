# Tech

## Stack

- Static web app. Vite + TypeScript (strict mode). No backend, no server-side code, no accounts.
- Everything runs in the browser: solver, simulation, CSV parsing, certificate generation. Deployable to any static host.
- UI framework: keep it minimal (vanilla TypeScript or a very small library). Do not add a heavy framework without a
  clear need.
- Tests: Vitest as runner, fast-check for property-based tests.
- Audio: Web Audio API only (synthesized synth bass and effects). No audio files, no third-party music. One short
  convolution reverb is allowed, with an impulse response generated in code, shared by the eerie per-action sounds.
  Each action has its own distinct sound: resurrect, put down, bury and cascade.
- Optional LLM: called only for epitaphs and change explanations, behind a deterministic number guard with a fixed
  template fallback. The app must be fully usable with no API key and no network.
- MCP server (feature 8): a small Node entry point that imports the same engine package as the web app. No duplicated
  rule logic.

## Performance: must run smoothly on a low-end PC

- Keep the bundle small: few dependencies, no large assets, lazy-load anything optional (tour, audio, MCP-only code).
- Solve a board of up to about 80 tickets fast enough to react while dragging the candle. Use branch and bound over
  dependency closures; run heavy work off the main thread (Web Worker) if it ever blocks the UI.
- The 1,000-night simulation must be cheap: integer arithmetic, a fast integer hash, no per-night allocations in hot
  loops.
- Visual effects (glow, VHS noise, fog) use CSS and light canvas work. Respect `prefers-reduced-motion`, avoid layout
  thrash, keep animations on `transform` and `opacity`, and cap frame cost.
- Audio is created only after a user gesture and is cheap to run (few oscillators). The single convolution reverb uses a
  short generated impulse, is created once and reused; no other convolution.

## Engine rules (determinism)

- All quantities are integers. No floating point in decisions. Use `floor` and `ceil` on integers or integer math with
  explicit scaling (percentages as integers, `floor(capacity × (100 − m) / 100)`).
- `now` and `freezeAt` are inputs. The engine never calls `Date.now()`, `new Date()` without arguments, or
  `Math.random()`.
- Time zones use IANA names (default `Europe/Madrid`) so daylight saving changes do not break capacity.
- The simulation derives randomness from a hash of `(board seed, ticket key, night number)`. No seeded global RNG state.
- The same board with tickets in a different order must give exactly the same result.
- Tie-break order: fewer buried tickets, then less buried effort, then alphabetical buried keys.

## Testing

- Property-based tests (fast-check) for every rule property P1–P27 in `docs/rule.md` (later sections override earlier
  drafts). Each property is its own test.
- A brute-force oracle (all subsets, boards of 12 tickets or fewer) must always agree with the solver on saved `cod`.
- Generators: random acyclic boards of 0–12 tickets for the oracle and up to 80 for the rest.
- Example-based tests only for fixed things: sample board, CSV error messages, certificate wording.
- Anything that shows a number to the user must be computed by the engine, never in the UI.

## Conventions

- ES modules, strict TypeScript, no `any` in the engine.
- The engine has no DOM, no Node-only APIs and no browser APIs, so it runs in the browser, Vitest and the MCP server.
- Pin dependency versions exactly. Prefer few, well-known packages.
- License: MIT.
- Commands (once the project is scaffolded): `npm run dev`, `npm run build`, `npm test`.
