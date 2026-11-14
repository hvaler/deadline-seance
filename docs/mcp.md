# The MCP server

Deadline Séance as a tool for an agent. The server answers the same questions as the web app, with the same engine: which tickets survive a freeze, what changes if one thing changes, and the death certificate. It adds no rule of its own.

- **Read-only.** It changes nothing and writes no file.
- **Offline.** It opens no network connection. The board arrives in the request.
- **No clock.** Every time is an input. With the sample board `now` and `freezeAt` have defaults (Monday 2026-11-16 09:00 and Friday 2026-11-20 18:00, Europe/Madrid); with any other board you give both.
- **Every number comes from the engine.** `structuredContent` holds the engine's values; the text block only places them in sentences. Tests check both.

## Start it

```
node mcp/start.mjs
```

It builds `dist-mcp/server.mjs` (one file, the SDK and the engine inside) when a file in `mcp/` or `src/engine/` is newer than the bundle, prints the build's messages to stderr only, and then serves MCP over stdio. It works from any current directory. Needs Node 22 or 24 and `npm install` once.

`npm run mcp:build` builds the bundle and stops. The bundle runs alone: `node dist-mcp/server.mjs`, with no `node_modules`.

## Add it to Kiro

This repository already has the workspace config, `.kiro/settings/mcp.json`:

<!-- generated:config:start -->
```json
{
  "mcpServers": {
    "deadline-seance": {
      "command": "node",
      "args": [
        "mcp/start.mjs"
      ],
      "disabled": false,
      "autoApprove": [
        "solve_freeze",
        "what_if",
        "death_certificate"
      ]
    }
  }
}
```
<!-- generated:config:end -->

Open the workspace in Kiro, and the server `deadline-seance` appears in the MCP Servers panel. The three tools are read-only, so they are approved in advance (`autoApprove`). To use it from another workspace, put the same entry in `~/.kiro/settings/mcp.json` with the absolute path to `mcp/start.mjs` in `args`.

## Add it to another MCP client

Any client that starts a stdio server needs a command and arguments:

```
command: node
args:    ["/absolute/path/to/deadline-seance/mcp/start.mjs"]
```

To look at the tools without a client, use the MCP Inspector: `npx @modelcontextprotocol/inspector node mcp/start.mjs`.

## The three tools

Every tool takes a `board`: `{"source":"sample"}` (the app's sample board), `{"source":"csv","text":"..."}` (Jira CSV text, read by the same importer as the web app, with the same limits and error sentences) or `{"source":"json","board":{...}}` (tickets and people; the zone, release weeks, zombie threshold, put-down keys and fog seed take the engine's defaults). Then:

| Input | Meaning |
|---|---|
| `now`, `freezeAt` | ISO 8601 with a zone (`2026-11-20T18:00:00+01:00`, or `...Z`) or epoch milliseconds. A time with no zone is refused. |
| `marginPct` | Reserve: 0, 5, 10, 15, 20, 25 or 30. Default 0. |
| `away` | `[{ "person": "Ana" }]` takes Ana out of the team for the night; `[{ "person": "Ana", "date": "2026-11-20", "part": "morning" }]` adds one absence (`part` is `morning`, `afternoon` or `full`, default `full`). |

### `solve_freeze`

The cut list: what is kept (points, cost of delay), every ticket outside with its reason (no room, depends on an outside ticket, depends on a put-down ticket), zombies, and the chance, out of 1000 simulated nights, that the kept work fits.

<!-- generated:solve_freeze:start -->
Call `solve_freeze` with:

```json
{
  "board": {
    "source": "sample"
  }
}
```

Answer (the text block; `structuredContent` carries the same values as JSON):

```text
Freeze Fri 2026-11-20 18:00 (Europe/Madrid), asked on Mon 2026-11-16 09:00.
Capacity 59 points, 59 with a 0% reserve.
Kept 12 tickets, 59 points, cost of delay 167.
The night holds on 0 of 1000 simulated nights (0%).
Kept:
- HB-101 "Fix stale balance after a transfer" (5 points, cost of delay 18)
- HB-102 "Strong-auth callback (PSD2)" (8 points, cost of delay 29)
- HB-103 "Store listing and release notes" (2 points, cost of delay 6)
- HB-104 "Biometric login fallback" (5 points, cost of delay 11)
- HB-105 "Dark-mode statement PDF" (3 points, cost of delay 11)
- HB-106 "Card freeze toggle" (5 points, cost of delay 16)
- HB-107 "Card freeze push alerts" (3 points, cost of delay 11)
- HB-109 "Instant-transfer limits screen" (5 points, cost of delay 15)
- HB-113 "Accessibility audit fixes" (5 points, cost of delay 14)
- HB-115 "Phone wallet pass" (8 points, cost of delay 13)
- HB-116 "Balance home-screen widget" (2 points, cost of delay 7)
- HB-118 "Referral programme" (8 points, cost of delay 16)
Outside: 7 tickets, 129 points, cost of delay 101, waiting cost 202.
- HB-119 "Core ledger migration" (48 points, cost of delay 21): no room: it needs 48 points and 0 are left
- HB-112 "Multi-currency wallet" (21 points, cost of delay 16) [zombie]: no room: it needs 21 points and 0 are left
- HB-117 "Onboarding rewrite" (21 points, cost of delay 16): no room: it needs 21 points and 0 are left
- HB-111 "Savings goals" (13 points, cost of delay 14): no room: it needs 13 points and 0 are left
- HB-110 "Spending insights widget" (13 points, cost of delay 13) [zombie]: no room: it needs 13 points and 0 are left
- HB-114 "FX rate alerts" (5 points, cost of delay 11): it depends on HB-112, which is outside
- HB-108 "Transaction search" (8 points, cost of delay 10): no room: it needs 8 points and 0 are left
Zombies: HB-110 and HB-112.
```
<!-- generated:solve_freeze:end -->

### `what_if`

The same inputs and one `change`: `exhume`, `put_down`, `away`, `back`, `move_freeze` or `margin`. The answer has `before`, `after`, what comes in, what goes out, and the cost-of-delay difference. A change that would make the freeze impossible comes back as `rejected` with the numbers of the impossible freeze.

<!-- generated:what_if:start -->
Call `what_if` with:

```json
{
  "board": {
    "source": "sample"
  },
  "change": {
    "kind": "away",
    "person": "Ana",
    "date": "2026-11-20"
  }
}
```

Answer (the text block; `structuredContent` carries the same values as JSON):

```text
What if: Ana away on 2026-11-20 (full).
Before: capacity 59 (59 with a 0% reserve), kept 12 tickets, 59 points, cost of delay 167. The night holds on 0 of 1000 nights (0%).
After: capacity 55 (55 with a 0% reserve), kept 11 tickets, 51 points, cost of delay 154. The night holds on 11 of 1000 nights (1%).
Comes in: nothing.
Goes out: HB-115 "Phone wallet pass" (8 points, cost of delay 13).
Cost of delay kept changes by -13.
```
<!-- generated:what_if:end -->

What it costs to exhume HB-117:

<!-- generated:what_if_exhume:start -->
Call `what_if` with:

```json
{
  "board": {
    "source": "sample"
  },
  "change": {
    "kind": "exhume",
    "key": "HB-117"
  }
}
```

Answer (the text block; `structuredContent` carries the same values as JSON):

```text
What if: exhume HB-117.
Before: capacity 59 (59 with a 0% reserve), kept 12 tickets, 59 points, cost of delay 167. The night holds on 0 of 1000 nights (0%).
After: capacity 59 (59 with a 0% reserve), kept 10 tickets, 59 points, cost of delay 140. The night holds on 1 of 1000 nights (0%).
Comes in: HB-117 "Onboarding rewrite" (21 points, cost of delay 16).
Goes out: HB-113 "Accessibility audit fixes" (5 points, cost of delay 14); HB-115 "Phone wallet pass" (8 points, cost of delay 13); HB-118 "Referral programme" (8 points, cost of delay 16).
Cost of delay kept changes by -27.
```
<!-- generated:what_if_exhume:end -->

### `death_certificate`

The Markdown note for stakeholders, and the verdict of the number guard on it (`guard.ok`, and the offending numbers if there are any). Optional: `release` (a name), `exhumed` and `put_down` (keys applied first, exhumes then put-downs).

<!-- generated:death_certificate:start -->
Call `death_certificate` with:

```json
{
  "board": {
    "source": "sample"
  }
}
```

Answer (the text block; `structuredContent` carries the same values as JSON):

```text
# Death certificate

Release: Hollow Bank app 3.2

Freeze: Fri 2026-11-20 18:00 (Europe/Madrid)

As of: Mon 2026-11-16 09:00, the start time of the board

## The cut

The team has 59 points before the freeze. With a 0 % reserve, 59 points are available.

- Kept inside: 12 tickets, 59 points, saved cost of delay 167.
- Left outside: 7 tickets, 129 points, cost of delay 101.
- Waiting for the next release costs 202 for all of them (cost of delay × 2 weeks).

## Will it hold?

Estimates are simulated between 80 % and 150 % of their value on 1,000 nights, measured against all 59 points of the team.

The cut holds on 0 of 1,000 nights (0 %).

## Left outside

| Key | Title | Points | Cost of delay | Waiting cost (× 2 weeks) | Reason |
|---|---|---:|---|---:|---|
| HB-119 | Core ledger migration | 48 | value 8 + urgency 5 + risk 8 = 21 | 42 | Does not fit: needs 48 points, 0 left. |
| HB-112 | Multi-currency wallet | 21 | value 5 + urgency 2 → 8 + risk 3 = 16 | 32 | Does not fit: needs 21 points, 0 left. |
| HB-117 | Onboarding rewrite | 21 | value 8 + urgency 3 + risk 5 = 16 | 32 | Does not fit: needs 21 points, 0 left. |
| HB-111 | Savings goals | 13 | imported cost of delay 14 | 28 | Does not fit: needs 13 points, 0 left. |
| HB-110 | Spending insights widget | 13 | value 5 + urgency 2 → 5 + risk 3 = 13 | 26 | Does not fit: needs 13 points, 0 left. |
| HB-114 | FX rate alerts | 5 | value 5 + urgency 3 + risk 3 = 11 | 22 | Follows HB-112, which is left outside. |
| HB-108 | Transaction search | 8 | value 5 + urgency 2 + risk 3 = 10 | 20 | Does not fit: needs 8 points, 0 left. |

## Zombies

A ticket is a zombie when leaving it out again makes 3 releases in a row. Its urgency climbs a step on the scale for each release it is left out.

- HB-112, Multi-currency wallet: left out 3 releases; urgency 8 now, 13 if left out again.
- HB-110, Spending insights widget: left out 2 releases; urgency 5 now, 8 if left out again.

## Put down (Won't Do)

None.

## People away

None.

## Exhumed by decision

None.
```
<!-- generated:death_certificate:end -->

## Errors

A mistake is a tool result with `isError: true`, a sentence that says what to fix, and `structuredContent` `{ "errors": [{ "code", "message", ... }] }`. The codes are the engine's (`margin-invalid`, `unknown-key`, `not-a-zombie`, `dependency-cycle`, the CSV codes with their `row`, `column` and `header`, ...) plus the server's own: `bad-time`, `unknown-person`, `bad-request`, `too-large`, `internal-error`. An impossible freeze is not an error: it is an answer with `status: "impossible"`.

## Documentation the design read

The SDK is `@modelcontextprotocol/server` 2.4.0 (stdio, `registerTool` with zod schemas, `outputSchema` and `structuredContent`, tool errors) and `@modelcontextprotocol/client` 2.4.0 for the end-to-end test. The design in `.kiro/specs/mcp-server/design.md` (section 0) lists what was read: the SDK's v2 site, and context7 for the same pages at version 2.4.0.
