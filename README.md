# Deadline Séance

Freeze-eve scope cutting. A deterministic solver (0/1 knapsack with dependencies and must-haves, value = cost of
delay) decides which tickets to bury before the deadline; property-based tests prove its rules. The LLM never
computes a number: it only writes the epitaphs.

Built with [Kiro](https://kiro.dev) for Kiroween 2026. Work in progress.

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
