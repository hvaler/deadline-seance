import { mountApp } from '../../src/ui/app';
import type { MountedBoard } from '../../src/ui/app';
import { sampleBoard } from '../../src/ui/sample-board';
import type { ClipboardWriter, FileSaver, Frame, Page, Services, SoundPlayer, Timers } from '../../src/ui/services';
import type { Script } from '../../src/ui/tour/types';
import type { SoundEvent } from '../../src/ui/sound-events';
import type { Board } from '../../src/engine/index';

/** Animation frames that run only when the test says so. */
export class FakeFrame implements Frame {
  private next = 1;
  private readonly queue = new Map<number, (time: number) => void>();
  requested = 0;

  request(callback: (time: number) => void): number {
    const id = this.next++;
    this.requested++;
    this.queue.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Runs every callback requested so far (not the ones they request in turn), at `time`. */
  flush(time = 0): void {
    const batch = [...this.queue.entries()];
    this.queue.clear();
    for (const [, callback] of batch) callback(time);
  }
}

/** Timers on a virtual clock. */
export class FakeTimers implements Timers {
  private next = 1;
  private clock = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  set(callback: () => void, ms: number): number {
    const id = this.next++;
    this.timers.set(id, { at: this.clock + ms, callback });
    return id;
  }

  clear(id: number): void {
    this.timers.delete(id);
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Moves the clock forward, running every timer that comes due, in order. */
  advance(ms: number): void {
    const target = this.clock + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (due === undefined) break;
      this.timers.delete(due[0]);
      this.clock = due[1].at;
      due[1].callback();
    }
    this.clock = target;
  }
}

/** A sound player that records what it was asked to do. */
export class RecordingSound implements SoundPlayer {
  enabled = false;
  readonly played: SoundEvent[] = [];
  readonly toggles: boolean[] = [];

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.toggles.push(on);
  }

  play(event: SoundEvent): void {
    if (this.enabled) this.played.push(event);
  }
}

/** A page that records what the tour asks of it, and lets a test set the address hash. */
export class RecordingPage implements Page {
  hashValue: string;
  scrollYValue = 0;
  readonly revealed: { element: Element; instant: boolean }[] = [];
  readonly scrolledTo: number[] = [];
  private readonly listeners = new Set<() => void>();
  constructor(hash = '') {
    this.hashValue = hash;
  }
  hash(): string {
    return this.hashValue;
  }
  onHashChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => void this.listeners.delete(callback);
  }
  /** The address changes: #play typed after the page loaded. */
  changeHash(hash: string): void {
    this.hashValue = hash;
    for (const listener of [...this.listeners]) listener();
  }
  reveal(element: Element, options: { readonly instant: boolean }): void {
    this.revealed.push({ element, instant: options.instant });
  }
  scrollY(): number {
    return this.scrollYValue;
  }
  scrollTo(y: number): void {
    this.scrolledTo.push(y);
    this.scrollYValue = y;
  }
}

/** A clipboard that records what it was asked to write, and that accepts or refuses on request. */
export class RecordingClipboard implements ClipboardWriter {
  /** False: the browser refuses (an insecure page, a denied permission). */
  accepts = true;
  readonly written: string[] = [];
  writeText(text: string): Promise<void> {
    if (!this.accepts) return Promise.reject(new Error('refused'));
    this.written.push(text);
    return Promise.resolve();
  }
}

/** A file saver that records every download it was asked for. */
export class RecordingFiles implements FileSaver {
  readonly saved: { name: string; text: string; type: string }[] = [];
  save(name: string, text: string, type: string): void {
    this.saved.push({ name, text, type });
  }
}

export interface Harness {
  readonly app: MountedBoard;
  readonly root: HTMLElement;
  readonly frame: FakeFrame;
  readonly timers: FakeTimers;
  readonly sound: RecordingSound;
  readonly page: RecordingPage;
  readonly clipboard: RecordingClipboard;
  readonly files: RecordingFiles;
}

/** Mounts the app on a board with fake frames, timers and sound. */
export interface MountExtras {
  /** The guided tour to give the app. */
  readonly tour?: Script;
  /** The address hash the page loads with. */
  readonly hash?: string;
  /** What the release is called, for the death certificate. */
  readonly release?: string;
}

export function mountWith(board: Board = sampleBoard(), overrides: Partial<Services> = {}, extras: MountExtras = {}): Harness {
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  const frame = new FakeFrame();
  const timers = new FakeTimers();
  const sound = new RecordingSound();
  const page = new RecordingPage(extras.hash ?? '');
  const clipboard = new RecordingClipboard();
  const files = new RecordingFiles();
  const app = mountApp(root, board, {
    services: { frame, timers, sound, page, clipboard, files, ...overrides },
    ...(extras.tour === undefined ? {} : { tour: extras.tour }),
    ...(extras.release === undefined ? {} : { release: extras.release }),
  });
  if (app.kind !== 'board') throw new Error('the board should be valid');
  frame.flush(); // the chains are drawn in the first frame after mounting; tests start from a quiet page
  return { app, root, frame, timers, sound, page, clipboard, files };
}

export function region(root: ParentNode, name: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-region="${name}"]`);
  if (node === null) throw new Error(`no region ${name}`);
  return node;
}

export function byFocus(root: ParentNode, id: string): HTMLElement {
  const node = root.querySelector<HTMLElement>(`[data-focus="${id.replace(/["\\]/g, '\\$&')}"]`);
  if (node === null) throw new Error(`nothing has focus id ${id}`);
  return node;
}

export function texts(nodes: Iterable<Element>): string[] {
  return [...nodes].map((n) => n.textContent ?? '');
}

/** The keys of the tickets shown in a list (`safehouse` or `yard`). */
export function shownKeys(root: ParentNode, list: 'safehouse' | 'yard'): string[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-list="${list}"] > li`)].map((li) => li.dataset.key ?? '');
}

/** Sets a range input to a value and fires the `input` event, as a drag or a key press would. */
export function drag(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Fires the `change` event, as the end of a drag does. */
export function release(input: HTMLInputElement): void {
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
