// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { REGIONS, mountApp } from '../../src/ui/app';
import type { MountedBoard } from '../../src/ui/app';
import { sampleBoard } from '../../src/ui/sample-board';

let root: HTMLElement;

function mount(): MountedBoard {
  root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const app = mountApp(root, sampleBoard());
  if (app.kind !== 'board') throw new Error('the sample board should be valid');
  return app;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the page shell', () => {
  test('has one h1, a skip link to the safehouse, a header and a main landmark', () => {
    mount();
    expect(root.querySelectorAll('h1')).toHaveLength(1);
    expect(root.querySelector('h1')?.textContent).toBe('Night of the Living Backlog');
    expect(root.querySelector('header')).not.toBeNull();
    expect(root.querySelectorAll('main')).toHaveLength(1);
    const skip = root.querySelector<HTMLAnchorElement>('a.skip-link');
    expect(skip?.getAttribute('href')).toBe('#safehouse');
    expect(skip?.textContent).toBe('Skip to the safehouse');
    expect(root.querySelector('#safehouse')).not.toBeNull();
  });

  test('shows the product line above the title', () => {
    mount();
    const line = root.querySelector('.product-line');
    expect(line?.textContent).toBe('Hollow Bank app 3.2 · release eve');
    expect(line?.nextElementSibling?.tagName).toBe('H1');
  });

  test('has the six regions in the order of the brief, each labelled by its own heading', () => {
    mount();
    const regions = [...root.querySelectorAll<HTMLElement>('[data-region]')].map((r) => r.dataset.region).filter((r) => (REGIONS as readonly string[]).includes(r ?? ''));
    expect(regions).toEqual(['sign', 'candle', 'survivors', 'safehouse', 'yard', 'tools']);
    for (const region of REGIONS) {
      const section = root.querySelector<HTMLElement>(`section[data-region="${region}"]`);
      expect(section, region).not.toBeNull();
      const labelledBy = section?.getAttribute('aria-labelledby') ?? '';
      expect(root.querySelector(`h2#${labelledBy}`)?.textContent?.length, region).toBeGreaterThan(0);
    }
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'Verdict',
      'The candle',
      'Survivors',
      'Inside the safehouse',
      'Left outside',
      'Tools',
    ]);
  });

  test('the two grounds sit side by side in one container', () => {
    mount();
    const grounds = root.querySelector('.grounds');
    expect([...(grounds?.children ?? [])].map((c) => (c as HTMLElement).dataset.region)).toEqual(['safehouse', 'yard']);
  });

  test('the grounds can receive programmatic focus (tabindex -1) but are not in the tab order', () => {
    mount();
    for (const id of ['safehouse', 'yard']) expect(root.querySelector(`#${id}`)?.getAttribute('tabindex')).toBe('-1');
    expect([...root.querySelectorAll('[tabindex]')].every((n) => Number(n.getAttribute('tabindex')) <= 0)).toBe(true);
  });

  test('has a hidden polite live region, a hidden alert region, and two aria-hidden decoration layers', () => {
    mount();
    const announcer = root.querySelector('[data-region="announcer"]');
    expect(announcer?.getAttribute('aria-live')).toBe('polite');
    expect(announcer?.getAttribute('aria-atomic')).toBe('true');
    expect(announcer?.classList.contains('visually-hidden')).toBe(true);
    const alerter = root.querySelector('[data-region="alerter"]');
    expect(alerter?.getAttribute('role')).toBe('alert');
    expect(alerter?.classList.contains('visually-hidden')).toBe(true);
    const layers = [...root.querySelectorAll('.atmosphere')];
    expect(layers.map((l) => (l as HTMLElement).dataset.layer)).toEqual(['back', 'front']);
    for (const layer of layers) expect(layer.getAttribute('aria-hidden')).toBe('true');
  });

  test('the guided tour is an inert, disabled slot with a note that explains it', () => {
    mount();
    const tour = root.querySelector<HTMLButtonElement>('[data-slot="tour"]');
    expect(tour?.disabled).toBe(true);
    expect(tour?.textContent).toBe('Play the night · 60 s');
    const noteId = tour?.getAttribute('aria-describedby') ?? '';
    expect(root.querySelector(`#${noteId}`)?.textContent).toBe('The guided tour is not built yet.');
  });
});

describe('the sound button', () => {
  test('starts off, and toggles through the store', () => {
    const app = mount();
    const button = root.querySelector<HTMLButtonElement>('button[data-action="sound"]');
    expect(button?.textContent).toBe('Sound off');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(app.store.getState().sound).toBe(false);

    button?.click();
    expect(app.store.getState().sound).toBe(true);
    expect(button?.textContent).toBe('Sound on');
    expect(button?.getAttribute('aria-pressed')).toBe('true');

    button?.click();
    expect(app.store.getState().sound).toBe(false);
    expect(button?.textContent).toBe('Sound off');
  });

  test('is a real button, so the keyboard works on it', () => {
    mount();
    const button = root.querySelector('button[data-action="sound"]');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
  });

  test('follows the state when it changes from elsewhere', () => {
    const app = mount();
    app.store.dispatch({ type: 'sound/set', on: true });
    expect(root.querySelector('button[data-action="sound"]')?.textContent).toBe('Sound on');
  });
});

describe('mount and destroy', () => {
  test('destroy empties the root and stops listening', () => {
    const app = mount();
    app.destroy();
    expect(root.childNodes).toHaveLength(0);
    app.store.dispatch({ type: 'sound/set', on: true }); // must not throw or draw anything
    expect(root.childNodes).toHaveLength(0);
  });

  test('mounting twice replaces the page instead of stacking another one', () => {
    mount();
    mountApp(root, sampleBoard());
    expect(root.querySelectorAll('h1')).toHaveLength(1);
  });

  test('the initial state of the store is the sample board at Friday 18:00', () => {
    const app = mount();
    expect(app.store.getState()).toMatchObject({ candle: 10, marginPct: 0, away: [], sound: false });
  });
});
