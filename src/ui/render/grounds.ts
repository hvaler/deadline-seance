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
  needsText,
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

interface CardParts {
  readonly item: HTMLLIElement;
  readonly article: HTMLElement;
  readonly key: HTMLElement;
  readonly badges: HTMLElement;
  readonly title: HTMLElement;
  readonly effort: HTMLElement;
  readonly cost: HTMLElement;
  readonly releases: HTMLElement;
  readonly needs: HTMLElement;
}

function createCardParts(kind: 'card' | 'tomb', key: string): CardParts {
  const id = `${kind}-${nextId++}`;
  const keyNode = el('span', { class: 'card-key num' });
  const badges = el('span', { class: 'card-badges' });
  const title = el('h3', { class: 'card-title', id: `${id}-title` });
  const effort = el('dd', { class: 'num' });
  const cost = el('dd', { class: 'card-cost num' });
  const releases = el('p', { class: 'card-releases' });
  const needs = el('p', { class: 'card-needs' });
  const article = el(
    'article',
    { class: `card card-${kind}`, attrs: { tabindex: -1, 'aria-labelledby': `${id}-title` }, data: { focus: `${kind}:${key}`, key } },
    [
      el('header', { class: 'card-head' }, [keyNode, badges]),
      title,
      el('dl', { class: 'card-facts' }, [
        el('div', {}, [el('dt', { text: 'Effort' }), effort]),
        el('div', {}, [el('dt', { text: 'Cost of delay' }), cost]),
      ]),
      releases,
      needs,
    ],
  );
  const item = el('li', { class: kind === 'card' ? 'plank' : 'grave', data: { key } }, [article]);
  return { item, article, key: keyNode, badges, title, effort, cost, releases, needs };
}

function fillCard(parts: CardParts, card: CardView, closed: readonly string[]): void {
  setText(parts.key, card.key);
  setText(parts.title, card.title);
  setText(parts.effort, String(card.effort));
  setText(parts.cost, formulaText(card.cost));
  setText(parts.releases, releasesText(card.cost) ?? '');
  setAttr(parts.releases, 'hidden', releasesText(card.cost) === null);
  const needs = needsText(card.needs, closed);
  setText(parts.needs, needs);
  setAttr(parts.needs, 'hidden', needs === '');
}

function badge(kind: 'must-have' | 'zombie', text: string): HTMLElement {
  return el('span', { class: `badge badge-${kind}`, text, data: { badge: kind } });
}

function setBadges(container: HTMLElement, wanted: readonly ('must-have' | 'zombie')[]): void {
  const have = [...container.children].map((c) => (c as HTMLElement).dataset.badge);
  if (have.length === wanted.length && have.every((b, i) => b === wanted[i])) return;
  container.replaceChildren(...wanted.map((b) => badge(b, b === 'zombie' ? 'Zombie' : 'must-have')));
}

// ---- kept tickets ------------------------------------------------------------------------------------------------------

interface Plank {
  readonly parts: CardParts;
}

function createPlank(key: string): Plank {
  const parts = createCardParts('card', key);
  parts.item.setAttribute('data-ground', 'safehouse');
  return { parts };
}

// ---- buried tickets ----------------------------------------------------------------------------------------------------

interface Grave {
  readonly parts: CardParts;
  readonly why: HTMLElement;
  readonly whyRow: HTMLElement;
  readonly waiting: HTMLElement;
  readonly epitaph: HTMLElement;
  readonly chained: HTMLElement;
  readonly fell: HTMLElement;
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

function createGrave(ctx: Ctx, key: string): Grave {
  const parts = createCardParts('tomb', key);
  parts.item.setAttribute('data-ground', 'yard');

  const why = el('dd');
  const waiting = el('dd', { class: 'num' });
  const facts = parts.article.querySelector('dl') as HTMLElement;
  const whyRow = el('div', { class: 'card-why' }, [el('dt', { text: 'Why' }), why]);
  facts.append(whyRow, el('div', {}, [el('dt', { text: 'Waiting costs' }), waiting]));

  const epitaph = el('p', { class: 'card-epitaph' });
  const chained = el('p', { class: 'card-chained' });
  const fell = el('p', { class: 'card-fell' });

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
  const actions = el('div', { class: 'card-actions' }, [exhume, resurrect, putDown]);

  parts.article.append(epitaph, chained, fell, actions);
  return { parts, why, whyRow, waiting, epitaph, chained, fell, exhume, resurrect, putDown };
}

function fillGrave(grave: Grave, tomb: TombstoneView, index: number, weeks: number, closed: readonly string[]): void {
  fillCard(grave.parts, tomb, closed);
  setBadges(grave.parts.badges, tomb.isZombie ? ['zombie'] : []);
  setText(grave.why, reasonText(tomb.reason));
  setText(grave.waiting, waitingText(tomb.burialCost, weeks));
  setText(grave.epitaph, epitaphFor(tomb, weeks));

  const chained = chainedText(tomb.chainedTo);
  setText(grave.chained, chained);
  setAttr(grave.chained, 'hidden', chained === '');

  const fell = tomb.fell && tomb.reason.kind === 'depends-on-buried' ? fellText(tomb.reason.buriedDependencies) : '';
  setText(grave.fell, fell);
  setAttr(grave.fell, 'hidden', fell === '');

  setAttr(grave.exhume, 'hidden', tomb.isZombie);
  setAttr(grave.resurrect, 'hidden', !tomb.isZombie);
  setAttr(grave.putDown, 'hidden', !tomb.isZombie);

  const item = grave.parts.item;
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
  const planks = el('ul', { class: 'planks', attrs: { role: 'list' }, data: { list: 'safehouse' } });
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
          fillCard(plank.parts, card, closedKeys);
          setBadges(plank.parts.badges, card.mustHave ? ['must-have'] : []);
          return plank.parts.item;
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
          return grave.parts.item;
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
