import type { Script } from './types';
/**
 * How long the tour lasts, in one place. The button's label, the generated video script and the tests all read it from here, so a label can
 * only say what the script measures.
 */
/** The sum of the scenes' durations, in milliseconds. */
export function totalMs(script: Script): number {
  return script.reduce((sum, scene) => sum + scene.durationMs, 0);
}
/** Whole seconds are written without a fraction (`59`); anything else with one decimal (`59.5`). */
export function secondsText(ms: number): string {
  return ms % 1000 === 0 ? String(ms / 1000) : (ms / 1000).toFixed(1);
}
/** The label of the button that starts a tour that lasts `ms`: "Play the night · 59 s". */
export function tourLabelFor(ms: number): string {
  return `Play the night \u00b7 ${secondsText(ms)} s`;
}
export function tourButtonLabel(script: Script): string {
  return tourLabelFor(totalMs(script));
}
