# Implementation plan: death-certificate

Run `npm run typecheck` and `npm test` before ticking any task; tick it only when both exit 0 (the suite starts at 53 files and 1040 tests). Run mutation checks one at a time, never in parallel on the same file,
and revert each. Do not change the sample board or its seed. Do not loosen the CSP. Do not commit or push. A task marked **stop** ends with a question to the user instead of going on.

- [x] 1. Spike: does a download work under the policy? (Requirements 9.4, 13.2; Decision D12)
  - [x] 1.1 A throwaway page in `%TEMP%` with the exact policy of `build/csp.ts` in a `<meta>`, a button that makes a `Blob`, an object URL, a temporary `<a download>`, clicks it and revokes the URL; served locally; headless Chrome through the
    DevTools protocol with `Browser.setDownloadBehavior`; check that the file arrives with the right bytes and that the console has no policy violation. Delete the page and the script afterwards
  - [x] 1.2 If it is blocked: **stop** and report, with the two options of D12. If it works: note it in the report and go on
  - _Requirements: 9.4, 13.2_
- [x] 2. The rule first (Requirement 14.1)
  - [x] 2.1 Append a dated section to `docs/rule.md` (Spanish, as the rest of the file; never rewrite history): what a number is for the guard (the token table), the four reasons and leave-one-out, the sections and the order of the
    certificate, what P12 and P24 now check, the limits of the guard
  - _Requirements: 14.1_
- [x] 3. The number guard (Requirement 2, 5.4)
  - [x] 3.1 `src/engine/guard.ts`: `extractTokens`, `guardFacts`, `checkNumbers`; a fresh sticky regular expression per call; priority order of the design; header comment with the limits
  - [x] 3.2 `tests/engine/guard.test.ts`: the token table row by row; `1,000`, `3,5`, `13 %`, `13%`, `007`; signs (`−15`, `-15`, `+8`, and none in `HB-108`, `2026-11-18`, `80-150`, `Mon-Fri`); wrong sign; dates, times and weekdays not read as numbers;
    key-shaped and odd-shape keys (`A3`); number words (`three`, `twenty-one`); decimals; spans by position (a title `5` does not hide a wrong `5`); a property that it never throws and returns offending tokens in offset order for any string;
    the bite tests of Requirement 5.4, each naming the token it expects
  - [x] 3.3 `guardFacts` over a nested object: numbers, negatives, strings as words, keys; it reads values only (renaming a property changes nothing)
  - _Requirements: 2.1–2.10, 5.4_
- [x] 4. The facts of the night (Requirement 1)
  - [x] 4.1 `src/engine/facts.ts`: `NightInput`, `NightFacts`, `nightFacts`; the stamps with `Intl`; totals and parts from the solver and `codParts`; the fog from `simulateFog`; the four reasons; leave-one-out; put-down blocks with `blockedBy`; the
    deterministic order; the impossible night
  - [x] 4.2 `tests/engine/facts.test.ts`: the sample at Friday 18:00 and after the tour's actions, field by field, with the numbers of the design (12 / 59 / 167 kept, 7 / 129 / 101 outside, 202 waiting, 0 of 1,000; and after the tour 4 / 23 / 63 kept, HB-105 and HB-109 pushed out
    by HB-108, HB-114 blocked by HB-112, 29 of 1,000); leave-one-out on a hand-made board (one culprit among two exhumes; two exhumes needed together; none); equality with `solveFreeze`, `simulateFog` and the point of `fogCurve`; undoing exhumes is
    never impossible; unknown name in `away` is an error; the impossible night; a property that permuting tickets, people and absences gives equal facts; the input is not changed (deep-frozen input)
  - _Requirements: 1.1–1.10_
- [x] 5. Markdown and the certificate (Requirements 3, 4, 5.2)
  - [x] 5.1 `src/engine/certificate.ts`: the `Note` model, `escapeMarkdown`, `certificateNote`, `renderCertificate` (Markdown and data spans), `deathCertificate`, `guardCertificate`; the template of the design, with singular forms and the impossible note
  - [x] 5.2 `tests/engine/generators.ts`: `arbTitle` and `arbNight` (design section 8)
  - [x] 5.3 `tests/engine/certificate.test.ts`: sections and order; the escaping properties of 3.3 and 3.4 (cells in a row, no raw `<` or `&`, no newline) over arbitrary strings; **`P24 ...`** over `arbNight`; an empty board; an impossible night; a board with every section
    filled; the template has no digit and no number word (guard over the note of an empty board); the no-promise scan; permutation gives equal Markdown; the cost-of-delay cell equals `formulaText` of `text.ts` for every ticket of the sample (this one in `tests/ui`)
  - _Requirements: 3.1–3.6, 4.1–4.8, 5.2_
- [x] 6. Public API and traceability (Requirements 5.3, 12)
  - [x] 6.1 `src/engine/index.ts` exports `nightFacts`, `extractTokens`, `guardFacts`, `checkNumbers`, `escapeMarkdown`, `certificateNote`, `renderCertificate`, `deathCertificate`, `guardCertificate` and their types; `purity.test.ts` gets the new list on purpose and the
    new files in its scan (no banned word, not even in strings)
  - [x] 6.2 `traceability.test.ts`: P24 in `certificate.test.ts`, P12 in `ui/epitaph-guard.test.ts`; the scan also reads `tests/ui/*.test.ts`; its comment is brought up to date
  - _Requirements: 5.3, 12.1, 12.2_
- [x] 7. Mutation checks (Requirement 5.5)
  - [x] 7.1 One at a time, on a copy, reverted each time: guard ignores signs; guard reads `1,000` as 1 and 000; guard skips the key check; guard ignores spans by searching for the title; `escapeMarkdown` leaves `|`; `escapeMarkdown` leaves `<`; facts name every exhume instead
    of the culprit; the certificate writes the cost of delay in the waiting-cost column. Each must be caught by a named test (the last by the golden note); report which
  - _Requirements: 5.5_
- [x] 8. Epitaphs and the golden notes (Requirements 5.1, 6)
  - [x] 8.1 `tests/ui/epitaph-guard.test.ts`: **`P12 ...`** over generated UI states (candle, reserve, away, exhume, put-down): every tombstone's epitaph passes `checkNumbers` against its entry of the night facts, with the keys of that entry; the three reasons by example;
    `epitaphFor` in `text.ts` does not change
  - [x] 8.2 `src/ui/night.ts` (`nightInputOf`) and `SAMPLE_RELEASE` in `sample-board.ts`
  - [x] 8.3 `tests/ui/certificate-golden.test.ts`: the two files of `docs/examples/` by file snapshot, generated with `-u`; both pass the guard and the no-promise scan; **check the numbers of both by hand against the engine and list them in the report**
  - _Requirements: 5.1, 6.1–6.3_
- [x] 9. Services and harness (Requirements 8, 9, 12)
  - [x] 9.1 `services.ts`: `Services.clipboard` and `Services.files` with browser defaults (Blob, object URL, temporary link, revoke after 1,000 ms through `services.timers`); `harness.ts`: `RecordingClipboard` (accept or refuse) and `RecordingFiles`
  - _Requirements: 8.1, 9.1, 9.5_
- [x] 10. The view (Requirements 7, 8, 9, 10)
  - [x] 10.1 `render/certificate.ts`: overlay, head with the three buttons, status line, fallback text area, body built from the `Note` with DOM nodes; modal mode (focus to the title, trap, `Esc`, `inert` on header, main and skip link, focus back to the opener) and tour mode
    (not modal, itself `inert`, scrolled to "Left outside"); Copy with the fallback; Download; `destroy`
  - [x] 10.2 `render/tools.ts`: the working button with `data-focus="certificate"` replaces the slot; `app.ts`: mount it, `MountOptions.release`; `main.ts`: `release: SAMPLE_RELEASE`
  - [x] 10.3 CSS (components, layout): the view, the table scroll box, the status line, the fallback; palette tokens only; no pixel font under 16 px; no animation; `bottom: 18rem` in tour mode
  - _Requirements: 7.1–7.8, 8.1–8.4, 9.1–9.5, 10.1–10.5_
- [x] 11. Tests of the screen (Requirements 7 to 10, 12)
  - [x] 11.1 `tests/ui/certificate-view.test.ts`, as listed in design section 8 (including: the view equals the Markdown cell by cell; a hostile title creates no element; refusal shows a focused, selected text area; every object URL revoked once; closing returns focus)
  - [x] 11.2 `slots.test.ts` (the certificate is no longer a slot; three slots remain in the tools; the button is a working control), `a11y.test.ts` (the open view, the tour mode), `tokens.test.ts`, `contrast.test.ts`, `imports.test.ts`, `build.test.ts` still pass; the gzipped size is reported
  - _Requirements: 7–10, 12.1, 12.3_
- [x] 12. The tour scene (Requirement 11)
  - [x] 12.1 `Show` gains `'certificate'`; `render/tour.ts` opens the view in tour mode and closes it on any other scene, stop, end, dispose and start; `sample-script.ts` gets the new scene after "someone-insists" and the three durations of D9; `doc.ts` words the action
  - [x] 12.2 If the reading speed or the total does not fit when run, **stop** and report instead of forcing it; otherwise change `tour-script.test.ts` and `render-tour.test.ts` on purpose and regenerate `docs/video-tour-script.md` with `npx vitest run tests/ui/tour-script.test.ts -u`
  - _Requirements: 11.1–11.6_
- [x] 13. Real browser (Requirement 13)
  - [x] 13.1 Build; serve `dist`; headless Chrome at 1280 × 720, 360 × 740 and 320 × 640: open the view, screenshots (top and table), page `scrollWidth`, table box scroll, controls at least 44 px, `Esc`, focus return, Tab inside; look at the screenshots
  - [x] 13.2 Download to a temporary folder and compare bytes; no policy violation in the console; the URL revoked. Copy with the permission granted and read back; then denied, and the fallback focused and selected
  - [x] 13.3 The tour to the certificate scene at the three widths: the view above the bar, readable, not clipped, the bar unchanged; the real run time against the script total (59.0 s)
  - [x] 13.4 Fix what the screenshots show and run again; delete the scripts, the temporary folder and `dist/`
  - _Requirements: 13.1–13.5_
- [x] 14. Words outside the code (Requirement 14)
  - [x] 14.1 README: the certificate, Copy and Download, the two examples, the guard in two lines; the certificate leaves "out of scope"
  - [x] 14.2 Addenda to the `board-ui` requirements and design: the certificate slot is filled by this spec
  - _Requirements: 14.2, 14.3_
- [x] 15. Checkpoint
  - [x] 15.1 `npm run typecheck`, `npm test`, `npm run build` all green; gzipped JS plus CSS under 60 kB (report the number and the test count)
  - [x] 15.2 Report: the facts of both golden notes and the numbers checked by hand; the mutation checks and which test caught each; what each width showed and what changed; Copy and Download results; the real run time of the tour; what could not be checked
  - [x] 15.3 Stop. Do not commit or push
