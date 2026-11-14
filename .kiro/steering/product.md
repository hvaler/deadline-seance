# Product

## What it is

Deadline Séance helps a team decide, the night before a freeze, which tickets to cut. The board is a haunted shelter:
tickets that make it are kept inside, tickets that don't are buried under tombstones with an epitaph. The visual genre
is 80s B-movie horror mixed with post-apocalypse survival (red glowing title, VHS, synth bass, plank shelter, painted
signs, tape). Genre only: no Thriller, no The Walking Dead (no music, names, logos or imagery).

## Who it's for

Engineering leads, product managers and scrum masters who have to cut scope before a release freeze, plus the
stakeholders who need to understand what was left out and why. Hackathon judges must be able to try it with no setup.

## Principles (non-negotiable)

- Every number (capacity, value, cost, the cut list, the survival probability) comes from deterministic code covered by
  property-based tests.
- The LLM only explains decisions (epitaphs, change explanations). It never chooses or computes.
- Any LLM text passes a deterministic number guard: every number in it must appear in the facts it was given. If not,
  the text is discarded and a fixed template is used. With no API key, the template is always used, so the demo works
  the same.
- The judge can try it without credentials: sample board built in, CSV import/export.

## The decision rule, in plain words

Pick the set of tickets to keep so that:

1. The effort fits the team's capacity (after the safety margin).
2. Every must-have is kept.
3. If a ticket is kept, everything it depends on (the whole chain) is kept too.
4. The total cost of delay of what is kept is as large as possible.

Everything not kept is buried. Burying a ticket delays it to the next release, so burying costs `cod × weeks`; since the
delay is the same for all tickets, minimizing buried cost is the same as maximizing saved `cod`.

Ties are broken in this order: bury fewer tickets, then bury less effort, then alphabetical order of the buried keys. The
same board always gives the same tombstones.

Pure optimum is the chosen policy. More capacity never lowers the saved `cod`, but it can change which tickets are kept
(for example, one ticket worth 30 beats two worth 22 together). When that happens the rule computes what rises, what
sinks and the `cod` change, and the screen says it with those numbers.

Cost of delay is a visible formula: `cod = value + urgency + risk`, each on the scale 1, 2, 3, 5, 8, 13, 20. A CSV with
only a `cod` column is used as is and flagged as "imported cost of delay".

Capacity is counted in half days (morning 09:00–13:00, afternoon 14:00–18:00, Mon–Fri, board time zone, default
`Europe/Madrid`). A half day counts if its midpoint (11:00 or 16:00) falls in `now ≤ midpoint < freezeAt`. All values
are integers. `now` is always an input, never the system clock.

Exhume: exhuming a tombstone makes that ticket a must-have and the rule re-solves. The screen shows what gets buried in
exchange (the diff between the previous and the new solution). If exhuming would make the freeze impossible, the screen
says so with the computed numbers and the exhumation is not applied. Property P10: the exhumed ticket is kept and the
saved `cod` never rises.

Rule outcomes the app must state out loud, without the LLM:

- Impossible freeze: the must-haves plus their dependencies exceed capacity. The message gives the computed numbers and
  suggests moving the candle or dropping a must-have.
- Bad board on load (dependency cycle, unknown key, invalid CSV row): rejected, saying which one and which row.

## Approved features (version 2)

Priority: 1, 2, 4 and 5 score most. If time runs short, cut 8 first, then 6, then 3.

1. Dependency chains: chains drawn between tombstones; when a dependency is buried, its dependents fall behind it in a
   cascade.
2. Fog of estimates: probability that the shelter holds when estimates are wrong, plus a capacity margin (0–30 %, steps
   of 5). Simulation of 1,000 nights with common random numbers per ticket, fully deterministic and integer-only.
3. The zombie is hungry: urgency climbs one step on the scale for every release the ticket has been left out. A ticket
   that would be left out again at 3 or more consecutive releases (threshold is board data) is a zombie and can be
   resurrected (same as exhuming) or finished off (closed as Won't Do and removed from the board).
4. Death certificate: a Markdown note for stakeholders on what is left out and why (freeze, capacity and margin, what
   is kept, survival probability, per buried ticket the reason, `cod` with its formula and cost of waiting, zombies,
   finished-off tickets). It passes the same number guard as epitaphs.
5. Guided tour: "Play the night", 60 automatic seconds with subtitles. It is also the script of the demo video.
6. Night chronicle: a log of every decision with its effect ("Ana leaves → HB-109 out (−15)") and step-by-step undo.
7. Jira CSV import: try it with your own data, no credentials. Export a CSV for Jira import too.
8. The rule as an MCP server: a `deadline-seance` tool the Kiro agent can query (`solve_freeze`, `what_if`), using the
   same engine package as the web app.

## Non-goals

- No multiplayer or voting.
- No Jira API with credentials; it never writes to Jira (CSV in, CSV and a stakeholder note out).
- No AI chat that decides.
- It does not estimate effort or cost; those come from the person or from Jira.
- No backend and no accounts.
- The rule never reads the system clock.
- Promising that more margin always raises the survival probability. It does not, and the UI must not imply it.

## Demo message

On the sample board, the optimal cut on paper is fragile: with the candle on Friday 18:00 the rule fills 59 of 59 points
and the shelter holds in 0 of 1,000 nights (0 %). The real curve, computed by the engine (seed 20261116, estimates
between 80 % and 150 %, measured against the full capacity of 59 points):

| Reserve | 0 % | 5 % | 10 % | 15 % | 20 % | 25 % | 30 % |
|---|---|---|---|---|---|---|---|
| Kept tickets / points | 12 / 59 | 11 / 56 | 11 / 51 | 10 / 49 | 10 / 46 | 10 / 43 | 9 / 41 |
| Nights that hold (of 1,000) | 0 | 6 | 134 | 347 | 707 | 959 | 996 |
| Chance shown | 0 % | 0 % | 13 % | 34 % | 70 % | 95 % | 99 % |

The percentage is floored, so 5 % reads 0 % although 6 nights hold: the screen always gives the count too. You have to cut
more than the arithmetic says: filling the capacity exactly never holds, and it takes a reserve of about 20 % before the
shelter holds on most nights. These numbers belong to this board and this seed (other seeds move each step by a few points:
for 20 seeds, 10 % gave 9 to 12 %, 15 % gave 29 to 33 %, 20 % gave 67 to 72 %). On other boards a bigger reserve can even
lower the chance; the strip shows the numbers and the app never says that more reserve is safer. The prototype's
0 / 20 / 81 / 100 came from its fake board and are not used.
