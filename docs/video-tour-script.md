# Video tour script: "Play the night"

<!-- Generated. Do not edit by hand. -->

Generated from `src/ui/tour/sample-script.ts` by running it through the app's reducer, so every number below is what the engine returns for the sample board. To change it, change the script and run `npx vitest run tests/ui/tour-script.test.ts -u`; the test fails while this file and the app disagree.

13 scenes, 59.0 seconds, English subtitles, one sentence each, at most 15 characters per second.

## Scenes

| # | Seconds | Shows | The app | Subtitle | Characters | Per second |
|---|---|---|---|---|---|---|
| 1 | 0.0–5.5 | sign | Presses Reset: back to the plain night (Friday 18:00, no reserve, nobody away) | Mon 09:00, freeze Fri 18:00: 59 points, and 7 tickets stay outside. | 67 | 12.2 |
| 2 | 5.5–12.0 | candle | Moves the candle to Wed 18:00 | The candle burns down to Wed 18:00: 35 points, and saved cost of delay falls from 167 to 113. | 93 | 14.3 |
| 3 | 12.0–17.0 | sign | Sends Ana away | Ana is away: 23 points left, and saved cost of delay falls to 79. | 65 | 13.0 |
| 4 | 17.0–21.0 | yard | Rings HB-112 | HB-112, left out 3 releases, climbs from urgency 8 to 13. | 57 | 14.3 |
| 5 | 21.0–26.0 | yard | Puts HB-112 down (Won't Do) | Put down: HB-114 can never ship, and the yard has 13 tickets left. | 66 | 13.2 |
| 6 | 26.0–32.0 | safehouse | Exhumes HB-108, then rings HB-108 | Someone insists on HB-108: it comes in, and saved cost of delay falls to 63. | 76 | 12.7 |
| 7 | 32.0–36.0 | certificate | Opens the death certificate (the note for the stakeholders) | One note for the stakeholders: what is out, and why. | 52 | 13.0 |
| 8 | 36.0–40.5 | fog | Presses Reset: back to the plain night (Friday 18:00, no reserve, nobody away), then sets the reserve to 0 % | 0 % reserve: the cut holds on 0 of 1,000 nights. | 48 | 10.7 |
| 9 | 40.5–44.0 | fog | Sets the reserve to 10 % | 10 % reserve: it holds on 134 of 1,000 nights. | 46 | 13.1 |
| 10 | 44.0–47.5 | fog | Sets the reserve to 15 % | 15 % reserve: it holds on 347 of 1,000 nights. | 46 | 13.1 |
| 11 | 47.5–51.0 | fog | Sets the reserve to 20 % | 20 % reserve: it holds on 707 of 1,000 nights. | 46 | 13.1 |
| 12 | 51.0–54.5 | fog | nothing is pressed | You have to cut more than the arithmetic says. | 46 | 13.1 |
| 13 | 54.5–59.0 | top | nothing is pressed | The rule decides, not the loudest voice: now play your own night. | 65 | 14.4 |

## The fog of the plain night

The numbers of the fog scenes: the cut the rule keeps at each reserve, against the full capacity, over 1,000 simulated nights.

| Reserve | Tickets kept | Points kept | Nights that hold | Shown |
|---|---|---|---|---|
| 0 % | 12 | 59 of 59 | 0 of 1,000 | 0 % |
| 5 % | 11 | 56 of 59 | 6 of 1,000 | 0 % |
| 10 % | 11 | 51 of 59 | 134 of 1,000 | 13 % |
| 15 % | 10 | 49 of 59 | 347 of 1,000 | 34 % |
| 20 % | 10 | 46 of 59 | 707 of 1,000 | 70 % |
| 25 % | 10 | 43 of 59 | 959 of 1,000 | 95 % |
| 30 % | 9 | 41 of 59 | 996 of 1,000 | 99 % |

The percentage is floored, so a few nights can hold and still read 0 %. The video shows the steps 0, 10, 15 and 20 %.

## Recording notes

- Record at 1920 × 1080 in a browser window with the page filling it. The page is a 1,120 px column; the subtitle bar is the same width.
- The tour restores the page to what it was when it ends, and every scene starts from the app's own state, so it can be recorded again and again.
- To start it without a cursor: open the page, change the address to end in `#play` (no reload), then press **Space** (or Enter) when the recording runs.
  `Esc` removes the prompt without starting. The header button "Play the night · 60 s" starts it too.
- To have the app's sounds in the recording: press **Sound on** first, with a click, and then change the address to `#play` without reloading the page.
  The tour never turns sound on by itself and plays no music.
- While it runs, **Pause**, **Skip scene** and **Stop** (or `Esc`) are on the screen at all times. At the end, **Play again** and **Close** appear.
