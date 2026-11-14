# Requirements: mcp-server
Scope: product feature 8, the rule as an MCP server (`docs/rule.md` §8). The Kiro agent, or any MCP client, asks the same engine the web app uses: which tickets survive a freeze, what changes if one thing changes, and the death certificate. It has four parts:
1. **Tool logic** (`mcp/`, no SDK inside): three pure handlers that turn a request into an answer by calling `src/engine`.
2. **The server** (`mcp/server.ts`): the official SDK over stdio, the tool schemas, the start script and the workspace config for Kiro.
3. **Tests**: handlers against the engine, a real stdio round trip, errors, a fuzz of the input, the dependency direction and the web bundle.
4. **Docs and use**: `docs/mcp.md` (generated from a test) and a real session in Kiro's chat.
Out of scope: writing anything (the server is read-only), Jira or any network call, reading files (the board arrives in the request), prompts and resources (tools only), HTTP transport and authentication, an LLM inside the server, a new rule (the server adds none), changes to the web app's behaviour.
## Introduction
The web app lets a person drag a candle. The server lets an agent ask the same questions in words: "with the sample board, what goes out if Ana is away on Friday?" and "what does it cost to exhume HB-117?". The answer is the engine's answer. The server never decides, computes or estimates anything itself; it translates a request into engine calls and the result into text and structured data.
## Glossary
- **Handler**: a pure function `(input) => ToolResult` in `mcp/`, with no SDK type in its signature. The server registers it.
- **Board source**: how a request names its board: `sample`, `csv` (Jira CSV text) or `json` (a board object).
- **Request state**: the board, `now`, `freezeAt`, the margin and the people away, after defaults are applied. `what_if` builds a second one with one change.
- **Tool error**: a tool result with `isError: true` and an error list. Never a thrown exception, never a protocol error.
- **Golden numbers**: the sample board on Friday 2026-11-20 18:00 Madrid, margin 0, nobody away: 12 tickets kept, 59 points, cost of delay 167, the night holds on 0 of 1,000.
## Requirements
### Requirement 1: The server and how it starts
**User Story:** As a Kiro user, I want the server to start from the workspace with one command and no setup beyond `npm install`.
#### Acceptance Criteria
1. `mcp/server.ts` SHALL serve MCP over stdio using the official TypeScript SDK, with the server name `deadline-seance` and the version of `package.json`.
2. The process SHALL write nothing to stdout except protocol messages. Logs and the ready line SHALL go to stderr.
3. The server SHALL be read-only and offline: it SHALL NOT read or write files, open sockets, spawn processes or read the clock. Every instant in an answer SHALL come from the request or from the sample board's constants.
4. `node mcp/start.mjs` SHALL rebuild the server only when a source file of `mcp/` or `src/engine/` is newer than `dist-mcp/server.mjs`, send everything the build prints to stderr, and SHALL build the server into `dist-mcp/server.mjs` (one file, the SDK and the engine inside) and run it, from any current directory, on Windows, macOS and Linux, with Node 22 or 24.
5. `npm run mcp:build` SHALL produce the same single file, which SHALL run with `node dist-mcp/server.mjs` and no `node_modules`.
6. `.kiro/settings/mcp.json` SHALL declare the server `deadline-seance` with `command: "node"` and `args: ["mcp/start.mjs"]`, and SHALL contain no secret and no absolute path.
7. Each tool SHALL declare `readOnlyHint: true`, `idempotentHint: true` and `openWorldHint: false`.
8. The server SHALL send short `instructions` that say what the three tools do and that every time is an input.
### Requirement 2: Naming the board
**User Story:** As an agent, I want to name the board in three ways so I can ask about the sample, a Jira export or a board I built.
#### Acceptance Criteria
1. Every tool SHALL take `board` as exactly one of `{ source: "sample" }`, `{ source: "csv", text }` or `{ source: "json", board }`.
2. `sample` SHALL be the app's sample board (the same tickets, team and seed as the web app). The sample's data SHALL live in the engine package so that `mcp/` and `ui/` read one copy.
3. `csv` SHALL go through `importCsv` with the sample's team, zone, release weeks and zombie threshold as base, exactly as the web app does. A CSV error SHALL come back as a tool error with the engine's code, the sentence's row and column letter and header, and at most 100 errors.
4. `json` SHALL accept the `Board` shape. Omitted `timeZone`, `nextReleaseWeeks`, `zombieThreshold`, `wontDo` and `fogSeed` SHALL take the engine's defaults. The board SHALL pass `validateBoard`; its errors (`duplicate-key`, `unknown-dependency`, `dependency-cycle`, ...) SHALL come back with their codes and subjects.
5. The size limits SHALL be the CSV import limits (`CSV_LIMITS`: bytes, rows, columns, open tickets, errors) for both `csv` and `json`. A `json` board over the ticket limit SHALL be refused with the code `board-too-large` before the solver runs.
6. The server SHALL cap the number of elements in one call's arguments (`maxToolInputElements`) at a value above the largest legal request.
### Requirement 3: Time, margin and people
**User Story:** As an agent, I want to give times the way people write them and say who is away.
#### Acceptance Criteria
1. `now` and `freezeAt` SHALL each be an ISO 8601 string with an explicit zone (`Z` or `±hh:mm`, optional seconds) or an integer number of epoch milliseconds. A string without a zone, an impossible date (`2026-02-30`), a non-integer, or `freezeAt` before `now` SHALL be a tool error `bad-time` that quotes the value.
2. For the sample board only, `now` SHALL default to the sample's `now` (Monday 2026-11-16 09:00 Madrid) and `freezeAt` to Friday 18:00 Madrid. For `csv` and `json` both SHALL be required.
3. `marginPct` SHALL be an integer from 0 to 30 in steps of 5, default 0. Anything else SHALL be the engine's `margin-invalid`.
4. `away` SHALL be a list of `{ person, date?, part? }`. Without `date`, the person leaves the team for the whole night (as the web app's "send away"). With `date` (`YYYY-MM-DD` in the board's zone) and `part` (`morning`, `afternoon` or `full`, default `full`), one absence is added to that person.
5. A person who is not on the team SHALL be a tool error `unknown-person` that lists the team's names.
### Requirement 4: `solve_freeze`
**User Story:** As an agent, I want the cut list for a freeze, with the reasons.
#### Acceptance Criteria
1. Input: `board`, `now?`, `freezeAt?`, `marginPct?`, `away?`. Output (`structuredContent`, checked against an output schema) and a text rendering of the same values.
2. Output SHALL contain `status` (`ok` or `impossible`), `capacity`, `effectiveCapacity` and `marginPct`.
3. For `ok`: `kept` (key, title, effort, cost of delay), the totals (tickets, points, cost of delay), `outside` (key, title, effort, cost of delay, waiting cost, zombie flag and the **reason**), `zombies` (keys) and `fog` (`nights: 1000`, `holds`, `pct`).
4. A reason SHALL be one of the certificate's four kinds (`no-room`, `depends-on-buried`, `blocked-by-put-down`, `pushed-out-by-exhume`), with the numbers the certificate shows. These SHALL be the engine's `nightFacts` values, not a copy. (`solve_freeze` itself never returns the fourth kind, because a solve request has no exhume; `death_certificate` shows it.)
5. For `impossible` (the must-haves do not fit): the status, the points needed, the capacity, and the blocked must-haves. It is a result, not an error.
6. With the sample board and no other input the answer SHALL be the golden numbers.
7. Shuffling the tickets of a `json` board or the rows of a `csv` SHALL not change the answer (same as the engine's order independence).
### Requirement 5: `what_if`
**User Story:** As an agent, I want to try one change and see what comes in, what goes out and what it costs.
#### Acceptance Criteria
1. Input: the same as `solve_freeze` plus `change`, exactly one of: `{ kind: "exhume", key }`, `{ kind: "put_down", key }`, `{ kind: "away", person, date?, part? }`, `{ kind: "back", person }` (undo an entry of `away`), `{ kind: "move_freeze", freezeAt }`, `{ kind: "margin", marginPct }`.
2. Output SHALL contain `before` and `after` (each with status, capacity, kept count, points, cost of delay and the fog chance), `comes_in` and `goes_out` (key, title, effort, cost of delay each), and `cod_delta` (after minus before).
3. `exhume` and `put_down` SHALL call the engine's `exhume` and `putDown`. An exhume the freeze cannot take SHALL answer `rejected: true` with the numbers of the impossible freeze (needed points, capacity). It is a result, not an error.
4. `put_down` of a ticket that is not a buried zombie SHALL be the tool error `not-a-zombie`; an unknown key SHALL be `unknown-key`, both with the key.
5. The other changes SHALL re-solve the changed request state with `solveFreeze` and compare with `diffSolutions`. A change that makes the freeze impossible SHALL say so with the numbers.
6. A change that changes nothing SHALL return empty `comes_in` and `goes_out` and `cod_delta: 0`.
7. `what_if` SHALL NOT change anything outside the call: two identical calls return identical answers.
### Requirement 6: `death_certificate`
**User Story:** As an agent, I want the note for stakeholders for a given night.
#### Acceptance Criteria
1. Input: the same as `solve_freeze` plus optional `release` (a name, at most 60 characters; default the sample's name for `sample`, none otherwise) and optional `exhumed` and `put_down` key lists applied before writing.
2. Output SHALL contain `markdown` (from `deathCertificate`) and `guard` (`ok` and, if not, the offending numbers, from `guardCertificate`).
3. For the sample board and no other input, `markdown` SHALL equal what the web app's certificate view shows for the same state.
### Requirement 7: Errors are results
**User Story:** As an agent, I want a mistake to tell me how to fix it, and never to lose the server.
#### Acceptance Criteria
1. Every failure of a handler SHALL be a tool error: `isError: true`, a text sentence that names the problem and the fix, and `structuredContent` `{ errors: [{ code, message, ... }] }`.
2. Codes SHALL be the engine's own (`EngineErrorCode`, `ValidationErrorCode`, `CsvErrorCode`) plus these of the server: `bad-time`, `unknown-person`, `bad-request`, `too-large`.
3. Arguments that fail the input schema SHALL be answered by the SDK as an `isError` result. The server SHALL not crash on any input: a handler that throws SHALL be caught and answered as `internal-error` with no stack trace and no file path.
4. The error list of a CSV SHALL keep the engine's order and its cap of 100.
### Requirement 8: Every number comes from the engine
**User Story:** As the owner of the product rule, I want no number in a tool answer that the engine did not produce.
#### Acceptance Criteria
1. `mcp/` SHALL contain no arithmetic on tickets, capacity, cost, effort, margin or probability, other than adding up fields of engine results that the engine does not already total, and SHALL NOT repeat the rule (no solver, no formula, no table).
2. `structuredContent` of each tool SHALL equal, field by field, what the engine returns when called directly with the same request (tests compare them).
3. Every integer in the text of `solve_freeze` and `what_if` SHALL appear in its `structuredContent`; every number in `markdown` SHALL pass `guardCertificate`. A test SHALL check both for the golden calls and for generated boards.
### Requirement 9: Dependencies, purity and the web bundle
**User Story:** As the maintainer, I want the server to stay a thin edge and the web app to stay the same.
#### Acceptance Criteria
1. `mcp/` SHALL import from the repository only `src/engine/index`. It SHALL NOT import `src/ui`, `src/main.ts`, `tests` or `build`. `src/engine` and `src/ui` SHALL NOT import `mcp/`.
2. The handler files SHALL contain no `Date.now`, `new Date()` with no arguments, `Math.random`, `fetch`, `process`, `require`, `node:` import or file-system word. Only `server.ts` and `start.mjs` MAY touch the SDK, and only `start.mjs` MAY import Node modules.
3. The web build (`dist/`) SHALL not contain the SDK, zod, or any text from `mcp/`; its size budget SHALL be unchanged.
4. The SDK packages and `zod` SHALL be pinned exactly, each released at least 14 days before it is added. Nothing else SHALL be added except a justified test client. All SHALL be `devDependencies`, because the server ships as a bundle and the web app has no runtime dependency (`tests/ui/csp.test.ts` stays as it is).
5. The engine's public API list in `tests/engine/purity.test.ts` MAY change only by the sample board's exports, on purpose.
6. `tsconfig.mcp.json` SHALL type-check `mcp/` and `tests/mcp/` in strict mode, and `npm run typecheck` SHALL run it.
### Requirement 10: Tests
**User Story:** As a judge or maintainer, I want evidence that the server answers what the engine says.
#### Acceptance Criteria
1. Handler tests SHALL call each handler in-process on the sample board and compare with direct engine calls, including the golden numbers (12 kept, 59 points, cost of delay 167, holds on 0 of 1,000).
2. One end-to-end test SHALL spawn the real server over stdio with the SDK client, list the tools (three, with schemas), and call each tool once.
3. Invalid inputs SHALL return structured errors and never throw: a bad CSV (row and column in the sentence), an unknown key, a dependency cycle, a time with no zone, a board over the limits, an unknown person, an exhume that makes the freeze impossible (a result), a put-down of a ticket that is not a zombie.
4. A fuzz test (fast-check) SHALL send arbitrary JSON to each handler and to the schema, and SHALL see only results.
5. A test SHALL check that identical requests give identical answers and that a shuffled board gives the same answer.
6. A test SHALL check that `dist/` built from `src/main.ts` holds no MCP code, and that the bundle of the server runs with no `node_modules`.
7. Existing tests SHALL stay green; `npm run typecheck`, `npm test` and `npm run build` SHALL pass.
### Requirement 11: `docs/mcp.md`
**User Story:** As a viewer of the demo video, I want to see how to connect and what a call returns.
#### Acceptance Criteria
1. `docs/mcp.md` SHALL say how to add the server to Kiro (workspace config, with the file's content), how to add it to another MCP client, and how to test it with the Inspector.
2. For each tool it SHALL show one example call and its answer. These blocks SHALL be generated by a test from real handler calls; the test SHALL fail when the file differs, and `UPDATE_MCP_DOCS=1` SHALL rewrite it.
3. It SHALL state that the server is read-only, offline and clock-free, and which SDK documentation the design read.
4. `README.md` SHALL get a short "MCP server" section that links to it.
### Requirement 12: The rule document
**User Story:** As the owner of the rule, I want `docs/rule.md` to say what the server promises before the code does.
#### Acceptance Criteria
1. A dated section SHALL be appended to `docs/rule.md` (Spanish, never rewriting history) with: the three tools and their inputs, the defaults of the sample, the time-input rule, the meaning of `away` with and without a date, the error codes, and that the server adds no rule.
2. The section SHALL be written before the code (task 1).
### Requirement 13: Use from Kiro
**User Story:** As the author of the video, I want proof that Kiro's agent uses the server.
#### Acceptance Criteria
1. After the implementation, the server SHALL be used from Kiro's own chat on this workspace with two questions: "With the sample board, what goes out if Ana is away on Friday?" and "What does it cost to exhume HB-117?".
2. The report SHALL list, for each question, the tool called, its arguments, and the answer, and compare the numbers with the engine called directly.
3. If Kiro cannot call the server in this session, the report SHALL say so, say what was tried, and SHALL NOT present a test client's answer as Kiro's.
## Traceability
| Requirement | Where it is checked |
|---|---|
| 1 | `tests/mcp/e2e.test.ts` (start, stdout clean, tools list), `tests/mcp/config.test.ts` (mcp.json, annotations) |
| 2 | `tests/mcp/board.test.ts` |
| 3 | `tests/mcp/input.test.ts` |
| 4 | `tests/mcp/solve-freeze.test.ts` |
| 5 | `tests/mcp/what-if.test.ts` |
| 6 | `tests/mcp/death-certificate.test.ts` |
| 7 | `tests/mcp/errors.test.ts`, `tests/mcp/fuzz.test.ts` |
| 8 | `tests/mcp/provenance.test.ts` |
| 9 | `tests/mcp/imports.test.ts`, `tests/mcp/bundle.test.ts`, `tests/engine/purity.test.ts` |
| 10 | all of `tests/mcp/` |
| 11 | `tests/mcp/docs.test.ts` |
| 12 | `tests/engine/traceability.test.ts` (the dated section exists) |
| 13 | the final report |
