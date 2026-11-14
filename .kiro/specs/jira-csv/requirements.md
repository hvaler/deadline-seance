# Requirements: jira-csv

Scope: product feature 7, Jira CSV. A person imports a Jira CSV export to try the app with their own tickets (no credentials, nothing leaves the browser),
and exports a CSV they can import back into Jira (`docs/rule.md` §7 "CSV de importación (formato)", P13 and P26). It has four parts:

1. **Engine** (`src/engine/csv.ts`, pure): an RFC 4180 reader and writer, the import of tickets with every error as data, and the export.
2. **UI**: in the tools, "Import Jira CSV" (file picker and drop zone), "Download sample CSV" and "Export CSV for Jira"; a banner while your tickets are loaded; an announced list of errors.
3. **The tour** on an imported board.
4. **Performance** (the plan B deferred by the `fog` spec): the fog is computed when the candle settles, because 80-ticket boards need it.

Out of scope: any Jira API or credentials, writing to Jira, the chronicle, the MCP server, other file formats (XLSX, JSON), editing tickets inside the app, importing the team, the calendar or the time zone.

## Introduction

The judge can try the sample board with no setup. This spec lets them try their own: they download the sample as a CSV (or use a real Jira export), edit it, import it, and the same rule runs on their tickets: the cut, the fog, the certificate.
What is imported is **tickets only**. The board takes the app's current team, calendar, time zone, release weeks and zombie threshold, and the default fog seed, and the screen says so.

## Glossary

- **Record**: one row of the CSV as a spreadsheet shows it (a quoted cell can hold line breaks, so a record is not a line). The header is **row 1**; blank records count, so a row number is the one the user sees.
- **Column letter**: A, B, ..., Z, AA, ... as a spreadsheet names columns. An error names the row, the letter and the header text of the file.
- **Open ticket**: a row with no resolution. **Closed row**: a row whose Resolution is not "Won't Do"; it is already finished, so it is skipped. **Put-down row**: Resolution "Won't Do"; its key goes to `wontDo`.
- **Imported board**: the board built from a file: the file's tickets plus the built-in board's team, time zone, release weeks, zombie threshold, and `DEFAULT_FOG_SEED` (0).
- **Built-in board**: the board the app was mounted with (the sample).

## Requirements

### Requirement 1: Reading CSV text

**User Story:** As a user with a file from Jira or from Excel, I want the file read the way my spreadsheet reads it.

#### Acceptance Criteria

1. `parseCsv(text)` SHALL be a pure function that follows RFC 4180: fields separated by a delimiter, records by CRLF or LF (a lone CR also ends a record), a field in double quotes may hold the delimiter, line breaks and `""` for a quote; a quote inside an unquoted field is kept as text. A UTF-8 byte order mark at the start of the text is removed.
2. THE delimiter SHALL be a comma or a semicolon, chosen from the header record (the one that occurs more times outside quotes; a tie is a comma). A first line `sep=;` (the hint Excel writes) sets the delimiter and is not a row.
3. `parseCsv` SHALL return `{ delimiter, records }` or an error value; it SHALL never throw, for any string (fuzz test). An unterminated quote is the error `unterminated-quote`, naming the row where the quote opened.
4. A record with only empty fields (a blank line) SHALL be kept as a record, so row numbers stay true, and ignored as data.
5. `serializeCsv(records, delimiter)` SHALL be the writer: it quotes a field that holds the delimiter, a quote, CR or LF, doubles its quotes, and ends every record with CRLF. `parseCsv(serializeCsv(r, d))` gives `r` back for any records `r` and either delimiter (property test), except that a lone surrogate is written as U+FFFD (Requirement 6.5).
6. NO dependency SHALL be added: the reader and the writer are written for this, in `csv.ts` (split into `csv-text.ts` only if the file grows past about 700 lines, and the design says so).

### Requirement 2: Which columns, under which names

**User Story:** As a user of Jira Cloud or Server, I want my export to be understood without renaming columns.

#### Acceptance Criteria

1. HEADERS SHALL be matched case-insensitively, after trimming and collapsing spaces. A header of the form `Custom field (X)` matches as `X`. The accepted names are:

   | Meaning | Required | Accepted headers (besides `Custom field (...)` of each) |
   |---|---|---|
   | Key | yes | `Issue key`, `Key` |
   | Title | yes | `Summary` |
   | Points | yes | `Story Points`, `Story point estimate`, `Story point` |
   | Value, Urgency, Risk | one of the two groups | `Value`, `Urgency`, `Risk` |
   | Cost of Delay | one of the two groups | `Cost of Delay`, `CoD` |
   | Must have | no | `Must Have`, `Must-Have` |
   | Depends on | no | `Depends On` (may repeat) |
   | Blocked by | no | `Inward issue link (Blocks)` (repeats once per link) |
   | Blocks | no | `Outward issue link (Blocks)` (repeats): the inverse, so the issue named in the cell depends on this one |
   | Times postponed | no | `Times Postponed` |
   | Resolution | no | `Resolution` |

   Every other column (`Issue id`, `Status`, `Sprint`, `Labels`, `Description`, ...) SHALL be ignored, whatever it holds and however often it repeats.
2. A column that may repeat (Depends On, Blocked by, Blocks) SHALL be merged: the keys of every copy are one list. A column that may not repeat (Key, Summary, Points, Value, Urgency, Risk, Cost of Delay, Must Have, Times Postponed, Resolution) and appears twice is the error `duplicate-column`, naming both letters.
3. THE required columns SHALL be Key, Summary, Points, and either Cost of Delay or all three of Value, Urgency and Risk. A missing one is the error `missing-column` naming the header it expected, and with a row of `null` (it belongs to the file, not to a row). A file may have both cost groups: each row then uses the one it fills (Requirement 3.5).
4. A cell in a **dependency** column SHALL be split at `;`, `,` and white space; empty parts are dropped; repeated keys count once. The documented form is `;`.
5. THE accepted-header table SHALL be written once, in `csv.ts` as data, used by the importer, and printed in the README and in the design; a test compares the three.

### Requirement 3: Import, and every error as data

**User Story:** As a user whose file has mistakes, I want to be told all of them, with their place, and nothing to change on the board until the file is right.

#### Acceptance Criteria

1. `importCsv(text, base)` SHALL return `Result<{ board, tickets, putDown, skipped, warnings }, CsvError[]>`. `base` is the built-in board's data (team, time zone, release weeks, zombie threshold). The board is `{ ...base, tickets, wontDo, fogSeed: DEFAULT_FOG_SEED }` and has passed `validateBoard`. It SHALL never throw (fuzz) and never change `base`.
2. EACH error SHALL be a value `{ code, row, column, value?, keys?, limit? }`: `row` is the spreadsheet row or `null` for the whole file; `column` is `{ index, letter, header }` or `null`. All errors are collected and sorted by row (the whole-file ones first), then column, then code, then value; at most **100** are returned, with the total in a final `too-many-errors` entry.
3. THE codes SHALL be: `empty-file`, `no-tickets` (a header and no data), `unterminated-quote`, `missing-column`, `duplicate-column`, `missing-value` (an empty Key, Summary, Points, or part of a cost), `bad-key` (a key with white space, `,` or `;`, or longer than 100 characters), `too-long` (a Summary over 1,000 characters), `not-integer` (`2.5`, `1,5`, `abc`, an exponent, a number beyond the safe range), `negative-number`, `off-scale` (Value, Urgency or Risk not in 1, 2, 3, 5, 8, 13, 20), `cost-incomplete` (some but not all of Value, Urgency, Risk), `cost-both` (a Cost of Delay and the three parts on the same row), `cost-missing` (neither), `bad-flag` (Must Have not yes/no, true/false, y/n, 1/0, or empty, in any case), `duplicate-key`, `unknown-dependency` (the row and column of the cell, and the key), `self-dependency`, `dependency-cycle` (the keys in the cycle, and the row of the smallest key), `too-many-rows`, `too-many-tickets`, `too-many-columns`, `file-too-large`, `board-too-large` (the engine's own refusal), `too-many-errors`.
4. AN ERROR SHALL always name a row that exists in the file, or `null`; a property test over arbitrary strings checks that every `row` is at most the number of records and every column index is inside the header.
5. THE cost of a row SHALL be: `Cost of Delay` only, giving an imported cost of delay (shown as such on screen); or all three of Value, Urgency and Risk, giving the formula `cod = value + urgency + risk` (with the hunger of the rule). Rows of one file may differ. `Times Postponed` (empty = 0) is `past`.
6. A Must Have of `yes` SHALL make the ticket a must-have; empty is no.
7. **Closed rows.** A row whose Resolution is non-empty and is not "Won't Do" (any case, `'` or `’`) is already finished: it SHALL be skipped, not read for errors beyond its key, and a dependency on its key SHALL be dropped (it no longer blocks anything). The number skipped, and how many of each resolution, are returned in `skipped`.
8. **Put-down rows.** A row with Resolution "Won't Do" SHALL put its key in `wontDo` and make no ticket on the board; its other cells are not required, and what they hold is kept: `Imported.putDownTickets` has the ticket (title, points, cost, must-have, links, past) read leniently (a missing or wrong cell takes a plain default and is not an error), so that the export can write the row back. A ticket that depends on it can never be kept (the rule's own behaviour).
9. **Dependencies.** The merged keys of Depends On, Blocked by and Blocks (inverted) make `dependsOn`. A key that is not an open ticket, a put-down row or a closed row is `unknown-dependency`, with the row and column where it was written. Links to issues outside the file are therefore errors: the user removes them or adds the issue. (A cell with a key outside the file is common in real exports; the sentence says what to do.)
10. **Limits**, named constants in `csv.ts`, each with its own error that says the limit: file **1,048,576 bytes** (checked on the file's size before reading, and on the text length after), **2,000** records, **300** columns, **60 open tickets** (chosen after review from the measurements of Requirement 11; the error says to filter the Jira export by fix version or sprint), 100 errors.
11. A file with replacement characters (U+FFFD: not UTF-8, as Excel's plain "CSV" is) SHALL import, with a warning `replacement-characters`. Warnings never block.
12. ROW ORDER SHALL not change the result: shuffling the data rows gives the same tickets and the same solution for any candle (property test on valid files).

### Requirement 4: Export

**User Story:** As a lead, I want a CSV of my tickets that Jira's importer can read and that this app can read back.

#### Acceptance Criteria

1. `exportCsv(input)` SHALL be a pure function: `{ board, home, kept, release, nextRelease }` to a string (comma delimiter, CRLF, UTF-8 text with **no** byte order mark, because Jira's importer reads a mark as part of the first header). `board` is the current board (exhumes and put-downs applied); `home` gives the titles of put-down tickets; `kept` is the keys kept by the current cut, or `null` when the freeze is impossible.
2. THE columns SHALL be, in this order: `Issue key`, `Summary`, `Story Points`, `Value`, `Urgency`, `Risk`, `Cost of Delay`, `Must Have`, `Depends On`, `Times Postponed`, `Fix Version/s`, `Resolution`. A formula ticket fills Value, Urgency and Risk (the ticket's own urgency, not the hunger) and leaves Cost of Delay empty; an imported cost does the reverse. `Must Have` is `yes` or `no`; `Depends On` joins the keys with `;`.
3. ONE ROW per open ticket, in the board's order, then one per put-down key (sorted) with `Resolution` = `Won't Do` and every other column filled from the ticket's data: from `home` (a ticket put down with the button) or from `closed` (a ticket a file closed); with no data at all, its key as the title. An exhumed ticket is exported as `Must Have` = `yes` (the file says what the board is, not its history).
4. `Fix Version/s` SHALL be the release name for a kept ticket and the next release name for a ticket left outside; empty for every row when `kept` is `null`, and for put-down rows.
5. **Spreadsheet formulas.** A text cell (Issue key, Summary, Depends On, Fix Version/s) that starts with `=`, `+`, `-`, `@`, tab or CR, possibly after apostrophes, SHALL get one leading apostrophe. The importer SHALL remove **one** leading apostrophe from a text cell exactly when what follows is a run of apostrophes and then one of those characters. So a title `'=x` is written `''=x` and read back as `'=x`. A title that starts with `-` and is opened in a spreadsheet shows the apostrophe in Jira; the README says so.
6. A lone surrogate in any text SHALL be written as U+FFFD, so that the string the function returns is what any file holds. The fog seed, the team and the calendar are not in the file.
7. P13 and P26 (Requirement 5) SHALL hold: export then import gives the same board.

### Requirement 5: Properties and examples

**User Story:** As the maintainer, I want the round trip proven, and the importer shown to hold up against a real export.

#### Acceptance Criteria

1. **P13 (CSV round trip)**: over generated boards of 0 to 80 tickets (formula and imported costs, must-haves, dependencies, put-down keys, `past`), `importCsv(exportCsv(board), base)` gives the same tickets, `wontDo` and costs; the board's team, zone, weeks and threshold are `base`'s and its seed is 0, so the comparison fixes those. `canonicalBoard` of `tests/engine/generators.ts` is the comparison.
2. **P26 (import round trip with hostile content)**: the same, over titles with quotes, commas, semicolons, line breaks (LF, CR, CRLF), a leading `=`, `+`, `-`, `@`, tab and `'`, emoji, accents, and lone surrogates (compared after the writer's U+FFFD), with the file written with a comma and again with a semicolon.
3. THE parser SHALL never throw on any string; an error always names a row that exists (Requirement 3.4); a file with the rows shuffled gives the same solution (Requirement 3.12).
4. EXAMPLE TESTS SHALL read a hand-written realistic Jira Cloud export (`tests/engine/fixtures/jira-cloud-export.csv`): a byte order mark, the real header names (`Summary`, `Issue key`, `Issue id`, `Issue Type`, `Status`, `Priority`, `Resolution`, `Created`, two `Sprint`, two `Labels`, `Custom field (Story point estimate)`, `Custom field (Value)`, `Custom field (Urgency)`, `Custom field (Risk)`, several `Inward issue link (Blocks)`, `Outward issue link (Blocks)`), a done issue, a "Won't Do" issue, a link to the done issue, and cells with commas, quotes and line breaks. The test names the exact board it gives. A second fixture with semicolons and `sep=;` and a third with one mistake of every code check the errors, their rows, their letters and their order.
5. BOTH properties SHALL be added to the traceability test (`P13` and `P26` in `csv.test.ts`).
6. MUTATION CHECKS, one at a time and reverted, each caught by a named test: the delimiter detection always picks a comma; the reader drops a doubled quote; the row number ignores a line break inside quotes; an inward link is read as outward; the apostrophe is not stripped; a closed row is not skipped; the cost-both check is removed.

### Requirement 6: The tools

**User Story:** As a judge, I want to import a file, edit the sample and import it back, with the keyboard or a mouse.

#### Acceptance Criteria

1. THE tools SHALL replace the disabled "CSV import and export" slot with a group "Your tickets", with: **Import Jira CSV** (a button that opens the file picker, `accept=".csv,text/csv"`), a **drop zone** ("or drop a .csv file here"), **Download sample CSV**, and **Export CSV for Jira** with a labelled text field **Next release name** (default "Next release", at most 60 characters, blank means the default). The button and the field are native controls of at least 44 px.
2. THE file SHALL be read locally: its size is checked first (over 1,048,576 bytes is the error `file-too-large`, and it is not read), then it is read through an injected `Services.reader` (the browser's `File.text()`), never uploaded. The page makes no request (`connect-src 'none'` stays and `imports.test.ts` keeps its bans).
3. DROPPING a file SHALL do the same as choosing it. The drop zone is decoration for the mouse (`aria-hidden`), the button is the keyboard and screen-reader route. A file dropped outside the zone SHALL not navigate the page away (the document prevents the default of a file drag).
4. THE tools SHALL offer **Download sample CSV**: the built-in board exported with its starting cut, named `deadline-seance-sample.csv`; importing it back SHALL give the sample's tickets (a test and the real browser).
5. **Export CSV for Jira** SHALL export the board as it is now (exhumes, put-downs, the current cut for `Fix Version/s`), named `deadline-seance-tickets.csv`; the release name is the current release, or "Current release" when there is none. The status line says "Download started." and, when the freeze is impossible, that `Fix Version/s` is empty and why.
6. THE downloads SHALL use `Services.files.save` of the death-certificate spec with `text/csv;charset=utf-8`, under the existing policy (checked in a real browser).
7. THE import part SHALL not run while the tour plays (the page is inert).

### Requirement 7: After an import

**User Story:** As a user, I want to see at a glance that I am on my own tickets, and get back to the sample.

#### Acceptance Criteria

1. ON SUCCESS the board SHALL be replaced through one reducer action (`board/load`), and the candle, the reserve, who is away, exhumes and put-downs SHALL go back to the starting state of the new board (Friday 18:00, no reserve, nobody away). `sound` stays.
2. A banner (a labelled region, no `h2`, at the top of the page content) SHALL say **"Your tickets from <file name>: N tickets. Team and calendar are the sample's."** and, in a second sentence, what else is the sample's: "Release weeks and the zombie threshold too; the fog uses seed 0." (N is the number of open tickets; the weeks, the threshold and the seed are the board's own numbers.) It also says how many closed issues were skipped, and the replacement-character warning, when they apply. It has the buttons **Back to the sample board** and, for the certificate and the export, a labelled field **Release name**.
3. THE release name SHALL default to the file name without its extension, with runs of `_` and white space turned into one space, at most 60 characters (`jira-q4_freeze.csv` gives `jira-q4 freeze`); the user may edit it in the banner. It names the death certificate and the current `Fix Version/s`. A blank field means no release line in the certificate.
4. THE state SHALL hold it: `AppState` gains `builtIn` (the board and release the app started with), `source` (`built-in`, or `file` with the name, the number skipped and the warnings) and `release`. `board/sample` loads `builtIn` again; `board/reset` resets to the **loaded** board (so after an import it keeps your tickets); `release/set` renames. The reducer's old actions behave as before on the built-in board.
5. THE Reset button SHALL say "Reset the sample board" on the built-in board and "Reset your tickets" on an imported one. The product line of the title card says "<release> · your tickets" for an imported board.
6. THE change note after an import SHALL say "Loaded your tickets from <file name>." with the count, and the comparison with the earlier cut is **no comparison** (the boards differ; `no-diff`), even when keys coincide with the sample's (a downloaded and edited sample has the same keys). The same holds for `board/sample`.
7. THE announcer SHALL say the note after an import; the focus SHALL move to the banner (a labelled region with `tabindex="-1"`) and the page SHALL scroll it into view through `Services.page.reveal`, because the button the user pressed is at the bottom of the page.
8. A sound: none. An import is not one of the four events of the app.

### Requirement 8: When the file has errors

**User Story:** As a user, I want the problems listed where I pressed the button, announced, and my board left alone.

#### Acceptance Criteria

1. WITH ANY error, the store SHALL not be dispatched to: the board, the candle and everything else stay exactly as they were (test: the very same state object).
2. THE errors SHALL be shown in a region in the tools, under the import controls, with `role="alert"` (announced at once), a heading "The file was not imported", and an ordered list with one sentence each, in the order of Requirement 3.2: "Row 7, column E (Story Points): must be a whole number (got 2.5)." Whole-file errors read "The file: ...". The region takes the focus, so a keyboard user lands on it.
3. EVERY sentence SHALL be built only from the error's own fields: the row, the letter, the header, the value, the keys and the limit; no arithmetic. A provenance test checks that every number in a sentence is one of those fields.
4. WHEN there are more than 100 errors the last line says how many more there are. The list is plain text (`textContent`); a file name or a cell with markup is shown as text.
5. THE region SHALL go away on the next import attempt, on a successful import, on reset and on "Back to the sample board". It does not hide a good board that is already loaded.
6. THE size limit error needs no reading; a file that is not text (binary) is read as it is and fails with ordinary errors (a missing column), without crashing.

### Requirement 9: The tour on an imported board

**User Story:** As the author of the video, I want the tour to keep working, and as a user I do not want to lose my tickets to it.

#### Acceptance Criteria

1. THE tour SHALL always play on the sample: the two scenes that began with `board/reset` begin with `board/sample` (which loads the built-in board whatever is loaded). On the sample board the result is identical, so every caption, the generated `docs/video-tour-script.md` (its wording of those two actions changes) and the 59.0 s total stay.
2. WHEN the tour ends or stops, the user's own state SHALL come back exactly (the very same object), including an imported board, its file name, its release and its banner.
3. THE `#play` prompt SHALL say, when a file is loaded, "The tour plays on the sample board. Your tickets come back when it ends." The header button's label does not change.
4. WHEN the tour starts the import errors region and the certificate view SHALL be closed.

### Requirement 10: Screen, keyboard, 320 px, styles

**User Story:** As a user on a phone or with a screen reader, I want the same quality as the rest of the app.

#### Acceptance Criteria

1. EVERY control SHALL be a native element with a visible name, at least 44 px high; the hidden file input is reached through the visible button, with the name "Import Jira CSV" for assistive technology; the drop zone is `aria-hidden`.
2. THE page SHALL have no horizontal scroll at 1280, 360 and 320 px with the banner, the import controls and an error list of 100 sentences; long file names and long cells wrap (`overflow-wrap`).
3. STYLES SHALL use palette tokens only, no new hex colour, no pixel font under 16 px, no animation other than `transform` and `opacity` (the drop zone's "over" state changes a border colour and background through a class, with no transition); `tokens.test.ts`, `contrast.test.ts`, `build.test.ts` and the policy test keep passing; the gzipped JS plus CSS stays under 60 kB.
4. THE banner and the error region SHALL not change the heights the earlier specs fixed (the sign, the fog block): they sit above `main`'s first region and in the tools, and the candle region's top moves only by the banner's own height, once, when it appears.

### Requirement 11: Performance, and plan B of the fog

**User Story:** As a user with an 80-ticket board, I want the candle to follow my finger.

#### Acceptance Criteria

1. THE measurements (design section 9, made before this spec was written, on the development machine) are: an 80-ticket board solves in a median of 1 to 3 ms; a cached curve (seven solves and seven passes over the table) takes a median of 14 ms on a normal board and 21 ms on a tie-heavy one, more than the 8 ms gate of the `fog` spec; the worst single solve of a tie-heavy 80-ticket board is 40 to 207 ms with dependencies (two samples) and 813 ms without dependencies (at 60 tickets the worst was 32 ms). The task that implements this requirement repeats them on the built board and in a real browser, and reports them.
2. THEREFORE **plan B SHALL be implemented**: for a board of more than 30 tickets (a named constant, `FOG_ON_SETTLE_FROM`), while a candle gesture is active, `derive` SHALL not compute a curve that is not cached; the sign keeps the last curve it had for that board and marks it `data-stale="true"` with the visible text "updating" next to the figure; when the gesture settles (the existing 300 ms settle, through the injected timers) the curve is computed and shown. The sample board (19 tickets) behaves exactly as before; no "updating" ever appears on it.
3. A gesture SHALL tell the app when it starts and when it settles (`ctx.gestureActive(on)`), through the two gestures (candle and reserve), and the app SHALL render again on the settle so the figure fills in. The reserve slider needs no curve (it moves the highlight), so its gesture only matters for the flag.
4. THE stale mark SHALL not be spoken: the announcement after a settled change is the same as today. The headline and the strip keep their stable heights (the mark takes the room of the sentence's second line).
5. THE solve of the cut itself SHALL stay synchronous (one solve per frame at most, as today). The limit of 80 tickets is the one tested; the worst measured solve (tie-heavy boards with no dependencies, 813 ms) is reported to you as a known tail, and the design offers the alternative limit of 60 (worst 32 ms).
6. A REAL-BROWSER TRACE of dragging the candle on a generated 80-ticket board, at normal speed and with the CPU slowed 4 times, SHALL be reported, with and without plan B in the same build (a switch in the test build only), as the fog spec did.

### Requirement 12: Nothing existing gets worse

**User Story:** As the maintainer, I want the rest of the project untouched except where the feature needs a hook.

#### Acceptance Criteria

1. ALL existing tests SHALL stay green. The ones that change are changed on purpose and listed in the design: `purity.test.ts` (the API list and the new file), `traceability.test.ts` (P13, P26), `slots.test.ts` (the CSV slot is gone), `reducer.test.ts` and `arbitraries.ts` (new state fields and actions), `text.test.ts` (new notes), `tour-script.test.ts`, `tour-player.test.ts` and `render-tour.test.ts` (`board/sample`), `certificate-view.test.ts` (the release comes from the state), `a11y.test.ts`, `harness.ts` (a recording file reader).
2. THE engine SHALL stay free of the DOM, the clock, randomness and the Node globals of `purity.test.ts`, not even in strings (no `document`, `window`, `process`, `performance`, `crypto`, `fetch`, `navigator`, `require`). The solver, the diff, the fog and the certificate do not change.
3. `npm run typecheck`, `npm test` and `npm run build` SHALL pass; no new dependency; `connect-src 'none'` and the whole policy stay.
4. `nightInputOf` takes the release from the state; `MountOptions.release` becomes the built-in release.

### Requirement 13: Real-browser checks

**User Story:** As the author, I want to know it works where it will be used.

#### Acceptance Criteria

1. ON THE PRODUCTION BUILD, served locally so the policy applies, at 1280 × 720, 360 × 740 and 320 × 640, in headless Chrome through the DevTools protocol: import a good file (through the file chooser and through a drop), a file with several kinds of errors, and a generated file of 80 tickets; screenshots; no horizontal scroll; the error region announced and focused; the banner and "Back to the sample board".
2. DOWNLOAD the sample CSV and the export, compare their bytes with the engine's output, change one value in the sample file, import it back, and check the change shows.
3. DRAG the candle on the 80-ticket board with a frame-time trace (Requirement 11.6) and report the numbers.
4. RUN the tour from an imported board: the tour plays the sample, and the imported board comes back.
5. SAY what could not be checked (a screen reader, a real phone, Excel itself, a real Jira import).

### Requirement 14: Words outside the code

**User Story:** As a reader of the repository, I want the format and its limits written down.

#### Acceptance Criteria

1. `docs/rule.md` SHALL get a dated section (append, never rewrite) with the decisions: the accepted headers, the closed-row rule, the limits and why 80, the apostrophe rule, the delimiter rule, what is and is not imported.
2. THE README SHALL describe "Your tickets": the header table, the limits, how to try it (download the sample, edit, import), what the export contains and the apostrophe note, and remove the CSV from "out of scope".
3. THE `board-ui` requirements and design get an addendum: the CSV slot is filled by this spec. A golden sample file `docs/examples/sample-board.csv` is checked by Vitest's file snapshot and referenced from the README.

## Traceability

| Requirement | Verified by |
|---|---|
| 1 reading | `tests/engine/csv.test.ts` (RFC 4180 examples, delimiter, `sep=`, BOM, fuzz) |
| 2 columns | `csv.test.ts` (header table), README comparison test |
| 3 import | `csv.test.ts` (each code, rows, letters, order, limits, closed and put-down rows), the fixtures |
| 4 export | `csv.test.ts` (columns, apostrophes, surrogates), `tests/ui/csv-golden.test.ts` |
| 5 properties | `P13`, `P26`, the fuzz and row-order tests in `csv.test.ts`; `traceability.test.ts` |
| 6 tools | `tests/ui/csv-tools.test.ts` (controls, reader, drop, downloads), `slots.test.ts`, real browser |
| 7 after an import | `reducer.test.ts`, `csv-tools.test.ts` (banner, release, reset, note, focus) |
| 8 errors | `csv-tools.test.ts` (alert, order, untouched state, provenance of sentences) |
| 9 the tour | `tour-script.test.ts`, `render-tour.test.ts` (an imported board before, during and after), `docs/video-tour-script.md` |
| 10 screen | `a11y.test.ts`, `tokens.test.ts`, `contrast.test.ts`, real browser |
| 11 performance | `tests/ui/fog-settle.test.ts` (plan B), `tests/engine/performance.test.ts`, the report |
| 12 nothing worse | the whole suite, `npm run build` |
| 13 real browser | the report of the checkpoint task |
| 14 words | review of `docs/rule.md`, `README.md` |
