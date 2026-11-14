import { CANDLE_STEPS } from '../candle-steps';
import type { Action } from '../state';
import { thousands } from '../text';
import type { SimulatedScene } from './simulate';

/**
 * The text of `docs/video-tour-script.md`, made from the script data by running it through the reducer. A test compares it with the file, so the
 * document can never say something the app does not.
 */
function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

/** What the app does at the start of a scene, in words. */
function describeAction(action: Action, scene: SimulatedScene): string {
  switch (action.type) {
    case 'board/reset':
      return 'presses Reset: back to the plain night (Friday 18:00, no reserve, nobody away)';
    case 'candle/set':
      return `moves the candle to ${CANDLE_STEPS[action.step]?.label ?? '?'}`;
    case 'survivor/toggle':
      return scene.facts.before.state.away.includes(action.name) ? `brings ${action.name} back` : `sends ${action.name} away`;
    case 'reserve/set':
      return `sets the reserve to ${action.pct} %`;
    case 'tombstone/exhume':
      return `exhumes ${action.key}`;
    case 'tombstone/resurrect':
      return `resurrects ${action.key}`;
    case 'tombstone/put-down':
      return `puts ${action.key} down (Won't Do)`;
    case 'sound/set':
      return action.on ? 'turns sound on' : 'turns sound off';
    case 'state/restore':
      return 'restores a state';
  }
}

function whatTheAppDoes(scene: SimulatedScene): string {
  const steps = scene.scene.actions.map((a) => describeAction(a, scene));
  const ring = (scene.scene.spot ?? []).map((id) => id.split(':')[1] ?? id);
  if (ring.length > 0) steps.push(`rings ${ring.join(' and ')}`);
  if (steps.length === 0) return 'nothing is pressed';
  const text = steps.join(', then ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

export function renderTourScript(sim: readonly SimulatedScene[]): string {
  const total = sim.at(-1)?.endMs ?? 0;
  const lines: string[] = [];
  lines.push('# Video tour script: "Play the night"');
  lines.push('');
  lines.push('<!-- Generated. Do not edit by hand. -->');
  lines.push('');
  lines.push(
    'Generated from `src/ui/tour/sample-script.ts` by running it through the app\'s reducer, so every number below is what the engine returns for the sample board. ' +
      'To change it, change the script and run `npx vitest run tests/ui/tour-script.test.ts -u`; the test fails while this file and the app disagree.',
  );
  lines.push('');
  lines.push(`${sim.length} scenes, ${seconds(total)} seconds, English subtitles, one sentence each, at most 15 characters per second.`);
  lines.push('');
  lines.push('## Scenes');
  lines.push('');
  lines.push('| # | Seconds | Shows | The app | Subtitle | Characters | Per second |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const s of sim) {
    const cps = (s.caption.length / (s.scene.durationMs / 1000)).toFixed(1);
    lines.push(
      `| ${s.index + 1} | ${seconds(s.startMs)}–${seconds(s.endMs)} | ${s.scene.show} | ${cell(whatTheAppDoes(s))} | ${cell(s.caption)} | ${s.caption.length} | ${cps} |`,
    );
  }
  lines.push('');
  const fog = sim.find((s) => s.facts.after.view.fog !== null && s.scene.id === 'fog-zero')?.facts.after.view.fog;
  if (fog !== undefined && fog !== null) {
    lines.push('## The fog of the plain night');
    lines.push('');
    lines.push('The numbers of the fog scenes: the cut the rule keeps at each reserve, against the full capacity, over 1,000 simulated nights.');
    lines.push('');
    lines.push('| Reserve | Tickets kept | Points kept | Nights that hold | Shown |');
    lines.push('|---|---|---|---|---|');
    for (const p of fog.points) {
      if (p.status === 'ok') {
        lines.push(`| ${p.marginPct} % | ${p.keptCount} | ${p.keptEffort} of ${p.capacity} | ${thousands(p.fog.holds)} of ${thousands(p.fog.nights)} | ${p.fog.pct} % |`);
      } else {
        lines.push(`| ${p.marginPct} % | no cut | | | |`);
      }
    }
    lines.push('');
    lines.push('The percentage is floored, so a few nights can hold and still read 0 %. The video shows the steps 0, 10, 15 and 20 %.');
    lines.push('');
  }
  lines.push('## Recording notes');
  lines.push('');
  lines.push('- Record at 1920 × 1080 in a browser window with the page filling it. The page is a 1,120 px column; the subtitle bar is the same width.');
  lines.push('- The tour restores the page to what it was when it ends, and every scene starts from the app\'s own state, so it can be recorded again and again.');
  lines.push('- To start it without a cursor: open the page, change the address to end in `#play` (no reload), then press **Space** (or Enter) when the recording runs.');
  lines.push('  `Esc` removes the prompt without starting. The header button "Play the night · 60 s" starts it too.');
  lines.push('- To have the app\'s sounds in the recording: press **Sound on** first, with a click, and then change the address to `#play` without reloading the page.');
  lines.push('  The tour never turns sound on by itself and plays no music.');
  lines.push('- While it runs, **Pause**, **Skip scene** and **Stop** (or `Esc`) are on the screen at all times. At the end, **Play again** and **Close** appear.');
  lines.push('');
  return lines.join('\n');
}
