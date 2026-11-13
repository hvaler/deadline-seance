import type { View } from '../derive';
import { svgEl, syncChildren } from '../dom';
import type { Frame } from '../services';

/**
 * The chains between tombstones: when a buried ticket depends on another buried ticket, a hanging chain is drawn from one to the other.
 * The drawing is decoration (`aria-hidden`); the same relation is written as text on the dependent ("Chained to HB-112"). The edges come
 * from the view, which got them from the board's `dependsOn`; nothing here recomputes a closure.
 */

export interface Edge {
  readonly from: string;
  readonly to: string;
}

/** The chains of the view: `from` depends on `to`, and both are buried. */
export function chainEdges(view: View): Edge[] {
  return view.chains.map((c) => ({ from: c.from, to: c.to }));
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const n = (value: number): string => (Math.round(value * 10) / 10).toString();

/**
 * A chain between two cards as an SVG path: a cubic curve between the middles of the two boxes that sags under its own weight, so a
 * chain between neighbours hangs and a chain across the yard swings. Pure: the same boxes give the same path.
 */
export function chainPath(from: Box, to: Box): string {
  const x1 = from.x + from.width / 2;
  const y1 = from.y + from.height / 2;
  const x2 = to.x + to.width / 2;
  const y2 = to.y + to.height / 2;
  const sag = Math.min(80, 16 + Math.hypot(x2 - x1, y2 - y1) / 4);
  return `M ${n(x1)} ${n(y1)} C ${n(x1)} ${n(y1 + sag)}, ${n(x2)} ${n(y2 + sag)}, ${n(x2)} ${n(y2)}`;
}

export interface ChainDrawer {
  /** Asks for a redraw in the next frame, with the latest field, svg and edges. Many calls in one frame cost one redraw. */
  schedule(field: HTMLElement, svg: SVGElement, view: View): void;
  destroy(): void;
}

interface ResizeObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export function createChainDrawer(frame: Frame, observe?: (callback: () => void) => ResizeObserverLike): ChainDrawer {
  let frameId: number | null = null;
  let latest: { field: HTMLElement; svg: SVGElement; edges: Edge[] } | null = null;
  const paths = new Map<string, SVGElement>();
  let observer: ResizeObserverLike | null = null;
  let observed: HTMLElement | null = null;

  function draw(): void {
    frameId = null;
    if (latest === null) return;
    const { field, svg, edges } = latest;

    // One read phase: the boxes of the tombstones involved, relative to the yard.
    const origin = field.getBoundingClientRect();
    const graves = new Map<string, HTMLElement>();
    for (const item of field.querySelectorAll<HTMLElement>('li.grave')) {
      const key = item.dataset.key;
      if (key !== undefined) graves.set(key, item);
    }
    const boxes = new Map<string, Box>();
    const box = (key: string): Box | null => {
      const known = boxes.get(key);
      if (known) return known;
      const grave = graves.get(key);
      if (!grave) return null;
      const r = grave.getBoundingClientRect();
      const b = { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
      boxes.set(key, b);
      return b;
    };

    // One write phase: one path per edge, reused from frame to frame.
    const wanted: SVGElement[] = [];
    const keep = new Set<string>();
    for (const edge of edges) {
      const a = box(edge.from);
      const b = box(edge.to);
      if (a === null || b === null) continue;
      const id = `${edge.from}\u0000${edge.to}`;
      keep.add(id);
      let path = paths.get(id);
      if (path === undefined) {
        path = svgEl('path', { class: 'chain-link', data: { from: edge.from, to: edge.to } });
        paths.set(id, path);
      }
      path.setAttribute('d', chainPath(a, b));
      wanted.push(path);
    }
    for (const id of [...paths.keys()]) if (!keep.has(id)) paths.delete(id);
    syncChildren(svg, wanted);
  }

  return {
    schedule(field, svg, view) {
      latest = { field, svg, edges: chainEdges(view) };
      if (observe !== undefined && observed !== field) {
        observer?.disconnect();
        observer = observe(() => {
          if (frameId === null) frameId = frame.request(draw);
        });
        observer.observe(field);
        observed = field;
      }
      if (frameId === null) frameId = frame.request(draw);
    },
    destroy() {
      if (frameId !== null) frame.cancel(frameId);
      frameId = null;
      observer?.disconnect();
      observer = null;
      observed = null;
      latest = null;
    },
  };
}

/** The platform's ResizeObserver, when there is one. */
export function browserObserve(): ((callback: () => void) => ResizeObserverLike) | undefined {
  const Ctor = (globalThis as { ResizeObserver?: new (callback: () => void) => ResizeObserverLike }).ResizeObserver;
  return Ctor === undefined ? undefined : (callback) => new Ctor(callback);
}
