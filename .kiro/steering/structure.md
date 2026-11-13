# Structure

## Layout

```
deadline-seance/
  .kiro/
    steering/        product.md, tech.md, structure.md
    specs/           Kiro specs (requirements, design, tasks)
    settings/        workspace MCP config
  docs/
    rule.md          design log (Spanish). Later sections override earlier drafts
  src/
    engine/          pure, deterministic rule (no DOM, no clock, no randomness)
    ui/              rendering, interaction, audio, tour
    main.ts          wires the UI to the engine
  tests/
    engine/          property-based tests (fast-check) and the brute-force oracle
    ui/              light tests only where needed
  mcp/               MCP server entry point (feature 8), imports src/engine
  public/            static assets (sample board CSV, fonts if any)
  index.html
  README.md
  LICENSE
```

## src/engine

The single source of truth for every number. Pure functions over plain data.

- Allowed: types, integer math, hashing, parsing and formatting of text built from computed facts.
- Forbidden: DOM, `window`, `fetch`, `Date.now()`, `Math.random()`, file system, any LLM call.
- Inputs include `now` and `freezeAt`. Output is always the same for the same input, regardless of ticket order.

Suggested modules (one concern each):

- `types`: board, ticket, person, absences, results, reasons.
- `capacity`: half-day capacity with IANA time zone and absences.
- `cod`: cost of delay formula, scale, zombie hunger.
- `solver`: branch and bound over dependency closures, margin, tie-breaks, impossible-freeze detection.
- `oracle`: brute-force reference used only by tests.
- `diff`: what rises, what sinks, `cod` change; exhume, resurrect, finish off.
- `fog`: 1,000-night simulation with common random numbers and the margin.
- `chain`: dependency graph, cascade, cycle and unknown-key detection.
- `csv`: Jira CSV import with row-level errors, and export.
- `chronicle`: snapshots of state and undo.
- `facts`: the computed facts handed to epitaphs, change explanations and the certificate.
- `guard`: number guard (every number in generated text must appear in the facts) and fixed templates.
- `certificate`: Markdown death certificate.
- `index`: the public API used by the UI and the MCP server.

## src/ui

Everything the user sees and touches. It calls the engine and displays what it returns. It never computes a decision,
a capacity, a cost or a probability.

- Board view with tombstones and dependency chains, candle (freeze time) and team controls, margin control.
- Messages for impossible freeze and invalid boards, taken verbatim from engine output.
- Epitaphs: optional LLM call, passed through `engine/guard`, with template fallback.
- Chronicle panel with undo, certificate view and export, CSV import and export.
- Guided tour ("Play the night", 60 s with subtitles).
- Web Audio synth (created after a user gesture) and visual effects (glow, VHS, fog) with reduced-motion support.
- The UI passes `now` into the engine; it is the only place that reads the clock.

## tests

- Mirror `src/engine` file by file under `tests/engine`.
- One test per property P1–P27 from `docs/rule.md`, named with its number (for example `P5 optimal vs oracle`).
- Shared generators in `tests/engine/generators.ts`.
- Tests import the engine's public API where possible, internals only when needed.

## Conventions

- Dependencies point one way: `ui` → `engine`; `mcp` → `engine`; `tests` → `engine`. The engine imports nothing from the
  other folders.
- Feature work starts as a Kiro spec under `.kiro/specs/`. Rule changes update `docs/rule.md` first (append a dated
  section, do not rewrite history) and add or adjust a property test.
- File names are lowercase with hyphens or short single words. One exported concern per module.
- Keep `README.md` short and accurate; the design history lives in `docs/rule.md`.
