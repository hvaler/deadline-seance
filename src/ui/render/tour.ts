import { motionPreference } from '../atmosphere/motion';
import type { MatchMedia } from '../atmosphere/motion';
import type { Ctx } from '../context';
import { el, setAttr, setText } from '../dom';
import type { CertificateControls } from './certificate';
import { createPlayer } from '../tour/player';
import type { TourHost } from '../tour/player';
import { restoreInto } from '../tour/restore';
import type { Phase, Script, Show } from '../tour/types';

/**
 * The guided tour on the page: the prompt for `#play`, the caption bar with its controls, and the effects of a running tour on the page
 * (`main` made inert, a region scrolled into view, a ticket ringed). The player (`tour/player.ts`) decides what happens when; this file only
 * draws it and carries out what the player asks, through the host below. Text enters only through `textContent`.
 *
 * Who speaks: the subtitle is one polite live region that exists only while the bar does. While the tour runs, the app's own announcer says
 * nothing about the tour's changes (`act(..., { announce: false })`), so nothing is spoken twice.
 */
export interface TourControls {
  readonly phase: Phase;
  /** From the header button or the prompt's button: the focus moves to Pause. From the keyboard (Space, Enter): it stays where it is. */
  start(source?: 'button' | 'key'): void;
  stop(): void;
  showPrompt(): void;
  hidePrompt(): void;
  destroy(): void;
}

export interface TourOptions {
  readonly ctx: Ctx;
  readonly script: Script;
  readonly page: HTMLElement;
  readonly main: HTMLElement;
  readonly header: HTMLElement;
  readonly matchMedia?: MatchMedia | undefined;
  /** The death certificate view, for the scene that shows it. The tour closes it whenever the scene is over. */
  readonly certificate?: CertificateControls | undefined;
}

export const PLAY_HASH = '#play';

interface Bar {
  readonly node: HTMLElement;
  readonly caption: HTMLElement;
  readonly count: HTMLElement;
  readonly fill: HTMLElement;
  readonly controls: HTMLElement;
}

export function mountTour(options: TourOptions): TourControls {
  const { ctx, script, page, main, header, certificate } = options;
  const { services } = ctx;
  const doc = ctx.root.ownerDocument;
  const motion = motionPreference(options.matchMedia ?? (typeof window.matchMedia === 'function' ? window.matchMedia.bind(window) : undefined));
  const headerButton = header.querySelector<HTMLButtonElement>('[data-action="tour"]');

  let bar: Bar | null = null;
  let prompt: HTMLElement | null = null;
  let spotted: Element[] = [];
  let savedScroll = 0;
  let pendingCaption: { index: number; total: number; caption: string } | null = null;
  let captionFrame: number | null = null;
  let barReady = false;
  let active = false;
  let pauseButton: HTMLButtonElement | null = null;

  // ---- the host: what the player asks the page to do ----
  const host: TourHost = {
    getState: () => ctx.store.getState(),
    act: (action) => ctx.act(action, { announce: false }),
    restore(state) {
      restoreInto(ctx.store, state);
      services.page.scrollTo(savedScroll);
    },
    show(show) {
      if (show === 'certificate') {
        certificate?.openForTour();
        return;
      }
      certificate?.close({ focus: false });
      const target = regionOf(show);
      if (target === null) return;
      // The region's top is where the eye starts. When the ticket the scene rings would then be under the bar (a tall list on a short or narrow
      // screen), the ticket is brought into view instead: it is what the subtitle is about.
      let reveal: Element = target;
      const ringed = spotted[0];
      if (ringed !== undefined) {
        const room = (doc.defaultView?.innerHeight ?? 0) - (bar?.node.getBoundingClientRect().height ?? 0) - 32;
        if (ringed.getBoundingClientRect().bottom - target.getBoundingClientRect().top > room) reveal = ringed;
      }
      services.page.reveal(reveal, { instant: motion.reduced });
    },
    spot(ids) {
      for (const node of spotted) node.removeAttribute('data-tour-spot');
      spotted = [];
      for (const id of ids) {
        const node = ctx.root.querySelector(`[data-focus="${id.replace(/["\\]/g, '\\$&')}"]`);
        if (node !== null) {
          node.setAttribute('data-tour-spot', '');
          spotted.push(node);
        }
      }
    },
    scene(info) {
      pendingCaption = info;
      if (bar === null) return;
      // A live region only speaks what changes after it exists: the first subtitle waits for the next frame.
      if (!barReady) {
        if (captionFrame === null) captionFrame = services.frame.request(showPending);
        return;
      }
      showPending();
    },
    progress(elapsedMs, totalMs) {
      if (bar === null) return;
      bar.fill.style.setProperty('--p', totalMs === 0 ? '0' : String(elapsedMs / totalMs));
    },
    phase: onPhase,
  };

  const player = createPlayer({ script, host, timers: services.timers });

  function regionOf(show: Show): Element | null {
    if (show === 'top') return page;
    // The fog scenes move the reserve slider and read the strip under it: the reserve control is where to look.
    if (show === 'fog') return ctx.root.querySelector('.reserve');
    return ctx.root.querySelector(`[data-region="${show}"]`);
  }

  function showPending(): void {
    captionFrame = null;
    barReady = true;
    if (bar === null || pendingCaption === null) return;
    setText(bar.caption, pendingCaption.caption);
    setText(bar.count, `${pendingCaption.index + 1} of ${pendingCaption.total}`);
  }

  // ---- the caption bar ----
  function button(text: string, label: string, onClick: () => void, primary = false): HTMLButtonElement {
    return el('button', {
      class: primary ? 'button button-primary' : 'button',
      attrs: { type: 'button', 'aria-label': label },
      text,
      on: { click: onClick },
    });
  }

  function createBar(): Bar {
    const caption = el('p', { class: 'tour-caption', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' }, data: { tour: 'caption' } });
    const count = el('span', { class: 'tour-count' });
    const fill = el('span', { class: 'tour-progress-fill' });
    const controls = el('div', { class: 'tour-controls' });
    const node = el('div', { class: 'tour-bar', data: { region: 'tour' } }, [
      caption,
      el('div', { class: 'tour-meta', attrs: { 'aria-hidden': 'true' } }, [count, el('span', { class: 'tour-progress' }, [fill])]),
      controls,
    ]);
    const skipLink = page.querySelector('.skip-link');
    page.insertBefore(node, skipLink === null ? page.firstChild : skipLink.nextSibling);
    return { node, caption, count, fill, controls };
  }

  function playingControls(paused: boolean): void {
    if (bar === null) return;
    const hadFocus = bar.controls.contains(doc.activeElement);
    const focused = doc.activeElement as HTMLElement | null;
    if (pauseButton === null || !bar.controls.contains(pauseButton)) {
      pauseButton = button('Pause', 'Pause the tour', onPauseToggle, true);
      pauseButton.setAttribute('data-focus', 'tour-pause');
      const skip = button('Skip scene', 'Skip this scene', () => player.skip());
      skip.setAttribute('data-focus', 'tour-skip');
      const stop = button('Stop', 'Stop the tour', () => player.stop());
      stop.setAttribute('data-focus', 'tour-stop');
      bar.controls.replaceChildren(pauseButton, skip, stop);
      if (hadFocus && focused !== null) pauseButton.focus();
    }
    setText(pauseButton, paused ? 'Resume' : 'Pause');
    setAttr(pauseButton, 'aria-label', paused ? 'Resume the tour' : 'Pause the tour');
  }

  function endControls(): void {
    if (bar === null) return;
    const hadFocus = bar.controls.contains(doc.activeElement);
    const again = button('Play again', 'Play the night again', () => start('button'), true);
    again.setAttribute('data-focus', 'tour-again');
    const close = button('Close', 'Close', () => player.stop());
    close.setAttribute('data-focus', 'tour-close');
    pauseButton = null;
    bar.controls.replaceChildren(again, close);
    if (hadFocus) again.focus();
  }

  function onPauseToggle(): void {
    if (player.phase === 'playing') player.pause();
    else if (player.phase === 'paused') player.resume();
  }

  function setInert(on: boolean): void {
    if (on) main.setAttribute('inert', '');
    else main.removeAttribute('inert');
  }

  function removeBar(): void {
    if (captionFrame !== null) {
      services.frame.cancel(captionFrame);
      captionFrame = null;
    }
    bar?.node.remove();
    bar = null;
    pauseButton = null;
    barReady = false;
    pendingCaption = null;
  }

  function onPhase(phase: Phase): void {
    switch (phase) {
      case 'playing':
      case 'paused': {
        if (!active) {
          active = true;
          certificate?.close({ focus: false }); // a note the user had open does not stay under the tour
          hidePrompt();
          ctx.announcer.clear();
          savedScroll = services.page.scrollY();
          if (bar === null) bar = createBar();
          page.classList.add('is-touring');
          setInert(true);
          if (headerButton !== null) headerButton.disabled = true;
        }
        playingControls(phase === 'paused');
        break;
      }      case 'ended':
        active = false;
        certificate?.close({ focus: false });
        setInert(false);
        if (headerButton !== null) headerButton.disabled = false;
        endControls();
        break;
      case 'idle': {
        active = false;
        certificate?.close({ focus: false });
        const hadFocus = bar !== null && bar.node.contains(doc.activeElement);
        removeBar();
        page.classList.remove('is-touring');
        setInert(false);
        if (headerButton !== null) {
          headerButton.disabled = false;
          if (hadFocus || doc.activeElement === null || doc.activeElement === doc.body) headerButton.focus();
        }
        break;
      }
    }
  }

  // ---- starting ----
  function start(source: 'button' | 'key' = 'button'): void {
    if (player.phase === 'playing' || player.phase === 'paused') return;
    player.start();
    if (source === 'button' && pauseButton !== null) pauseButton.focus();
  }

  // ---- the prompt: what `#play` shows instead of starting ----
  function showPrompt(): void {
    if (prompt !== null || player.phase === 'playing' || player.phase === 'paused') return;
    const play = button('Play the night', 'Play the night', () => start('button'), true);
    play.setAttribute('data-action', 'tour-prompt-play');
    const later = button('Not now', 'Not now', hidePrompt);
    later.setAttribute('data-action', 'tour-prompt-close');
    prompt = el('div', { class: 'tour-prompt', attrs: { role: 'group', 'aria-label': 'Play the night' }, data: { region: 'tour-prompt' } }, [
      el('p', { class: 'tour-prompt-text', text: 'Press Space to play the night' }),
      el('p', { class: 'tour-prompt-hint', text: 'Enter works too · Esc to look around first' }),
      ...(ctx.store.getState().source.kind === 'file' ? [el('p', { class: 'tour-prompt-hint', text: 'The tour plays on the sample board. Your tickets come back when it ends.' })] : []),
      el('div', { class: 'tour-prompt-actions' }, [play, later]),
    ]);
    const skipLink = page.querySelector('.skip-link');
    page.insertBefore(prompt, skipLink === null ? page.firstChild : skipLink.nextSibling);
  }

  function hidePrompt(): void {
    prompt?.remove();
    prompt = null;
  }

  /** The key that starts the tour is a user gesture: if sound is on, make sure the audio context is awake inside it. */
  function unlockAudio(): void {
    if (ctx.store.getState().sound) services.sound.setEnabled(true);
  }

  function onKeyCapture(event: KeyboardEvent): void {
    if (prompt === null) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof Element && prompt.contains(target) && target.closest('button') !== null) return; // their own press
    if (event.key === ' ' || event.code === 'Space' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      unlockAudio();
      hidePrompt();
      start('key');
    }
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (player.phase !== 'idle') {
      event.preventDefault();
      player.stop();
    } else if (prompt !== null) {
      event.preventDefault();
      hidePrompt();
    }
  }

  doc.addEventListener('keydown', onKeyCapture, true);
  doc.addEventListener('keydown', onKey);
  const stopWatchingHash = services.page.onHashChange(() => {
    if (services.page.hash() === PLAY_HASH) showPrompt();
  });
  if (services.page.hash() === PLAY_HASH) showPrompt();

  return {
    get phase() {
      return player.phase;
    },
    start,
    stop: () => player.stop(),
    showPrompt,
    hidePrompt,
    destroy() {
      doc.removeEventListener('keydown', onKeyCapture, true);
      doc.removeEventListener('keydown', onKey);
      stopWatchingHash();
      player.dispose();
      certificate?.close({ focus: false });
      for (const node of spotted) node.removeAttribute('data-tour-spot');
      removeBar();
      hidePrompt();
      page.classList.remove('is-touring');
      setInert(false);
    },
  };
}
