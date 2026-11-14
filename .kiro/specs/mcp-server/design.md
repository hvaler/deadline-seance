# Design: mcp-server
Read `requirements.md` first. This file says how each requirement is met, and lists the decisions that are mine to propose and yours to confirm.
## 0. Documentation read
**First pass (2026-11-14, context7 not yet configured).** I read the same pages directly: npm registry metadata (`@modelcontextprotocol/sdk`, `/server`, `/client`), the SDK's v2 site (`ts.sdk.modelcontextprotocol.io/v2/`: home, "Serve over stdio", "Tools", "Errors", "Connect to a server", the upgrade guide), and the v1 README from the registry.
**Second pass, with context7** (library `/modelcontextprotocol/typescript-sdk`, version `v2.4.0`, three queries): the client (`Client`, `StdioClientTransport` from `@modelcontextprotocol/client/stdio`, `callTool`, `close()` in a `finally`), `registerTool` with zod `inputSchema` and `outputSchema` plus `structuredContent`, tool errors (`isError: true`, thrown errors become the same shape), `serveStdio(factory)` and "log with `console.error`", and `McpServer` options (`maxToolInputElements`). Result: **nothing in the design changed.** Two details the second pass or the installed type files added, now used by the code:
- `instructions` is a server option (`ServerOptions`, in the installed `.d.mts`), passed as the second constructor argument next to `maxToolInputElements`.
- The docs say "the wire encoding of structured results differs by protocol era". The end-to-end test uses the SDK's default (legacy-era) client and finds `structuredContent` in the result; the raw stdio test (`bundle.test.ts`) does the same on protocol `2025-06-18`. A modern-era client was not tried.
What I did not read: the MCP specification text, the "Test a server" page (`InMemoryTransport`), and the Inspector beyond its one command on the stdio page.
What the docs established (and the design relies on):
- `new McpServer({ name, version }, { instructions, maxToolInputElements })`, `server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, handler)`, with a zod object as the only schema. The SDK validates the arguments before the handler and the `structuredContent` against `outputSchema` before the reply.
- A bad argument comes back as `{ isError: true, content: [text] }`. A thrown error in a handler becomes the same shape. The SDK skips `outputSchema` validation on any `isError` result.
- `serveStdio(() => server)` from `@modelcontextprotocol/server/stdio` owns the transport. stdout is the protocol channel, so any `console.log` breaks it; use `console.error`.
- The client side: `Client` from `@modelcontextprotocol/client` and `StdioClientTransport({ command, args, cwd, stderr })`; `callTool`, `listTools`.## 1. Decisions to confirm in review
| # | Decision | Why | If you disagree |
|---|---|---|---|
| D1 | **SDK v2**: `@modelcontextprotocol/server` **2.4.0** (released 2026-10-23, 22 days ago) and, for the end-to-end test only, `@modelcontextprotocol/client` **2.4.0**. | v2 is the current stable release (2026-07-27); v1 is the maintenance line. The server package has two dependencies (`zod`, `@modelcontextprotocol/core`) against about a dozen for v1 (express, hono, jose, ajv, ...), which matters for a bundle that must run on a low-end PC and be easy to read. Both packages are the same date, so 2.4.0 passes the two-week rule on 2026-11-07. | v1 **1.32.2** (2026-10-23), one package `@modelcontextprotocol/sdk`, `McpServer` + `StdioServerTransport` imports. The handlers do not change; only `server.ts` and the e2e test do. |
| D2 | **`zod`** is added as a direct dev dependency, pinned to the newest 4.x released at least 14 days ago (looked up in task 1). | The SDK takes zod objects as schemas and `mcp/` must import it to write them; relying on a transitive copy breaks as soon as the SDK moves. It is the only extra package, and it is already inside the SDK. | None; the SDK needs it. |
| D3 | **Bundle to one `.mjs` with Vite's JS API** (`vite build` in SSR mode, no new package), no Node type stripping. | Node can strip types, but the engine imports `./solver` without an extension, so Node would refuse it. Rewriting 20 engine imports to add `.ts` for the server's sake would touch every file for no gain. Vite is already installed and bundles the engine, the SDK and zod into `dist-mcp/server.mjs`, which then needs no `node_modules`. | `tsx` as a runtime (one more package, and it loads TypeScript on every start), or add extensions to the engine. |
| D4 | **Start with `node mcp/start.mjs`**, not `npm run`. `start.mjs` rebuilds `dist-mcp/server.mjs` **only when a `.ts`/`.mjs` file in `mcp/` or `src/engine/` (or `package.json`) is newer than the bundle**, sends everything the build says to stderr, and then imports the bundle. | `npm run` prints its banner to **stdout**, which would corrupt the protocol; `node` is always found, and the script finds its own folder, so the current directory does not matter. Measured here: **cold start (no bundle) about 0.30 s, warm start about 0.08 s** to the first protocol answer. | Config `npm --silent run mcp`, or a prebuilt bundle in git. |
| D5 | **All new packages are `devDependencies`.** | The server runs from a bundle, so nothing is needed at run time; and `csp.test.ts` (no runtime dependencies, all pinned) keeps passing unchanged. | Put them in `dependencies` and change that test on purpose. |
| D6 | **The sample board moves to `src/engine/sample.ts`** (`sampleBoard`, `SAMPLE_NOW`, `SAMPLE_RELEASE`, `SAMPLE_FREEZE_AT` = Fri 18:00), and `src/ui/sample-board.ts` re-exports it and keeps `PRODUCT_LINE`. | `mcp/` may import only the engine, and the sample lives in `ui/`. Duplicating it would make two samples that can drift. It is plain data, which the engine already holds (`DEFAULT_*`). The public API list in `purity.test.ts` grows by those names on purpose. | Duplicate it in `mcp/` with a test that compares it to the UI's (a UI import in a test is allowed). More code, same result. |
| D7 | **Times**: ISO 8601 with `Z` or `±hh:mm`, or integer epoch ms. Parsed in `mcp/time.ts` with a strict pattern and `Date.UTC` on the numbers, never `Date.parse`, never the clock. | Agents write ISO strings; the engine takes epoch ms. A string with no zone is ambiguous (the very DST problem the engine avoids), so it is refused with the sentence that says what to add. | Accept a zone-less string as the board's zone (needs local-to-instant arithmetic the engine has no function for). |
| D8 | **`away` with no date removes the person for the night; with a date it adds one absence.** | The first is what the web app's "send away" does. The second answers "Ana is away on Friday", which the web app cannot say but `Person.daysOff` can. Both call existing data structures; no new rule. | Only the first (the user's example would need a date workaround). |
| D9 | **Output has two forms of the same values**: `structuredContent` (checked by `outputSchema`) and a text block rendered from it. | Agents read the text; programs read the structure. One source means the text cannot disagree. | Text only. |
| D10 | **What proves "every number comes from the engine"**: (a) `structuredContent` equals the engine's direct result; (b) every integer in the text is in the structure; (c) the certificate goes through `guardCertificate`. No new guard module. | The engine's `guard` checks text against `NightFacts`. Solve and what-if texts are mine, so (b) is a small test helper, not a rule. | Build a `NightFacts`-style guard for the three answers (more machinery for the same check). |
| D11 | **Errors**: tool errors with `structuredContent: { errors: [{ code, message, ... }] }`; engine codes pass through; the server's own are `bad-time`, `unknown-person`, `bad-request`, `too-large`, `internal-error`. | The brief asks for the engine's codes. The SDK skips `outputSchema` on errors, so the error shape does not need to be a union. | One output schema as a union of ok and error. |
| D12 | **`what_if` changes**: exhume, put_down, away, back, move_freeze, margin. | The brief's list. `back` undoes an `away` of the same request, because the server has no memory between calls. | Drop `back` (it is only meaningful if the request already sent someone away). |
| D13 | **Limits**: `CSV_LIMITS` for `csv` and `json`; `maxToolInputElements` at 20,000. | One set of limits, the ones the solver was measured at (60 open tickets). | Separate limits for JSON. |
| D14 | **No P number for the server's properties.** `docs/rule.md` lists P1 to P27 for the rule; the server adds none. Its tests are named `MCP:` plus the sentence. | `tech.md` ties P1 to P27 to rule properties. Mixing server behaviour into that list would blur it. | P28 to P31. |
| D15 | **`docs/mcp.md` is generated by a test** between marker comments; the prose around it is by hand. | Numbers never drift: the test fails if the file differs, `UPDATE_MCP_DOCS=1` rewrites it. | A script outside the test run (it would not be in `npm test`). |
## 2. Files
```
src/engine/
  messages.ts       NEW   describeCsvError, describeValidationError, listOf, thousands (moved from ui/text.ts, D16)
  sample.ts          NEW   sampleBoard(), SAMPLE_NOW, SAMPLE_RELEASE, SAMPLE_FREEZE_AT (moved from ui, data only)
  index.ts           EDIT  exports them
src/ui/
  sample-board.ts    EDIT  re-exports from the engine; keeps PRODUCT_LINE
mcp/
  server.ts          NEW   McpServer, registerTool x3, serveStdio (the only file that imports the SDK)
  start.mjs          NEW   builds dist-mcp/server.mjs with Vite's API (silent), then imports it
  vite.config.ts     NEW   SSR build, one file, noExternal, target node22
  tools.ts           NEW   the three tools' names, titles, descriptions and handlers, and the server instructions (no SDK type)
  schemas.ts         NEW   the zod input and output schemas and `parseWith` (the only handler file that imports zod)
  run.ts             NEW   `run`: parse, run the body, turn a throw into `internal-error`
  request.ts         NEW   board source, time, margin, away -> a RequestState or a list of errors
  solve-freeze.ts    NEW   handler 1
  what-if.ts         NEW   handler 2
  certificate.ts     NEW   handler 3
  render.ts          NEW   structured value -> text (formatting only)
  errors.ts          NEW   ToolError, the server's codes, conversion from engine errors
  time.ts            NEW   strict ISO 8601 with zone and epoch ms
tsconfig.mcp.json    NEW   includes mcp, tests/mcp; lib ES2022; types node
.kiro/settings/mcp.json NEW
.gitignore           EDIT  dist-mcp/
package.json         EDIT  devDependencies, scripts mcp:build and mcp, typecheck runs tsconfig.mcp.json
tests/mcp/           NEW   see section 8
docs/mcp.md          NEW   generated examples
docs/rule.md         EDIT  dated section (task 1)
README.md            EDIT  short section
```
The only file where the SDK appears is `server.ts`. Handlers take plain objects and return plain objects, so they test without a transport and survive an SDK change.
## 2b. What the implementation added to the decisions
| # | Decision | Why |
|---|---|---|
| D16 | **`describeCsvError`, `describeValidationError`, `listOf` and `thousands` moved from `src/ui/text.ts` to `src/engine/messages.ts`** (the UI re-exports them). | The brief asks for the same CSV error sentences as the app, and `mcp/` may not import the UI. Moving them keeps one copy, and the engine already allows formatting of text built from computed facts. Their tests did not change. The engine's public API list grows by these four names on purpose. |
| D17 | **`.kiro/settings/mcp.json` auto-approves the three tools.** | They are read-only and offline, so the agent does not stop to ask for each call in the demo. Remove `autoApprove` to be asked. |
| D18 | **`solve_freeze` never says `pushed-out-by-exhume`.** | That reason needs a board with an exhume, and a solve request has none (an exhume is a `what_if` change or a `death_certificate` option). The output schema allows the four kinds; the certificate shows the fourth. |
| D19 | **The `back` change only undoes an `away` of the same request.** | No memory between calls (D12). |
## 3. Request state (`request.ts`)
`resolveRequest(input) => Result<RequestState, ToolError[]>`:
1. **Board.** `sample` calls `sampleBoard()`. `csv` calls `importCsv(text, base)` with `base` taken from `sampleBoard()` (people, zone, weeks, threshold) and seed `DEFAULT_FOG_SEED`, exactly like the web app. `json` fills the defaults and calls `validateBoard`. The text and ticket limits are the engine's (`CSV_LIMITS`); for `json` the handler first counts tickets and refuses with `board-too-large` so that `validateBoard` and the solver never see a huge board.
2. **Time.** `parseInstant(value)` accepts `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$` or a safe integer. It builds the instant with `Date.UTC(y, m - 1, d, h, mi, s, ms)` minus the offset, then checks the calendar by reading the fields back (so `2026-02-30` fails). For the sample, `now` and `freezeAt` default to `SAMPLE_NOW` and `SAMPLE_FREEZE_AT`; otherwise both are required. `freezeAt < now` is `bad-time`.
3. **Margin** goes to the engine as is; the engine says `margin-invalid`.
4. **Away.** Entries without `date` are removed from `board.people` and their names go to `NightInput.away`. Entries with `date` append `{ date, part }` to that person's `daysOff`, and the board goes through `validateBoard` again (so a bad date is the engine's `invalid-absence`). An unknown name is `unknown-person`.
`RequestState = { home: ValidBoard, board: ValidBoard, freeze: FreezeInput, away: string[], release: string | null }`, which is exactly `NightInput`. The handlers pass it to `nightFacts`, so the certificate and the facts use the same object.
## 4. The tools
Each tool: a zod input schema, a zod output schema, a title, a description that gives one example and the sample's defaults, and the three annotations.
### `solve_freeze`
`resolveRequest` then `nightFacts(state)`. The output is `NightFacts` reshaped (renamed fields, no new numbers): `status`, `capacity`, `effectiveCapacity`, `marginPct`, `kept` (rows from the board and `solveFreeze`), `totals`, `outside` with `reason` (copied from `OutsideFact.reason`), `zombies`, `fog { nights, holds, pct }`. For `impossible`: `needed`, `blockedMustHaves`. The golden call is tested against the engine's numbers: 12 kept, 59 points, cod 167, 0 holds.
### `what_if`
`before = solve(state)`; `after` by change:
| change | after |
|---|---|
| `exhume` | `exhume(board, freeze, key)`: `applied` gives `after` and `diff`; `rejected` gives `rejected: true` with the impossible solution's `needed` and `capacity` |
| `put_down` | `putDown(board, freeze, key)` (errors `not-a-zombie`, `unknown-key` pass through) |
| `away`, `back` | a second `RequestState` with the `away` list changed, `solveFreeze`, `diffSolutions` |
| `move_freeze` | the same state with a new `freezeAt` (checked by `parseInstant`) |
| `margin` | the same state with a new `marginPct` |
Each side also gets `fog` from `simulateFog(board, kept, capacity)` (the same call the facts use). The "cost" of an exhume, in the user's words, is `goes_out` (what sinks, with its cost of delay) and `cod_delta`.
### `death_certificate`
`resolveRequest`, apply `exhumed` and `put_down` with the engine's `exhume` and `putDown` in the order given (`home` stays the loaded board, as in the web app), `nightFacts`, `deathCertificate`, `guardCertificate`. Output `{ markdown, guard }`. The text block is the markdown itself.
## 5. Text (`render.ts`)
Plain sentences from the structured values: "Friday 2026-11-20 18:00 Europe/Madrid. Capacity 59 points. Kept 12 tickets, 59 points, cost of delay 167. The night holds on 0 of 1,000 simulated nights." The local time comes from `NightFacts.freeze` (the engine's stamp), not from my own date code. No number is computed here; the function only places values. The 1,000 separator is a formatting of an engine integer, and the provenance test accepts a number with or without it.
## 6. Server (`server.ts`) and start
```ts
serveStdio(() => {
  const server = new McpServer({ name: 'deadline-seance', version }, { instructions, maxToolInputElements: 20_000 });
  registerTools(server);   // 3 x server.registerTool(name, config, (args) => toResult(handler(args)))
  return server;
});
```
`toResult` wraps each handler in `try/catch`; a throw becomes `internal-error` with a fixed sentence. `version` comes from `package.json` through a Vite `define` at build time (no file read at run time). `console.error('deadline-seance MCP ready')` on start.
`mcp/start.mjs` calls Vite's `build` with `configFile: mcp/vite.config.ts`, `logLevel: 'silent'`, output `dist-mcp/server.mjs`, and then `import()`s it. Any build error goes to stderr and exits 1.
`.kiro/settings/mcp.json`:
```json
{ "mcpServers": { "deadline-seance": { "command": "node", "args": ["mcp/start.mjs"], "disabled": false } } }
```
Relative to the workspace root, which is where Kiro starts workspace servers; the real-use task confirms it, and if Kiro starts from another folder the fix is `args: ["${workspaceFolder}/mcp/start.mjs"]`.
## 7. Dependency direction and coverage of `mcp/`
`tests/mcp/imports.test.ts` reads every file of `mcp/` as text (the same `import.meta.glob` method as `purity.test.ts`) and checks: relative imports are only `../src/engine/index` or siblings; no `ui`, `tests`, `build`; SDK and zod only in `server.ts` (zod also in `tools.ts`); no `node:` import outside `start.mjs`; no forbidden word of the engine's purity list in the handlers. `tests/ui/imports.test.ts` gains: nothing under `src/` imports `mcp/`. `tests/mcp/bundle.test.ts` builds the web app's entry into a temp folder with Vite's API (as `build.test.ts` does for the CSP) and greps for `modelcontextprotocol`, `zod` and `deadline-seance MCP`; it also builds the server bundle, checks it has no `import` of a bare package, and runs it from an empty temp folder (no `node_modules` above it).
## 8. Tests
| File | What |
|---|---|
| `solve-freeze.test.ts` | golden numbers; every reason kind (fixtures from the certificate tests); impossible; margin; away with and without date; equals `nightFacts` and `solveFreeze` called directly |
| `what-if.test.ts` | each change; exhume of HB-117 on the sample (numbers from the engine); a rejected exhume with the numbers; `put_down` errors; no-op change; `move_freeze` and `margin` equal a direct re-solve |
| `death-certificate.test.ts` | equals `deathCertificate(nightFacts(...))` and the web view's text; the guard verdict; `exhumed` and `put_down` |
| `board.test.ts` | sample; CSV from `docs/examples/sample-board.csv` gives the sample's tickets; CSV errors keep row, column and cap; JSON defaults; cycle, unknown dependency, duplicate key; limits |
| `input.test.ts` | the time forms (valid, no zone, `2026-02-30`, `+24:00`, epoch, float), `freezeAt < now`, margin, `away` forms, unknown person |
| `errors.test.ts` | each code of the server's own, never a throw, no stack or path in a message |
| `provenance.test.ts` | for the golden calls and for generated boards (`arbSolveCase` from `tests/engine/generators.ts`): structure equals engine; text integers are in the structure; the certificate passes the guard |
| `fuzz.test.ts` | arbitrary JSON, arbitrary strings as CSV, arbitrary times, to each handler and to the zod schemas: only results |
| `order.test.ts` | a shuffled `json` board and a shuffled CSV give the same answer; two identical calls are identical |
| `e2e.test.ts` | spawns `node mcp/start.mjs` with `StdioClientTransport`, lists three tools with input and output schemas and annotations, calls each, checks stdout carried only protocol (the client would fail to parse otherwise), closes |
| `imports.test.ts`, `bundle.test.ts`, `config.test.ts` | section 7; `mcp.json` content and no absolute path or secret |
| `docs.test.ts` | the generated blocks of `docs/mcp.md` |
| mutation checks | one at a time, on a copy: a handler that adds 1 to a total; a reason copied wrong; `away` with no date ignored; a time with no zone accepted; a thrown error left uncaught; a UI import in `mcp/`. Each must be caught by a named test |
The e2e test is the slowest (a build, a spawn); it has a 60 s timeout and builds once for the file.
## 9. Risks
- **Kiro may not pick the server up in this session.** The IDE reads `mcp.json` on start or when the file changes; the agent that is writing this may not see new tools until you reconnect. The real-use task says what happened, and gives you the exact clicks if it needs your hands. A test client's answer is labelled as one.
- **Build time at start.** Vite plus the SDK may take over a second on a slow disk; Kiro has a startup timeout. Measured in task 8, with the staleness check as the fallback (D4).
- **SDK v2 is new** (under four months old). Pinned exactly; the e2e test fails loudly if a patch changes the wire shape. D1 offers v1.
- **A `zod` major or SDK change** does not reach the handlers, which use plain objects.
- **`maxToolInputElements`** counts array elements and object members; a CSV is one string, so size is limited by `CSV_LIMITS` and the transport's 4 MiB body limit, not by that option.
## 10. What I did not decide for you
- Where the server's answers are in English: tool text is English (the agent's language is the user's, the rule document is Spanish). If you want Spanish tool text, it is one file (`render.ts`).
- Whether `docs/mcp.md` is Spanish or English: I propose English like `README.md`.
