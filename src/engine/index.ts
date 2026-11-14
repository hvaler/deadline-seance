// Public API of the rule engine (`src/engine`). The UI, the MCP server and the tests import from here.
// The brute-force oracle (`oracle.ts`) is for tests only and is deliberately not exported.

// Data model and constants
export type * from './types';
export { SCALE, DEFAULT_TIME_ZONE, DEFAULT_NEXT_RELEASE_WEEKS, DEFAULT_ZOMBIE_THRESHOLD, DEFAULT_FOG_SEED, MAX_FOG_SEED, ok, err } from './types';

// Keys
export { compareKeys, sortedKeys, compareKeyLists } from './keys';

// Validation
export { validateBoard } from './validate';

// Capacity
export { capacityBetween, effectiveCapacity } from './capacity';

// Cost of delay and hunger
export { burialCost, codParts, costOfDelay, effectiveUrgency } from './cod';
export type { CodParts } from './cod';

// The rule
export { solveFreeze, solveWithCapacity } from './solver';

// What changes when the rule re-solves
export { diffSolutions, exhume, putDown, resurrect } from './diff';
export type { ExhumeApplied, ExhumeOutcome, ExhumeRejected, PutDownApplied } from './diff';

// The fog of estimates
export { FOG_NIGHTS, FOG_MIN_PCT, FOG_MAX_PCT, FOG_RESERVE_STEPS, fogCurve, fogFactor, fogFromTable, fogTable, simulateFog } from './fog';
export type { FogPoint, FogPointImpossible, FogPointOk, FogResult, FogTable } from './fog';

// What a text may say, and the guard that checks it
export { nightFacts } from './facts';
export type { ImpossibleNight, LocalStamp, NightFacts, NightInput, OutsideFact, OutsideReason, PushedOut, SolvedNight } from './facts';
export { checkNumbers, extractTokens, guardFacts } from './guard';
export type { ExtractOptions, GuardFacts, GuardResult, Offending, OffendingReason, Span, Token, TokenKind } from './guard';

// The death certificate
export { certificateNote, deathCertificate, escapeMarkdown, guardCertificate, plainText, renderCertificate, renderNote } from './certificate';
export type { Block, Data, KeyRef, Note, RenderedCertificate, Text } from './certificate';

// Jira CSV
export { ACCEPTED_HEADERS, CSV_LIMITS, EXPORT_HEADERS, columnLetter, exportCsv, guardCell, importCsv, parseCsv, serializeCsv, toWellFormed, unguardCell } from './csv';
export type { CsvColumn, CsvError, CsvErrorCode, CsvWarning, Delimiter, ExportInput, HeaderSpec, ImportBase, Imported, Meaning, ParsedCsv } from './csv';
// The sample board (plain data), shared by the web app and the MCP server
export { SAMPLE_FREEZE_AT, SAMPLE_NOW, SAMPLE_RELEASE, sampleBoard } from './sample';
// Sentences for board and CSV errors
export { describeCsvError, describeValidationError, listOf, thousands } from './messages';
