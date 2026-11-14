import { listOf } from '../src/engine/index';
import type { SideValue, SolveFreezeOutputValue, TicketRowValue, WhatIfOutputValue } from './schemas';

// Text from structured values. This file places values in sentences; it computes nothing. The engine's integers appear as they are (no thousands
// separator), so a test can find each one in the structured value.

type Reason = SolveFreezeOutputValue['outside'][number]['reason'];

function reasonText(reason: Reason): string {
  switch (reason.kind) {
    case 'no-room':
      return `no room: it needs ${reason.needed} points and ${reason.left} are left`;
    case 'depends-on-buried':
      return `it depends on ${listOf(reason.buriedDependencies)}, which is outside`;
    case 'blocked-by-put-down':
      return `it depends on ${reason.putDownKey}, which was put down`;
    case 'pushed-out-by-exhume': {
      const who = listOf(reason.exhumed);
      const how = reason.together ? 'together' : 'alone';
      return `pushed out by exhuming ${who} (${how}): it needs ${reason.needed} points and ${reason.left} are left`;
    }
  }
}

function row(t: TicketRowValue): string {
  return `${t.key} "${t.title}" (${t.effort} points, cost of delay ${t.cod})`;
}

export function renderSolve(out: SolveFreezeOutputValue): string {
  const lines: string[] = [];
  lines.push(`Freeze ${out.freeze.weekday} ${out.freeze.date} ${out.freeze.time} (${out.zone}), asked on ${out.asOf.weekday} ${out.asOf.date} ${out.asOf.time}.`);
  if (out.away.length > 0) lines.push(`Away for the night: ${listOf(out.away)}.`);
  if (out.status === 'impossible') {
    lines.push(`The freeze is impossible: the must-haves need ${out.needed ?? 0} points and the capacity is ${out.capacity} (${out.effectiveCapacity} with a ${out.marginPct}% reserve).`);
    for (const b of out.blockedMustHaves) lines.push(`${b.key} is a must-have that depends on ${b.putDownKey}, which was put down.`);
    return lines.join('\n');
  }
  lines.push(`Capacity ${out.capacity} points, ${out.effectiveCapacity} with a ${out.marginPct}% reserve.`);
  if (out.totals !== null) lines.push(`Kept ${out.totals.tickets} tickets, ${out.totals.points} points, cost of delay ${out.totals.cod}.`);
  if (out.fog !== null) lines.push(`The night holds on ${out.fog.holds} of ${out.fog.nights} simulated nights (${out.fog.pct}%).`);
  lines.push('Kept:');
  for (const t of out.kept) lines.push(`- ${row(t)}`);
  if (out.outsideTotals !== null) {
    lines.push(
      `Outside: ${out.outsideTotals.tickets} tickets, ${out.outsideTotals.points} points, cost of delay ${out.outsideTotals.cod}, waiting cost ${out.outsideTotals.waitingCost}.`,
    );
  }
  for (const o of out.outside) lines.push(`- ${row(o)}${o.isZombie ? ' [zombie]' : ''}: ${reasonText(o.reason)}`);
  if (out.zombies.length > 0) lines.push(`Zombies: ${listOf(out.zombies)}.`);
  return lines.join('\n');
}

function sideText(label: string, s: SideValue): string {
  if (s.status === 'impossible') {
    return `${label}: impossible. The must-haves need ${s.needed ?? 0} points and the capacity is ${s.capacity}.`;
  }
  const fog = s.fog === null ? '' : ` The night holds on ${s.fog.holds} of ${s.fog.nights} nights (${s.fog.pct}%).`;
  return `${label}: capacity ${s.capacity} (${s.effectiveCapacity} with a ${s.marginPct}% reserve), kept ${s.tickets ?? 0} tickets, ${s.points ?? 0} points, cost of delay ${s.cod ?? 0}.${fog}`;
}

export function renderWhatIf(out: WhatIfOutputValue): string {
  const lines: string[] = [`What if: ${out.change}.`, sideText('Before', out.before), sideText('After', out.after)];
  if (out.rejected) lines.push('The change would make the freeze impossible, so nothing comes in or goes out.');
  else {
    lines.push(out.comes_in.length === 0 ? 'Comes in: nothing.' : `Comes in: ${out.comes_in.map(row).join('; ')}.`);
    lines.push(out.goes_out.length === 0 ? 'Goes out: nothing.' : `Goes out: ${out.goes_out.map(row).join('; ')}.`);
    if (out.cod_delta !== null) lines.push(`Cost of delay kept changes by ${out.cod_delta}.`);
  }
  return lines.join('\n');
}
