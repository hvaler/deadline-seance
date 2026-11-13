import type { Frame } from './services';

/**
 * What a screen reader hears. Two hidden live regions: a polite one for ordinary changes and an assertive one (`role="alert"`) for an
 * action that did not happen or a freeze that became impossible. Only one of them holds text at a time. The text is written a frame
 * after it is cleared, so saying the same sentence twice is read twice.
 */
export interface Announcer {
  /** An ordinary change: read when the reader is idle. */
  say(text: string): void;
  /** Something the user should know now. */
  alert(text: string): void;
  /** Empties both regions. */
  clear(): void;
}

export function createAnnouncer(polite: HTMLElement, assertive: HTMLElement, frame: Frame): Announcer {
  let pending: number | null = null;

  function write(target: HTMLElement, other: HTMLElement, text: string): void {
    if (pending !== null) frame.cancel(pending);
    other.textContent = '';
    target.textContent = '';
    pending = frame.request(() => {
      pending = null;
      target.textContent = text;
    });
  }

  return {
    say: (text) => write(polite, assertive, text),
    alert: (text) => write(assertive, polite, text),
    clear() {
      if (pending !== null) frame.cancel(pending);
      pending = null;
      polite.textContent = '';
      assertive.textContent = '';
    },
  };
}
