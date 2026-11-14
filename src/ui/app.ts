import { validateBoard } from '../engine/index';
import type { Board, ValidationError } from '../engine/index';
import { createAnnouncer } from './announcer';
import { startAtmosphere } from './atmosphere/index';
import type { Atmosphere, AtmosphereDeps } from './atmosphere/index';
import { createDecor } from './atmosphere/decor';
import type { Ctx, Part } from './context';
import { derive } from './derive';
import { el } from './dom';
import { mountCandle } from './render/candle';
import { browserObserve, createChainDrawer } from './render/chains';
import { mountGrounds } from './render/grounds';
import { renderInvalidBoard } from './render/invalid-board';
import { mountSign } from './render/sign';
import { mountSurvivors } from './render/survivors';
import { mountTitleCard } from './render/title-card';
import { mountTour } from './render/tour';
import type { TourControls } from './render/tour';
import { mountTools } from './render/tools';
import { browserServices } from './services';
import type { Services } from './services';
import { soundEventFor } from './sound-events';
import { initialStateFor, reducer } from './state';
import type { Action, AppState, Change } from './state';
import { createStore } from './store';
import type { Store } from './store';
import { announcementText } from './text';
import type { Script } from './tour/types';

/**
 * Builds the page and keeps it in step with the state. A board that fails validation never reaches the state: the app shows the list of
 * problems instead (`render/invalid-board.ts`). Every region of the page is a `Part` that draws what the view says and nothing else.
 */

export interface MountedBoard {
  readonly kind: 'board';
  readonly store: Store<AppState, Action>;
  readonly root: HTMLElement;
  /** The guided tour, when the app was given a script. */
  readonly tour: TourControls | null;
  destroy(): void;
}

export interface MountedInvalid {
  readonly kind: 'invalid';
  readonly errors: readonly ValidationError[];
  readonly root: HTMLElement;
  destroy(): void;
}

export type MountedApp = MountedBoard | MountedInvalid;

export interface MountOptions {
  /** Replacements for the impure services (frames, timers, sound), mostly for tests. */
  readonly services?: Partial<Services>;
  /** Starts the fog and the timecode. Left out in tests that do not need them; the page always has the static decoration. */
  readonly atmosphere?: AtmosphereDeps;
  /** The guided tour for this board. Without one, the tour button is the disabled slot it always was. */
  readonly tour?: Script;
}

/** The sections of the page, top to bottom, as `data-region` names. */
export const REGIONS = ['sign', 'candle', 'survivors', 'safehouse', 'yard', 'tools'] as const;
export type Region = (typeof REGIONS)[number];

function section(region: Region, headingId: string, heading: string, extra: { id?: string; focusable?: boolean } = {}): HTMLElement {
  return el(
    'section',
    {
      id: extra.id,
      class: `region region-${region}`,
      attrs: { 'aria-labelledby': headingId, tabindex: extra.focusable === true ? -1 : undefined },
      data: { region },
    },
    [el('h2', { id: headingId, class: 'region-title', text: heading })],
  );
}

export function mountApp(root: HTMLElement, board: Board, options: MountOptions = {}): MountedApp {
  const checked = validateBoard(board);
  if (!checked.ok) {
    renderInvalidBoard(root, checked.error);
    return { kind: 'invalid', errors: checked.error, root, destroy: () => root.replaceChildren() };
  }

  const services: Services = { ...browserServices(), ...options.services };
  const store = createStore(reducer, initialStateFor(checked.value));

  // ---- the page ----
  const header = el('header', { class: 'title-card' });
  const sections = {
    sign: section('sign', 'h-verdict', 'Verdict'),
    candle: section('candle', 'h-candle', 'The candle'),
    survivors: section('survivors', 'h-survivors', 'Survivors'),
    safehouse: section('safehouse', 'h-safehouse', 'Inside the safehouse', { id: 'safehouse', focusable: true }),
    yard: section('yard', 'h-yard', 'Left outside', { id: 'yard', focusable: true }),
    tools: section('tools', 'h-tools', 'Tools'),
  } satisfies Record<Region, HTMLElement>;

  const polite = el('div', { class: 'visually-hidden', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' }, data: { region: 'announcer' } });
  const assertive = el('div', { class: 'visually-hidden', attrs: { role: 'alert', 'aria-atomic': 'true' }, data: { region: 'alerter' } });
  const announcer = createAnnouncer(polite, assertive, services.frame);

  const backLayer = el('div', { class: 'atmosphere atmosphere-back', attrs: { 'aria-hidden': 'true' }, data: { layer: 'back' } });
  const frontLayer = el('div', { class: 'atmosphere atmosphere-front', attrs: { 'aria-hidden': 'true' }, data: { layer: 'front' } });

  const main = el('main', { id: 'main' }, [
    sections.sign,
    sections.candle,
    sections.survivors,
    el('div', { class: 'grounds' }, [sections.safehouse, sections.yard]),
    sections.tools,
  ]);
  const page = el('div', { class: 'page' }, [
    el('a', { class: 'skip-link', attrs: { href: '#safehouse' }, text: 'Skip to the safehouse' }),
    backLayer,
    header,
    main,
    frontLayer,
    polite,
    assertive,
  ]);
  root.replaceChildren(page);
  const decor = createDecor(backLayer, frontLayer);
  const atmosphere: Atmosphere | null = options.atmosphere === undefined ? null : startAtmosphere(decor, options.atmosphere);

  // ---- saying what happened ----
  function settle(change: Change, state: AppState, announce = true): void {
    const view = derive(state);
    if (announce) {
      const text = announcementText(change, view);
      const urgent = change.kind === 'rejected' || change.kind === 'refused' || view.solution.status === 'impossible';
      if (urgent) announcer.alert(text);
      else announcer.say(text);
    }
    const event = soundEventFor(change, view);
    if (event !== null && state.sound) services.sound.play(event);
  }

  const ctx: Ctx = {
    store,
    services,
    announcer,
    root,
    act(action, options) {
      const before = store.getState();
      store.dispatch(action);
      const after = store.getState();
      if (after !== before && action.type !== 'sound/set') settle(after.change, after, options?.announce !== false);
    },
    settle,
  };

  // ---- the regions ----
  let tour: TourControls | null = null;
  const chains = createChainDrawer(services.frame, browserObserve());
  const parts: Part[] = [
    mountTitleCard(header, ctx, options.tour === undefined ? undefined : { onPlay: () => tour?.start('button') }),
    mountSign(sections.sign, ctx),
    mountCandle(sections.candle, ctx),
    mountSurvivors(sections.survivors, ctx),
    mountGrounds(sections.safehouse, sections.yard, ctx, { yardChanged: (field, svg, view) => chains.schedule(field, svg, view) }),
    mountTools(sections.tools, ctx),
  ];

  // ---- keeping the page in step with the state ----
  function render(state: AppState): void {
    const view = derive(state);
    for (const part of parts) part.update(view, state);
  }
  render(store.getState());
  const stop = store.subscribe(render);
  // The tour needs the page to exist (it adds a bar and a prompt to it); #play shows its prompt as soon as it is mounted.
  if (options.tour !== undefined) tour = mountTour({ ctx, script: options.tour, page, main, header });
  const mountedTour = tour;

  return {
    kind: 'board',
    store,
    root,
    tour: mountedTour,
    destroy() {
      mountedTour?.destroy();
      stop();
      for (const part of parts) part.destroy?.();
      chains.destroy();
      atmosphere?.destroy();
      announcer.clear();
      root.replaceChildren();
    },
  };
}
