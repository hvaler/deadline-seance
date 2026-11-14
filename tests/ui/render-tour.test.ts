// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { sampleBoard } from '../../src/ui/sample-board';
import { sampleScript } from '../../src/ui/tour/sample-script';
import { simulateTour, totalMs } from '../../src/ui/tour/simulate';
import { byFocus, mountWith, region } from './harness';
import type { Harness } from './harness';

afterEach(() => {
  document.body.replaceChildren();
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const sim = simulateTour(sampleScript, mountWith().app.store.getState());

function tourApp(hash = ''): Harness {
  document.body.replaceChildren();
  return mountWith(sampleBoard(), {}, { tour: sampleScript, hash });
}

const bar = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>('[data-region="tour"]');
const prompt = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>('[data-region="tour-prompt"]');
const caption = (root: ParentNode): string => root.querySelector('[data-tour="caption"]')?.textContent ?? '';
const header = (root: ParentNode): HTMLButtonElement => byFocus(root, 'tour') as HTMLButtonElement;
const pause = (root: ParentNode): HTMLButtonElement => byFocus(root, 'tour-pause') as HTMLButtonElement;
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
};
/** Time moves, and the animation frames that follow it (the announcer and the first subtitle wait for one). */
function run(h: Harness, ms: number): void {
  for (let elapsed = 0; elapsed < ms; elapsed += 100) {
    h.timers.advance(100);
    h.frame.flush();
  }
}

describe('the button', () => {
  test('with a tour it is a real button that plays it; the slot and its note are gone', () => {
    const h = tourApp();
    expect(header(h.root).tagName).toBe('BUTTON');
    expect(header(h.root).textContent).toBe('Play the night · 60 s');
    expect(header(h.root).disabled).toBe(false);
    expect(h.root.querySelector('[data-slot="tour"]')).toBeNull();
    expect(h.root.querySelector('#slot-note-tour')).toBeNull();
    expect(h.app.tour).not.toBeNull();
  });

  test('without a script the app has the disabled slot it always had, and no tour', () => {
    const { root, app } = mountWith();
    expect(root.querySelector<HTMLButtonElement>('[data-slot="tour"]')?.disabled).toBe(true);
    expect(app.tour).toBeNull();
    expect(bar(root)).toBeNull();
  });

  test('pressing it starts the tour: the bar, the first subtitle (a frame later), the focus on Pause, the button disabled', () => {
    const h = tourApp();
    header(h.root).focus();
    header(h.root).click();
    expect(h.app.tour?.phase).toBe('playing');
    expect(bar(h.root)).not.toBeNull();
    expect(caption(h.root)).toBe('');
    h.frame.flush();
    expect(caption(h.root)).toBe(sim[0]?.caption);
    expect(document.activeElement).toBe(pause(h.root));
    expect(header(h.root).disabled).toBe(true);
  });
});

describe('while it plays', () => {
  test('every scene sets its subtitle, in order, with the numbers the engine returns', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    h.frame.flush();
    const seen = [caption(h.root)];
    for (let i = 1; i < sim.length; i++) {
      run(h, sim[i - 1]!.scene.durationMs);
      seen.push(caption(h.root));
    }
    expect(seen).toEqual(sim.map((s) => s.caption));
  });

  test('the subtitle is one polite, atomic live region, and the bar is hidden from nothing but its progress line', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    const live = bar(h.root)!.querySelectorAll('[aria-live]');
    expect(live).toHaveLength(1);
    expect(live[0]?.getAttribute('aria-live')).toBe('polite');
    expect(live[0]?.getAttribute('aria-atomic')).toBe('true');
    expect(bar(h.root)!.querySelector('.tour-meta')?.getAttribute('aria-hidden')).toBe('true');
    expect(bar(h.root)!.querySelector('.tour-controls')?.closest('[aria-hidden="true"]')).toBeNull();
  });

  test('the app\'s own announcer says nothing about what the tour does, from start to end (nothing is spoken twice)', () => {
    const h = tourApp();
    h.root.querySelector('[data-region="announcer"]')!.textContent = 'an old sentence';
    h.app.tour?.start('button');
    for (let ms = 0; ms < totalMs(sampleScript); ms += 100) {
      h.timers.advance(100);
      h.frame.flush();
      expect(region(h.root, 'announcer').textContent, `at ${ms} ms`).toBe('');
      expect(region(h.root, 'alerter').textContent, `at ${ms} ms`).toBe('');
    }
    expect(h.app.tour?.phase).toBe('ended');
  });

  test('exactly two live regions exist while it plays: the app\'s silent announcer and the subtitle', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    expect(h.root.querySelectorAll('[aria-live]')).toHaveLength(2);
    expect(h.root.querySelectorAll('[role="alert"]')).toHaveLength(1);
  });

  test('the bar is the first thing after the skip link, so Tab reaches the controls first', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    const page = h.root.querySelector('.page')!;
    expect([...page.children].slice(0, 2).map((n) => n.className.split(' ')[0])).toEqual(['skip-link', 'tour-bar']);
  });

  test('the controls have names that say what they do, and Pause becomes Resume (no aria-pressed)', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    const names = [...bar(h.root)!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Pause the tour', 'Skip this scene', 'Stop the tour']);
    pause(h.root).click();
    expect(pause(h.root).textContent).toBe('Resume');
    expect(pause(h.root).getAttribute('aria-label')).toBe('Resume the tour');
    expect(pause(h.root).hasAttribute('aria-pressed')).toBe(false);
    pause(h.root).click();
    expect(pause(h.root).textContent).toBe('Pause');
  });

  test('the progress line grows from 0 to 1 and is drawn with a scale (a custom property), not a width', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    const fill = bar(h.root)!.querySelector<HTMLElement>('.tour-progress-fill')!;
    expect(Number(fill.style.getPropertyValue('--p'))).toBe(0);
    run(h, totalMs(sampleScript) / 2);
    expect(Number(fill.style.getPropertyValue('--p'))).toBeCloseTo(0.5, 1);
    run(h, totalMs(sampleScript) / 2);
    expect(h.app.tour?.phase).toBe('ended');
    expect(Number(fill.style.getPropertyValue('--p'))).toBe(1);
  });

  test('Pause stops the tour where it is and Resume goes on; Skip goes to the next scene', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    h.frame.flush();
    run(h, 2000);
    pause(h.root).click();
    run(h, 60_000);
    expect(caption(h.root)).toBe(sim[0]?.caption);
    pause(h.root).click();
    byFocus(h.root, 'tour-skip').click();
    h.frame.flush();
    expect(caption(h.root)).toBe(sim[1]?.caption);
  });
});

describe('the page while it plays', () => {
  test('main is inert, and the header, the Sound button, the prompt and the bar have no inert ancestor', () => {
    const h = tourApp('#play');
    const promptNode = prompt(h.root)!;
    expect(promptNode.closest('[inert]')).toBeNull();
    h.app.tour?.start('button');
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(byFocus(h.root, 'sound').closest('[inert]')).toBeNull();
    expect(h.root.querySelector('header')?.closest('[inert]')).toBeNull();
    expect(bar(h.root)!.closest('[inert]')).toBeNull();
    for (const control of bar(h.root)!.querySelectorAll('button')) expect(control.closest('[inert]')).toBeNull();
    expect(byFocus(h.root, 'tour-pause').closest('[inert]')).toBeNull();
    // and the tickets, the sliders and the switches are inside it
    expect(byFocus(h.root, 'candle').closest('[inert]')).not.toBeNull();
    expect(byFocus(h.root, 'reserve').closest('[inert]')).not.toBeNull();
    expect(byFocus(h.root, 'exhume:HB-108').closest('[inert]')).not.toBeNull();
  });

  test('the page is not inert before the tour, after it ends, or after it stops', () => {
    const h = tourApp();
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(false);
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    expect(h.app.tour?.phase).toBe('ended');
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(false);
    h.app.tour?.start('button');
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(true);
    h.app.tour?.stop();
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(false);
    expect(h.root.querySelector('.page')?.classList.contains('is-touring')).toBe(false);
  });

  test('each scene brings its region into view: the sign, the candle, the yard, the safehouse and the reserve control with its strip; smoothly', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    const names = h.page.revealed.map((r) => (r.element as HTMLElement).dataset.region ?? ((r.element as HTMLElement).classList.contains('page') ? 'top' : (r.element as HTMLElement).className));
    expect(names).toEqual(['sign', 'candle', 'sign', 'yard', 'yard', 'safehouse', 'reserve', 'reserve', 'reserve', 'reserve', 'reserve', 'top']);
    expect(h.page.revealed.every((r) => !r.instant)).toBe(true);
  });

  test('when the ticket a scene rings would be under the bar, the ticket is brought into view instead of the top of the region', () => {
    const h = tourApp();
    const proto = Element.prototype;
    const original = proto.getBoundingClientRect;
    const innerHeight = window.innerHeight;
    const box = (top: number, bottom: number): DOMRect => ({ x: 0, y: top, left: 0, right: 0, width: 0, top, bottom, height: bottom - top, toJSON: () => ({}) });
    proto.getBoundingClientRect = function (this: Element): DOMRect {
      const node = this as HTMLElement;
      if (node.dataset.focus === 'tomb:HB-112') return box(469, 884);
      if (node.dataset.region === 'yard') return box(16, 1726);
      if (node.classList.contains('tour-bar')) return box(582, 720);
      return box(0, 0);
    };
    Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
    try {
      h.app.tour?.start('button');
      run(h, 5500 + 6500 + 5000); // scenes 1 to 3: the next one rings HB-112 in the yard
      const zombie = h.page.revealed.at(-1)!;
      expect((zombie.element as HTMLElement).dataset.focus).toBe('tomb:HB-112');
      run(h, 4000); // the put-down scene rings nothing: the region itself
      expect((h.page.revealed.at(-1)!.element as HTMLElement).dataset.region).toBe('yard');
    } finally {
      proto.getBoundingClientRect = original;
      Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true });
    }
  });
  test('under reduced motion the tour still runs with the same scenes and timing, and scrolls instantly', () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = () => ({ matches: true });
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript) - 100);
    expect(h.app.tour?.phase).toBe('playing');
    run(h, 100);
    expect(h.app.tour?.phase).toBe('ended');
    expect(h.page.revealed).toHaveLength(sampleScript.length - 1); // every scene but the certificate one brings a region into view
    expect(h.page.revealed.every((r) => r.instant)).toBe(true);
  });

  test('a scene rings the tickets it talks about while it lasts, and only then', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    const ringed = () => [...h.root.querySelectorAll('[data-tour-spot]')].map((n) => n.getAttribute('data-focus'));
    expect(ringed()).toEqual([]);
    run(h, 5500 + 6500 + 5000); // scenes 1 to 3
    expect(ringed()).toEqual(['tomb:HB-112']);
    run(h, 4000); // the zombie scene is over: HB-112 is put down
    expect(ringed()).toEqual([]);
    run(h, 5000);
    expect(ringed()).toEqual(['card:HB-108']);
    run(h, 6000);
    expect(ringed()).toEqual([]);
    run(h, totalMs(sampleScript));
    expect(h.root.querySelector('[data-tour-spot]')).toBeNull();
  });
});

describe('the user\'s own state', () => {
  test('is the very same state object after the end, after Stop and after Escape', () => {
    const h = tourApp();
    h.app.store.dispatch({ type: 'candle/set', step: 4 });
    h.app.store.dispatch({ type: 'tombstone/put-down', key: 'HB-110' });
    const mine = h.app.store.getState();
    h.page.scrollYValue = 321;
    h.app.tour?.start('button');
    run(h, 10_000);
    expect(h.app.store.getState()).not.toBe(mine);
    byFocus(h.root, 'tour-stop').click();
    expect(h.app.store.getState()).toBe(mine);
    expect(h.page.scrolledTo.at(-1)).toBe(321);
    h.app.tour?.start('button');
    run(h, 10_000);
    press('Escape');
    expect(h.app.store.getState()).toBe(mine);
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    expect(h.app.tour?.phase).toBe('ended');
    expect(h.app.store.getState()).toBe(mine);
  });

  test('sound turned on during the tour stays on', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, 3000);
    byFocus(h.root, 'sound').click();
    expect(h.app.store.getState().sound).toBe(true);
    byFocus(h.root, 'tour-stop').click();
    expect(h.app.store.getState().sound).toBe(true);
  });
});

describe('ending, stopping, playing again', () => {
  test('at the end the bar stays with the last subtitle, Play again and Close; the page is the user\'s again', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    expect(bar(h.root)).not.toBeNull();
    expect(caption(h.root)).toBe(sim.at(-1)?.caption);
    expect([...bar(h.root)!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Play the night again', 'Close']);
    expect(header(h.root).disabled).toBe(false);
  });

  test('the focus goes to Play again when the tour ends while it was in the bar, and stays where it was when it was not', () => {
    const inBar = tourApp();
    inBar.app.tour?.start('button');
    expect(document.activeElement).toBe(pause(inBar.root));
    run(inBar, totalMs(sampleScript));
    expect(document.activeElement).toBe(byFocus(inBar.root, 'tour-again'));
    const elsewhere = tourApp();
    elsewhere.app.tour?.start('key');
    expect(document.activeElement).not.toBe(pause(elsewhere.root));
    run(elsewhere, totalMs(sampleScript));
    expect(document.activeElement).toBe(document.body);
  });

  test('Play again runs it once more; Close removes the bar and puts the focus on the header button', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    byFocus(h.root, 'tour-again').click();
    expect(h.app.tour?.phase).toBe('playing');
    h.frame.flush();
    expect(caption(h.root)).toBe(sim[0]?.caption);
    run(h, totalMs(sampleScript));
    byFocus(h.root, 'tour-close').click();
    expect(bar(h.root)).toBeNull();
    expect(h.app.tour?.phase).toBe('idle');
    expect(document.activeElement).toBe(header(h.root));
  });

  test('Stop, Escape and Close return the focus to the header button; a key start leaves it alone until then', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    byFocus(h.root, 'tour-stop').click();
    expect(document.activeElement).toBe(header(h.root));
    h.app.tour?.start('key');
    press('Escape');
    expect(h.app.tour?.phase).toBe('idle');
    expect(bar(h.root)).toBeNull();
    expect(document.activeElement).toBe(header(h.root));
  });

  test('Escape does nothing when there is no tour and no prompt', () => {
    const h = tourApp();
    const event = press('Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(h.app.tour?.phase).toBe('idle');
  });

  test('destroying the app in the middle of a tour clears the timer, the ring, the bar and the inert', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, 20_000);
    const main = h.root.querySelector('main')!;
    h.app.destroy();
    expect(h.timers.pending).toBe(0);
    expect(h.root.querySelector('[data-tour-spot]')).toBeNull();
    expect(main.hasAttribute('inert')).toBe(false);
    press('Escape'); // no listener is left to throw
  });
});

describe('#play: a prompt, not a start', () => {
  test('the page loads with the prompt, and nothing starts by itself', () => {
    const h = tourApp('#play');
    expect(prompt(h.root)?.querySelector('.tour-prompt-text')?.textContent).toBe('Press Space to play the night');
    expect(h.app.tour?.phase).toBe('idle');
    expect(bar(h.root)).toBeNull();
    run(h, 20_000);
    expect(h.app.tour?.phase).toBe('idle');
    expect(h.app.store.getState().change.kind).toBe('none');
  });

  test('without the hash there is no prompt; with another hash there is none', () => {
    expect(prompt(tourApp().root)).toBeNull();
    expect(prompt(tourApp('#top').root)).toBeNull();
  });

  test('the prompt is early in the document and has a real button to play and one to look around first', () => {
    const h = tourApp('#play');
    const page = h.root.querySelector('.page')!;
    expect([...page.children].slice(0, 2).map((n) => n.className.split(' ')[0])).toEqual(['skip-link', 'tour-prompt']);
    expect([...prompt(h.root)!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Play the night', 'Not now']);
    expect(prompt(h.root)?.getAttribute('aria-label')).toBe('Play the night');
  });

  for (const key of [' ', 'Enter']) {
    test(`pressing ${key === ' ' ? 'Space' : key} anywhere starts the tour, removes the prompt, keeps the page from scrolling and leaves the focus alone`, () => {
      const h = tourApp('#play');
      const event = press(key);
      expect(event.defaultPrevented).toBe(true);
      expect(h.app.tour?.phase).toBe('playing');
      expect(prompt(h.root)).toBeNull();
      expect(bar(h.root)).not.toBeNull();
      expect(document.activeElement).toBe(document.body);
      h.frame.flush();
      expect(caption(h.root)).toBe(sim[0]?.caption);
    });
  }

  test('other keys, and Space with a modifier, do nothing', () => {
    const h = tourApp('#play');
    for (const init of [{ key: 'a' }, { key: 'Tab' }, { key: 'ArrowDown' }, { key: ' ', ctrlKey: true }, { key: ' ', altKey: true }, { key: 'Enter', metaKey: true }]) {
      const event = press(init.key, init);
      expect(event.defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(h.app.tour?.phase).toBe('idle');
    expect(prompt(h.root)).not.toBeNull();
  });

  test('Escape and "Not now" remove the prompt without starting; the tour button still works', () => {
    const a = tourApp('#play');
    press('Escape');
    expect(prompt(a.root)).toBeNull();
    expect(a.app.tour?.phase).toBe('idle');
    const b = tourApp('#play');
    (b.root.querySelector('[data-action="tour-prompt-close"]') as HTMLButtonElement).click();
    expect(prompt(b.root)).toBeNull();
    expect(b.app.tour?.phase).toBe('idle');
    header(b.root).click();
    expect(b.app.tour?.phase).toBe('playing');
  });

  test('the prompt\'s own button starts the tour and puts the focus on Pause', () => {
    const h = tourApp('#play');
    (h.root.querySelector('[data-action="tour-prompt-play"]') as HTMLButtonElement).click();
    expect(h.app.tour?.phase).toBe('playing');
    expect(prompt(h.root)).toBeNull();
    expect(document.activeElement).toBe(pause(h.root));
  });

  test('a press on the prompt\'s own button is its own: the key handler leaves it alone', () => {
    const h = tourApp('#play');
    const play = h.root.querySelector('[data-action="tour-prompt-play"]') as HTMLButtonElement;
    play.focus();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    play.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(h.app.tour?.phase).toBe('idle');
  });

  test('changing the address to #play after the page loaded shows the prompt (and #play again after a run does too)', () => {
    const h = tourApp();
    expect(prompt(h.root)).toBeNull();
    h.page.changeHash('#play');
    expect(prompt(h.root)).not.toBeNull();
    press(' ');
    run(h, totalMs(sampleScript));
    byFocus(h.root, 'tour-close').click();
    expect(prompt(h.root)).toBeNull(); // it does not come back by itself
    h.page.changeHash('#other');
    expect(prompt(h.root)).toBeNull();
    h.page.changeHash('#play');
    expect(prompt(h.root)).not.toBeNull();
  });

  test('no prompt appears while a tour is running', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    h.page.changeHash('#play');
    expect(prompt(h.root)).toBeNull();
  });

  test('the key that starts the tour is a gesture: with sound on it wakes the audio context inside the key press, with sound off it does not touch it', () => {
    const on = tourApp('#play');
    byFocus(on.root, 'sound').click();
    expect(on.app.store.getState().sound).toBe(true);
    const before = on.sound.toggles.length;
    press(' ');
    expect(on.sound.toggles.slice(before)).toEqual([true]);
    const off = tourApp('#play');
    press(' ');
    expect(off.sound.toggles).toEqual([]);
  });
});

describe('sound', () => {
  test('with sound off the tour plays nothing and never turns sound on', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    expect(h.sound.played).toEqual([]);
    expect(h.sound.toggles).toEqual([]);
  });

  test('with sound on the tour plays the sounds of its actions, as the user\'s own would, and still never toggles it', () => {
    const h = tourApp();
    byFocus(h.root, 'sound').click();
    const toggles = h.sound.toggles.length;
    h.app.tour?.start('button');
    run(h, totalMs(sampleScript));
    expect(h.sound.played).toEqual(['bury', 'cascade', 'put-down', 'resurrect', 'bury', 'bury', 'bury']);
    expect(h.sound.toggles.length).toBe(toggles);
  });
});

describe('the death certificate scene', () => {
  const dialog = (root: ParentNode): HTMLElement | null => root.querySelector<HTMLElement>('[data-region="certificate"]');
  const BEFORE = 5500 + 6500 + 5000 + 4000 + 5000 + 6000; // scenes 1 to 6

  test('opens the note over the page, above the bar, for the state the story has reached, and closes it when the scene is over', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, BEFORE - 100);
    expect(dialog(h.root)).toBeNull();
    run(h, 200);
    expect(caption(h.root)).toBe('One note for the stakeholders: what is out, and why.');
    const d = dialog(h.root)!;
    expect(d.classList.contains('is-tour')).toBe(true);
    expect(d.textContent).toContain('Freeze: Wed 2026-11-18 18:00');
    expect(d.textContent).toContain('HB-108, Transaction search: 8 points, cost of delay 10. Pushed out: HB-105 (11), HB-109 (15).');
    expect(d.textContent).toContain("HB-112, Multi-currency wallet: closed as Won't Do. Blocks HB-114.");
    expect(d.textContent).toContain('- Ana'.slice(2));
    // the bar and the page: the bar is live, the page is inert, the note is inert and hidden from assistive technology
    expect(bar(h.root)?.closest('[inert]')).toBeNull();
    expect(h.root.querySelector('main')?.hasAttribute('inert')).toBe(true);
    expect(d.hasAttribute('inert')).toBe(true);
    expect(d.getAttribute('aria-hidden')).toBe('true');
    run(h, 4000);
    expect(dialog(h.root)).toBeNull();
    expect(caption(h.root)).toBe('0 % reserve: the cut holds on 0 of 1,000 nights.');
  });

  test('the tour does not move the focus into the note, and the note is the only extra thing on the page', () => {
    const h = tourApp();
    h.app.tour?.start('key');
    run(h, BEFORE + 100);
    expect(dialog(h.root)?.contains(document.activeElement)).toBe(false);
    expect(h.root.querySelectorAll('[data-region="certificate"]')).toHaveLength(1);
    // the subtitle is the only live region that says anything: the note's status line is empty, inert and hidden, the announcer is silent
    const speaking = [...h.root.querySelectorAll('[aria-live], [role="status"], [role="alert"]')].filter((n) => (n.textContent ?? '').trim() !== '' && n.closest('[inert], [aria-hidden="true"]') === null);
    expect(speaking.map((n) => n.getAttribute('data-tour'))).toEqual(['caption']);
  });

  test('stopping the tour while the note is shown closes it and restores the state', () => {
    const h = tourApp();
    const before = h.app.store.getState();
    h.app.tour?.start('button');
    run(h, BEFORE + 1000);
    expect(dialog(h.root)).not.toBeNull();
    h.app.tour?.stop();
    expect(dialog(h.root)).toBeNull();
    expect(h.app.store.getState()).toBe(before);
    expect(h.root.querySelector('[inert]')).toBeNull();
  });

  test('Esc stops the tour and takes the note away', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, BEFORE + 1000);
    press('Escape');
    expect(h.app.tour?.phase).toBe('idle');
    expect(dialog(h.root)).toBeNull();
  });

  test('skipping the scene that shows it, and playing the tour to its end, leave no note behind', () => {
    const h = tourApp();
    h.app.tour?.start('button');
    run(h, BEFORE + 1000);
    byFocus(h.root, 'tour-skip').click();
    expect(dialog(h.root)).toBeNull();
    run(h, totalMs(sampleScript));
    expect(h.app.tour?.phase).toBe('ended');
    expect(dialog(h.root)).toBeNull();
  });
});
