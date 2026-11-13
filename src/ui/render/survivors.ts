import type { Ctx, Part } from '../context';
import { Keyed, el, setAttr, setClass, setText, syncChildren } from '../dom';
import type { TeamView } from '../derive';
import { count } from '../text';

/**
 * The survivors: one switch per person. Pressing it sends the person away or brings them back; the capacity, the cut and the change note
 * follow from the engine. Each switch is a native button with `role="switch"`, named by the person and their points, with "Here" or "Away"
 * written out so the state is never only a colour.
 */

interface Chip {
  readonly item: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly name: HTMLElement;
  readonly points: HTMLElement;
  readonly state: HTMLElement;
  readonly note: HTMLElement;
}

let nextId = 0;

function createChip(ctx: Ctx, name: string): Chip {
  const id = `survivor-${nextId++}`;
  const nameNode = el('span', { class: 'chip-name', id: `${id}-name` });
  const points = el('span', { class: 'chip-points num', id: `${id}-points` });
  const state = el('span', { class: 'chip-state', id: `${id}-state` });
  const button = el(
    'button',
    {
      class: 'chip',
      attrs: { type: 'button', role: 'switch', 'aria-checked': 'true', 'aria-labelledby': `${id}-name ${id}-points`, 'aria-describedby': `${id}-state` },
      data: { focus: `survivor:${name}`, name },
      on: { click: () => ctx.act({ type: 'survivor/toggle', name }) },
    },
    [nameNode, points, state],
  );
  const note = el('span', { class: 'chip-note' });
  const item = el('li', { class: 'team-member', data: { name } }, [button, note]);
  return { item, button, name: nameNode, points, state, note };
}

export function mountSurvivors(section: HTMLElement, ctx: Ctx): Part {
  const list = el('ul', { class: 'team', attrs: { role: 'list' } });
  section.append(list);
  const chips = new Keyed<Chip>((name) => createChip(ctx, name));

  return {
    update(view, state) {
      const members: readonly TeamView[] = view.team;
      const days = new Map(state.board.people.map((p) => [p.name, p.daysOff] as const));
      syncChildren(
        list,
        members.map((member) => {
          const chip = chips.get(member.name);
          setText(chip.name, member.name);
          setText(chip.points, `${count(member.pointsPerHalfDay, 'point')} per half day`);
          setText(chip.state, member.away ? 'Away' : 'Here');
          setAttr(chip.button, 'aria-checked', member.away ? 'false' : 'true');
          setClass(chip.item, 'is-away', member.away);
          const off = days.get(member.name) ?? [];
          setText(chip.note, off.length === 0 ? '' : `Day off: ${off.map((d) => `${d.date} ${d.part === 'full' ? 'all day' : d.part}`).join(', ')}`);
          return chip.item;
        }),
      );
      chips.retain(new Set(members.map((m) => m.name)));
    },
  };
}
