// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { derive } from '../../src/ui/derive';
import { chainEdges, chainPath, createChainDrawer } from '../../src/ui/render/chains';
import { initialState, reducer } from '../../src/ui/state';
import type { Action } from '../../src/ui/state';
import { FakeFrame, byFocus, mountWith, region } from './harness';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const viewAfter = (...actions: Action[]) => derive(actions.reduce(reducer, initialState()));
const links = (root: ParentNode) => [...root.querySelectorAll<SVGElement>('svg.chains path.chain-link')];

describe('chainPath', () => {
  const a = { x: 0, y: 0, width: 100, height: 60 };
  const b = { x: 200, y: 100, width: 100, height: 60 };

  test('is a cubic curve between the middles of the two boxes', () => {
    expect(chainPath(a, b)).toMatch(/^M 50 30 C 50 \S+, 250 \S+, 250 130$/);
  });

  test('is pure: the same boxes give the same path', () => {
    expect(chainPath(a, b)).toBe(chainPath({ ...a }, { ...b }));
  });

  test('hangs: the control points are below the end points', () => {
    const numbers = (chainPath(a, b).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    // M x1 y1 C cx1 cy1, cx2 cy2, x2 y2
    const [x1, y1, cx1, cy1, cx2, cy2, x2, y2] = numbers as [number, number, number, number, number, number, number, number];
    expect([x1, y1, x2, y2]).toEqual([50, 30, 250, 130]);
    expect(cx1).toBe(x1);
    expect(cx2).toBe(x2);
    expect(cy1).toBeGreaterThan(y1);
    expect(cy2).toBeGreaterThan(y2);
  });

  test('a longer chain sags more, up to a limit', () => {
    const near = chainPath(a, { ...a, x: 10 });
    const far = chainPath(a, { ...a, x: 4000 });
    const sagOf = (path: string): number => {
      const n = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      return (n[3] as number) - (n[1] as number);
    };
    expect(sagOf(far)).toBeGreaterThan(sagOf(near));
    expect(sagOf(far)).toBeLessThanOrEqual(80);
  });

  test('two boxes in the same place give a finite path', () => {
    expect(chainPath(a, a)).toMatch(/^M 50 30 C 50 \d+, 50 \d+, 50 30$/);
  });
});

describe('chainEdges', () => {
  test('at the initial state the only chain is HB-114 to HB-112', () => {
    expect(chainEdges(viewAfter())).toEqual([{ from: 'HB-114', to: 'HB-112' }]);
  });

  test('only buried tickets are chained: further left on the candle, more of the chains are in the yard', () => {
    const view = viewAfter({ type: 'candle/set', step: 3 });
    const buried = new Set(view.yard.map((t) => t.key));
    const edges = chainEdges(view);
    expect(edges.length).toBeGreaterThan(1);
    for (const e of edges) expect(buried.has(e.from) && buried.has(e.to)).toBe(true);
    expect(edges).toContainEqual({ from: 'HB-107', to: 'HB-106' });
    expect(edges).toContainEqual({ from: 'HB-106', to: 'HB-104' });
  });

  test('there are none while the freeze is impossible, and none for a closed ticket', () => {
    expect(chainEdges(viewAfter({ type: 'candle/set', step: 2 }))).toEqual([]);
    expect(chainEdges(viewAfter({ type: 'tombstone/put-down', key: 'HB-112' }))).toEqual([]);
  });

  test('returns copies, not the view itself', () => {
    const view = viewAfter();
    const edges = chainEdges(view);
    expect(edges).toEqual(view.chains);
    expect(edges[0]).not.toBe(view.chains[0]);
  });
});

describe('the chains in the page', () => {
  test('one link is drawn for each chain, in an svg that is decoration', () => {
    const { root } = mountWith();
    const svg = root.querySelector('svg.chains');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(links(root).map((p) => `${p.dataset.from}>${p.dataset.to}`)).toEqual(['HB-114>HB-112']);
    expect(links(root)[0]?.getAttribute('d')).toMatch(/^M /);
  });

  test('the same relation is also written as text, so it does not depend on the drawing', () => {
    const { root } = mountWith();
    expect(root.querySelector('li[data-key="HB-114"] .card-chained')?.textContent).toBe('Chained to HB-112');
  });

  test('the path follows the position of the two tombstones, measured relative to the yard', () => {
    const boxes: Record<string, { left: number; top: number; width: number; height: number }> = {
      'HB-114': { left: 340, top: 400, width: 200, height: 120 },
      'HB-112': { left: 110, top: 150, width: 200, height: 120 },
    };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const box = boxes[this.dataset.key ?? ''] ?? { left: 100, top: 100, width: 0, height: 0 };
      return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => ({}) } as DOMRect;
    });
    const { root } = mountWith();
    const field = root.querySelector('.yard-field')!;
    expect(field).not.toBeNull();
    // The yard itself is at (100, 100): positions are relative to it.
    const d = links(root)[0]?.getAttribute('d');
    expect(d).toBe(chainPath({ x: 240, y: 300, width: 200, height: 120 }, { x: 10, y: 50, width: 200, height: 120 }));
  });

  test('the drawing is redrawn once per frame however many changes came, and the path elements are reused', () => {
    const { root, app, frame } = mountWith();
    const before = links(root)[0];
    app.store.dispatch({ type: 'reserve/set', pct: 5 });
    app.store.dispatch({ type: 'reserve/set', pct: 10 });
    app.store.dispatch({ type: 'survivor/toggle', name: 'Carla' });
    expect(frame.pending).toBe(1);
    frame.flush();
    const after = links(root);
    expect(after).toHaveLength(1);
    expect(after[0]).toBe(before);
  });

  test('chains come and go with the cut: more of them further left, none once the ticket is closed', () => {
    const { root, app, frame } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 3 });
    frame.flush();
    const pairs = links(root).map((p) => `${p.dataset.from}>${p.dataset.to}`);
    expect(pairs).toEqual(expect.arrayContaining(['HB-107>HB-106', 'HB-106>HB-104', 'HB-114>HB-112']));
    expect(pairs).toHaveLength(chainEdges(derive(app.store.getState())).length);

    app.store.dispatch({ type: 'candle/set', step: 10 });
    app.store.dispatch({ type: 'tombstone/put-down', key: 'HB-112' });
    frame.flush();
    expect(links(root)).toEqual([]);
  });

  test('there is no chain while the freeze is impossible', () => {
    const { root, app, frame } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 1 });
    frame.flush();
    expect(links(root)).toEqual([]);
    expect(region(root, 'yard').querySelector('.yard-field')?.hasAttribute('hidden')).toBe(true);
  });

  test('clicking an action in the yard redraws the chains that are left', () => {
    const { root, frame } = mountWith();
    byFocus(root, 'exhume:HB-112').click(); // HB-112 comes back; HB-114 is still buried, but its dependency is kept now
    frame.flush();
    expect(links(root)).toEqual([]);
  });
});

describe('the drawer on its own', () => {
  function field() {
    const f = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    f.append(svg);
    for (const key of ['A', 'B', 'C']) {
      const li = document.createElement('li');
      li.className = 'grave';
      li.dataset.key = key;
      f.append(li);
    }
    document.body.append(f);
    return { f, svg: svg as SVGElement };
  }
  const view = (edges: [string, string][]) => ({ ...viewAfter(), chains: edges.map(([from, to]) => ({ from, to })) });

  test('draws nothing until a frame comes, then once', () => {
    const frame = new FakeFrame();
    const drawer = createChainDrawer(frame);
    const { f, svg } = field();
    drawer.schedule(f, svg, view([['A', 'B']]));
    drawer.schedule(f, svg, view([['A', 'B'], ['B', 'C']]));
    expect(svg.children).toHaveLength(0);
    expect(frame.pending).toBe(1);
    frame.flush();
    expect(svg.children).toHaveLength(2);
  });

  test('skips an edge whose tombstone is not in the yard', () => {
    const frame = new FakeFrame();
    const drawer = createChainDrawer(frame);
    const { f, svg } = field();
    drawer.schedule(f, svg, view([['A', 'Z']]));
    frame.flush();
    expect(svg.children).toHaveLength(0);
  });

  test('redraws when the yard is resized, and stops watching when destroyed', () => {
    const frame = new FakeFrame();
    let notify: () => void = () => {};
    const observed: Element[] = [];
    let disconnected = 0;
    const drawer = createChainDrawer(frame, (callback) => {
      notify = callback;
      return {
        observe: (target) => observed.push(target),
        disconnect: () => {
          disconnected++;
        },
      };
    });
    const { f, svg } = field();
    drawer.schedule(f, svg, view([['A', 'B']]));
    frame.flush();
    expect(observed).toEqual([f]);
    expect(frame.pending).toBe(0);
    notify();
    expect(frame.pending).toBe(1);
    frame.flush();
    expect(svg.children).toHaveLength(1);
    drawer.destroy();
    expect(disconnected).toBe(1);
  });

  test('destroy cancels the pending frame', () => {
    const frame = new FakeFrame();
    const drawer = createChainDrawer(frame);
    const { f, svg } = field();
    drawer.schedule(f, svg, view([['A', 'B']]));
    drawer.destroy();
    expect(frame.pending).toBe(0);
  });
});
