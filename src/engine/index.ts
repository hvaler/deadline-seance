// Public API of the rule engine (`src/engine`). The UI, the MCP server and the tests import from here.
// The brute-force oracle (`oracle.ts`) is for tests only and is deliberately not exported.

// Data model and constants
export type * from './types';
export { SCALE, DEFAULT_TIME_ZONE, DEFAULT_NEXT_RELEASE_WEEKS, DEFAULT_ZOMBIE_THRESHOLD, ok, err } from './types';

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
