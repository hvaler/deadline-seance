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

Out of scope for now: the chronicle with undo and the MCP server. Their places on the page are inert, labelled slots.

## Your tickets (Jira CSV)

**Import Jira CSV** (in the tools) lets you try the app with your own tickets. **Download sample CSV** gives you the sample board as a file: change a number, import it back and watch the cut change. The file is read on your computer and goes nowhere: the page makes no request. **Export CSV for Jira** writes the board as it is now (what you exhumed, what you put down, the cut) as a CSV for Jira's importer.

What comes from the file is the tickets. The team, the calendar, the time zone, the release weeks (2), the zombie threshold (3) and the fog seed (0) are the sample's, and a banner says so. The banner also names the release (from the file name; you can edit it: it names the death certificate and the export), and **Back to the sample board** takes you back. The guided tour always plays on the sample board and puts your tickets back when it ends.

**What the file needs.** One row per issue, the header in row 1, comma or semicolon. Headers are matched without regard to case, and `Custom field (X)` counts as `X`:

| Column | Accepted headers (lower case here) |
|---|---|
| Issue key (required) | `issue key`, `key` |
| Summary (required) | `summary` |
| Story Points (required) | `story points`, `story point estimate`, `story point` |
| Value, Urgency, Risk | `value`, `urgency`, `risk` (1, 2, 3, 5, 8, 13 or 20), **or** |
| Cost of Delay | `cost of delay`, `cod` (a whole number): one of the two ways is required, and a row may use either |
| Must Have | `must have`, `must-have` (yes or no) |
| Depends On | `depends on` (keys separated by `;`; may repeat) |
| Blocked by | `inward issue link (blocks)` (Jira repeats it once per link) |
| Blocks | `outward issue link (blocks)` (the other end of the same link) |
| Times Postponed | `times postponed` (how many releases the ticket has been left out) |
| Resolution | `resolution` |

Every other column (`Issue id`, `Status`, `Sprint`, `Labels`, ...) is ignored. A row whose Resolution is `Won't Do` is a ticket that was put down; any other resolution (Done, Duplicate) is a finished issue and is skipped, and links to it are dropped. A link to an issue that is not in the file is an error: the app lists every problem, with its row, column and a sentence, and changes nothing until the file is right. Numbers are whole numbers (`5` and `5.0` are fine, `0.5` is not).

**Limits.** 1 MiB, 2,000 rows, 300 columns and **60 open tickets** (the size at which the cut stays instant; for a bigger project, filter the Jira export by fix version or sprint).

**The export.** Columns `Issue key`, `Summary`, `Story Points`, `Value`, `Urgency`, `Risk`, `Cost of Delay`, `Must Have`, `Depends On`, `Times Postponed`, `Fix Version/s` (the release for what the cut keeps, the next release name you give for the rest) and `Resolution` (`Won't Do` for put-down tickets). It is UTF-8 with commas and no byte order mark, because Jira would read the mark as part of the first header: if you open it in Excel by double-clicking, accents may look wrong (use Data, From Text/CSV, UTF-8). A text that starts with `=`, `+`, `-` or `@` gets an apostrophe in front so that a spreadsheet does not run it as a formula; the importer takes it back, and Jira shows it. [The sample as a CSV](docs/examples/sample-board.csv).
## The death certificate

**Death certificate** (in the tools) opens a note for stakeholders about the night you are looking at: the freeze and the capacity, what is kept and what is left outside, the chance the cut holds on 1,000 simulated nights, and for every ticket left out its reason (does not fit, follows a buried dependency, was pushed out by an exhume, or cannot ship because its dependency was put down), its cost of delay with the formula and what waiting for the next release costs. Then the zombies, the tickets put down, who is away and what was exhumed. **Copy** puts the Markdown on the clipboard (if the browser refuses, the text is shown selected so you can copy it by hand) and **Download .md** saves it as a file. Nothing leaves the page.

Every number in the note is computed by the engine (src/engine/facts.ts) and checked by a deterministic number guard (src/engine/guard.ts): the text is rejected if it says a number, date, time or ticket key that is not one of the facts. The guard proves where a number came from, not that it is the right one, so two real notes are kept as references: [Friday 18:00](docs/examples/death-certificate-friday.md) and [after the tour's actions](docs/examples/death-certificate-tour.md). To regenerate them after a change on purpose: 
px vitest run tests/ui/certificate-golden.test.ts -u.

## Play the night

The button **Play the night · 60 s** runs a 59-second tour of the real app: it presses the app's own controls (the candle, a person away, a zombie put down, an exhume, the reserve) with one subtitle per scene, and every number in a subtitle is what the engine returns at that moment. **Pause**, **Skip scene** and **Stop** (or `Esc`) are on the screen all the time; when it ends, your own state is put back exactly. The page is inert while it plays, and the tour never turns sound on.

To record it: open the page, change the address to end in `#play` (the page shows "Press Space to play the night" and waits), and press **Space** when the recording runs. For the app's sounds, press **Sound on** first. The script of the video, with the real numbers of every scene, is [docs/video-tour-script.md](docs/video-tour-script.md); it is generated from the tour's data and a test fails if it drifts.
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
