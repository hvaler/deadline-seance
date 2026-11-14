# Deadline Séance

Freeze-eve scope cutting. A deterministic solver (0/1 knapsack with dependencies and must-haves, value = cost of
delay) decides which tickets to bury before the deadline; property-based tests prove its rules. The LLM never
computes a number: it only writes the epitaphs.

Built with [Kiro](https://kiro.dev) for Kiroween 2026. Work in progress.

## Run it

Node 22.22+ or 24.15+.

```
npm install
npm run dev          # the app, with hot reload
npm test             # all tests (engine, UI, build); about a minute
npm run typecheck
npm run build        # static files in dist/, with a Content Security Policy
npm run preview      # serve dist/ locally
```

Everything runs in the browser: no server, no account, no API key, no request to any other origin.

## What you can try

The app opens on a built-in sample board, "Hollow Bank app 3.2 · release eve": 19 tickets, 4 people, a fixed `now` (Monday 2026-11-16, 09:00, Europe/Madrid) and the freeze on Friday 18:00. Nothing needs importing.

- Move the **candle** (eleven freeze times, Monday 09:00 to Friday 18:00) and the **reserve**: the cut, the totals and a plain sentence of what rose, what sank and what it cost follow at once.
- Send a **survivor** away for a half day and see capacity shrink.
- **Exhume** a tombstone, or **resurrect** or **put down (Won't Do)** a zombie. An exhume that cannot fit is refused and says by how much.
- Read the **fog of estimates** on the sign: in how many of 1,000 simulated nights the kept work still fits the team when every estimate lands between 80 % and 150 % of what was written, for each reserve from 0 to 30 %. On some boards a bigger reserve even lowers the chance, so the strip only shows the numbers.
- Every number on the screen comes from the engine in `src/engine`. The epitaph on a stone only says why the ticket is buried; its cost of waiting, releases left out and hunger are in the stone's details.

Out of scope for now: CSV import and export, the guided tour, the death certificate, the chronicle with undo and the MCP server. Their places on the page are inert, labelled slots.

## Layout

`src/engine` is the rule (pure, deterministic, no DOM); `src/ui` draws it and never decides anything; `tests` mirrors both. The design history is in `docs/rule.md`.

## Fonts

The app makes no network request: its fonts are bundled from the [Fontsource](https://fontsource.org) packages (latin subset, only the weights in use).

| Font | Use | Licence |
|---|---|---|
| Rubik Wet Paint | title | SIL Open Font License 1.1 |
| Permanent Marker | painted signs | Apache License 2.0 |
| IBM Plex Sans | body text | SIL Open Font License 1.1 |
| IBM Plex Mono | numbers | SIL Open Font License 1.1 |

The licence texts ship with the build in `licenses/` (source: `public/licenses/`).

## License

The code is MIT — see [LICENSE](LICENSE). The fonts keep their own licences, listed above.
