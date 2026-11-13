import type { Ctx, Part } from '../context';
import type { CardView, TombstoneView, View } from '../derive';
import type { Action } from '../state';
import { Keyed, el, focusIdOf, restoreFocus, setAttr, setClass, setText, svgEl, syncChildren } from '../dom';
import {
  IMPOSSIBLE_GROUND,
  NOTHING_INSIDE,
  NOTHING_OUTSIDE,
  chainedText,
  closedLine,
  epitaphFor,
  fellText,
  formulaText,
  hungerText,
  needsText,
  reasonCovered,
  reasonText,
  releasesText,
  safehouseSummary,
  waitingText,
  yardSummary,
} from '../text';

/**
 * The two grounds. "Inside the safehouse" lists the kept tickets as plank cards; "Left outside" is a yard of tombstones. Both draw what the
 * view says, keyed by ticket, so a card is the same element for as long as its ticket stays in the same ground (focus and animations
 * survive). Board text only ever goes in through `textContent`.
 *
 * Every ticket shows its key, title, effort and cost of delay with its formula. A tombstone also shows the engine's reason, what waiting
 * costs, an epitaph from a fixed template, and its actions: "Exhume", or for a zombie "Resurrect" and "Put down (Won't Do)".
 */

export interface GroundHooks {
  /** Called after the yard was patched, so the chain drawing can follow. */
  readonly yardChanged?: (field: HTMLElement, svg: SVGElement, view: View) => void;
}

let nextId = 0;

function tag(kind: 'must-have' | 'hungry', text: string, note?: string): HTMLElement {
  const children: (HTMLElement | string)[] = [text];
  if (note !== undefined) children.push(el('span', { class: 'visually-hidden', text: ` (${note})` }));
  return el('span', { class: `tag tag-${kind}`, data: { tag: kind }, attrs: note === undefined ? {} : { title: note } }, children);
}

function badge(text: string): HTMLElement {
  return el('span', { class: 'badge badge-zombie', text, data: { badge: 'zombie' } });
}

// ---- kept tickets: one short row each on the shelf ------------------------------------------------------------------------
interface Plank {
  readonly item: HTMLLIElement;
  readonly key: HTMLElement;
  readonly title: HTMLElement;
  readonly tags: HTMLElement;
  readonly effort: HTMLElement;
  readonly cost: HTMLElement;
  readonly needs: HTMLElement;
}

function createPlank(key: string): Plank {
  const id = `card-${nextId++}`;
  const keyNode = el('span', { class: 'card-key num' });
  const title = el('h3', { class: 'card-title', id: `${id}-title` });
  const tags = el('span', { class: 'row-tags' });
  const effort = el('span', { class: 'num' });
  const cost = el('span', { class: 'row-cost num' });
  const needs = el('span', { class: 'card-needs row-needs' });
  const article = el(
    'article',
    { class: 'card card-row', attrs: { tabindex: -1, 'aria-labelledby': `${id}-title` }, data: { focus: `card:${key}`, key } },
    [keyNode, title, tags, el('span', { class: 'row-effort' }, [el('span', { class: 'visually-hidden', text: 'Effort ' }), effort]), cost, needs],
  );
  const item = el('li', { class: 'plank', data: { key, ground: 'safehouse' } }, [article]);
  return { item, key: keyNode, title, tags, effort, cost, needs };
}

function fillPlank(plank: Plank, card: CardView, closed: readonly string[]): void {
  setText(plank.key, card.key);
  setText(plank.title, card.title);
  setText(plank.effort, String(card.effort));
  setText(plank.cost, formulaText(card.cost));
  const wanted = [card.mustHave ? 'must-have' : '', card.hungry ? 'hungry' : ''].filter((t) => t !== '').join(',');
  if (plank.tags.dataset.wanted !== `${wanted}|${card.cost.past}`) {
    plank.tags.dataset.wanted = `${wanted}|${card.cost.past}`;
    const tags: HTMLElement[] = [];
    if (card.mustHave) tags.push(tag('must-have', 'must-have'));
    if (card.hungry) tags.push(tag('hungry', 'hungry', releasesText(card.cost) ?? undefined));
    plank.tags.replaceChildren(...tags);
  }
  setAttr(plank.tags, 'hidden', wanted === '');
  const needs = needsText(card.needs, closed);
  setText(plank.needs, needs);
  setAttr(plank.needs, 'hidden', needs === '');
}

// ---- buried tickets: gravestones ---------------------------------------------------------------------------------------
interface Grave {
  readonly item: HTMLLIElement;
  readonly key: HTMLElement;
  readonly badges: HTMLElement;
  readonly title: HTMLElement;
  readonly epitaph: HTMLElement;
  readonly hunger: HTMLElement;
  readonly fell: HTMLElement;
  readonly chained: HTMLElement;
  readonly needs: HTMLElement;
  readonly releases: HTMLElement;
  readonly effort: HTMLElement;
  readonly waiting: HTMLElement;
  readonly cost: HTMLElement;
  readonly whyRow: HTMLElement;
  readonly why: HTMLElement;
  readonly exhume: HTMLButtonElement;
  readonly resurrect: HTMLButtonElement;
  readonly putDown: HTMLButtonElement;
}

function actionFor(verb: 'exhume' | 'resurrect' | 'put-down', key: string): Action {
  switch (verb) {
    case 'exhume':
      return { type: 'tombstone/exhume', key };
    case 'resurrect':
      return { type: 'tombstone/resurrect', key };
    case 'put-down':
      return { type: 'tombstone/put-down', key };
  }
}

function fact(label: string, value: HTMLElement, wide = false): HTMLElement {
  return el('div', { class: wide ? 'fact fact-wide' : 'fact' }, [el('dt', { text: label }), value]);
}

function createGrave(ctx: Ctx, key: string): Grave {
  const id = `tomb-${nextId++}`;
  const keyNode = el('span', { class: 'card-key num' });
  const badges = el('span', { class: 'card-badges' });
  const title = el('h3', { class: 'card-title', id: `${id}-title` });
  const epitaph = el('p', { class: 'card-epitaph' });
  const hunger = el('p', { class: 'card-hunger' });
  const fell = el('p', { class: 'card-fell' });
  const chained = el('p', { class: 'card-chained' });
  const needs = el('p', { class: 'card-needs' });
  const releases = el('p', { class: 'card-releases' });
  const effort = el('dd', { class: 'num' });
  const waiting = el('dd', { class: 'num' });
  const cost = el('dd', { class: 'card-cost num' });
  const why = el('dd');
  const whyRow = fact('Why', why, true);
  whyRow.classList.add('card-why');
  const button = (verb: 'exhume' | 'resurrect' | 'put-down', text: string, label: string): HTMLButtonElement =>
    el('button', {
      class: `button action action-${verb}`,
      attrs: { type: 'button', 'aria-label': `${label} ${key}${verb === 'put-down' ? " (Won't Do)" : ''}` },
      data: { focus: `${verb}:${key}`, action: verb },
      text,
      on: { click: () => ctx.act(actionFor(verb, key)) },
    });
  const exhume = button('exhume', 'Exhume', 'Exhume');
  const resurrect = button('resurrect', 'Resurrect', 'Resurrect');
  const putDown = button('put-down', "Put down (Won't Do)", 'Put down');
  const article = el(
    'article',
    { class: 'card card-tomb', attrs: { tabindex: -1, 'aria-labelledby': `${id}-title` }, data: { focus: `tomb:${key}`, key } },
    [
      el('p', { class: 'grave-rip', attrs: { 'aria-hidden': 'true' }, text: 'R · I · P' }),
      el('header', { class: 'card-head' }, [keyNode, badges]),
      title,
      epitaph,
      hunger,
      fell,
      chained,
      needs,
      releases,
      el('dl', { class: 'card-facts' }, [fact('Effort', effort), fact('Waiting costs', waiting), fact('Cost of delay', cost, true), whyRow]),
      el('div', { class: 'card-actions' }, [exhume, resurrect, putDown]),
    ],
  );
  const item = el('li', { class: 'grave', data: { key, ground: 'yard' } }, [article]);
  return { item, key: keyNode, badges, title, epitaph, hunger, fell, chained, needs, releases, effort, waiting, cost, whyRow, why, exhume, resurrect, putDown };
}

function fillGrave(grave: Grave, tomb: TombstoneView, index: number, weeks: number, closed: readonly string[]): void {
  setText(grave.key, tomb.key);
  setText(grave.title, tomb.title);
  setText(grave.effort, String(tomb.effort));
  setText(grave.cost, formulaText(tomb.cost));
  setText(grave.waiting, waitingText(tomb.burialCost, weeks));
  const have = grave.badges.children.length;
  if (tomb.isZombie !== (have > 0)) grave.badges.replaceChildren(...(tomb.isZombie ? [badge('Zombie')] : []));
  const epitaph = epitaphFor(tomb, weeks);
  setText(grave.epitaph, epitaph);
  const hunger = hungerText(tomb) ?? '';
  setText(grave.hunger, hunger);
  setAttr(grave.hunger, 'hidden', hunger === '');
  // The reason is a separate row only when the epitaph does not already say it (the node is emptied, not just hidden).
  const covered = reasonCovered(tomb.reason, epitaph);
  setText(grave.why, covered ? '' : reasonText(tomb.reason));
  setAttr(grave.whyRow, 'hidden', covered);
  const chained = chainedText(tomb.chainedTo);
  setText(grave.chained, chained);
  setAttr(grave.chained, 'hidden', chained === '');
  // The chain already says what it hangs on; "Needs" is added only when something it needs was closed as Won't Do.
  const needs = tomb.needs.some((key) => closed.includes(key)) ? needsText(tomb.needs, closed) : '';
  setText(grave.needs, needs);
  setAttr(grave.needs, 'hidden', needs === '');
  const fell = tomb.fell && tomb.reason.kind === 'depends-on-buried' ? fellText(tomb.reason.buriedDependencies) : '';
  setText(grave.fell, fell);
  setAttr(grave.fell, 'hidden', fell === '');
  // A zombie's releases are in its epitaph and its hunger line; any other tombstone that was left out before says so here.
  const releases = tomb.isZombie ? '' : (releasesText(tomb.cost) ?? '');
  setText(grave.releases, releases);
  setAttr(grave.releases, 'hidden', releases === '');
  setAttr(grave.exhume, 'hidden', tomb.isZombie);
  setAttr(grave.resurrect, 'hidden', !tomb.isZombie);
  setAttr(grave.putDown, 'hidden', !tomb.isZombie);
  const item = grave.item;
  setAttr(item, 'data-zombie', tomb.isZombie ? 'true' : 'false');
  setAttr(item, 'data-fell', tomb.fell ? 'true' : 'false');
  setAttr(item, 'data-reason', tomb.reason.kind);
  setClass(item, 'is-zombie', tomb.isZombie);
  setClass(item, 'is-fallen', tomb.fell);
  item.style.setProperty('--i', String(index)); // the order of the fall, for the staggered animation
}
// ---- the grounds -------------------------------------------------------------------------------------------------------

export function mountGrounds(safehouse: HTMLElement, yard: HTMLElement, ctx: Ctx, hooks: GroundHooks = {}): Part {
  // Safehouse
  const keptSummary = el('p', { class: 'ground-summary num', data: { region: 'safehouse-summary' } });
  const keptEmpty = el('p', { class: 'ground-empty', data: { region: 'safehouse-empty' } });
  const planks = el('ul', { class: 'shelf', attrs: { role: 'list' }, data: { list: 'safehouse' } });
  const mustHaves = el('ul', { class: 'musthave-list', attrs: { role: 'list' }, data: { list: 'must-haves' } });
  safehouse.append(keptSummary, keptEmpty, mustHaves, planks);

  // Yard
  const buriedSummary = el('p', { class: 'ground-summary num', data: { region: 'yard-summary' } });
  const buriedEmpty = el('p', { class: 'ground-empty', data: { region: 'yard-empty' } });
  const svg = svgEl('svg', { class: 'chains', attrs: { 'aria-hidden': 'true', focusable: 'false' }, data: { region: 'chains' } });
  const graves = el('ul', { class: 'graves', attrs: { role: 'list' }, data: { list: 'yard' } });
  const field = el('div', { class: 'yard-field' }, [svg, graves]);
  const closed = el('p', { class: 'closed-line', data: { region: 'closed' } });
  yard.append(buriedSummary, buriedEmpty, field, closed);

  const cards = new Keyed<Plank>(createPlank);
  const tombs = new Keyed<Grave>((key) => createGrave(ctx, key));

  return {
    update(view, state) {
      const doc = ctx.root.ownerDocument;
      const focusId = focusIdOf(ctx.root, doc.activeElement);
      const weeks = state.board.nextReleaseWeeks;
      const closedKeys = view.putDown;
      const impossible = view.solution.status === 'impossible';
      const totals = view.totals;

      // ---- safehouse ----
      if (totals !== null && view.solution.status === 'ok') setText(keptSummary, safehouseSummary(totals, view.solution.effectiveCapacity));
      else setText(keptSummary, '');
      setAttr(keptSummary, 'hidden', totals === null);
      const keptMessage = impossible ? IMPOSSIBLE_GROUND : view.safehouse.length === 0 ? NOTHING_INSIDE : '';
      setText(keptEmpty, keptMessage);
      setAttr(keptEmpty, 'hidden', keptMessage === '');

      syncChildren(
        mustHaves,
        impossible
          ? view.mustHaves.map((m) => {
              const item = el('li', { class: 'musthave', data: { key: m.key } }, [
                el('span', { class: 'card-key num', text: m.key }),
                ' ',
                el('span', { class: 'musthave-title', text: m.title }),
                ' ',
                el('span', { class: 'musthave-effort num', text: `${m.effort} ${m.effort === 1 ? 'point' : 'points'}` }),
              ]);
              return item;
            })
          : [],
      );
      setAttr(mustHaves, 'hidden', !impossible);

      syncChildren(
        planks,
        view.safehouse.map((card) => {
          const plank = cards.get(card.key);
          fillPlank(plank, card, closedKeys);
          return plank.item;
        }),
      );
      cards.retain(new Set(view.safehouse.map((c) => c.key)));

      // ---- yard ----
      if (totals !== null) setText(buriedSummary, yardSummary(totals));
      else setText(buriedSummary, '');
      setAttr(buriedSummary, 'hidden', totals === null);
      const buriedMessage = impossible ? IMPOSSIBLE_GROUND : view.yard.length === 0 ? NOTHING_OUTSIDE : '';
      setText(buriedEmpty, buriedMessage);
      setAttr(buriedEmpty, 'hidden', buriedMessage === '');

      syncChildren(
        graves,
        view.yard.map((tomb, index) => {
          const grave = tombs.get(tomb.key);
          fillGrave(grave, tomb, index, weeks, closedKeys);
          return grave.item;
        }),
      );
      tombs.retain(new Set(view.yard.map((t) => t.key)));
      setAttr(field, 'hidden', view.yard.length === 0);

      const closedText = closedLine(closedKeys);
      setText(closed, closedText);
      setAttr(closed, 'hidden', closedText === '');

      hooks.yardChanged?.(field, svg, view);

      // ---- keep the focus where the user was ----
      if (focusId !== null) {
        const colon = focusId.indexOf(':');
        const key = colon < 0 ? focusId : focusId.slice(colon + 1);
        const lastResort = focusId.startsWith('card:') || focusId.startsWith('resurrect:') ? safehouse : yard;
        restoreFocus(ctx.root, focusId, [`card:${key}`, `tomb:${key}`], lastResort);
      }
    },
  };
}
