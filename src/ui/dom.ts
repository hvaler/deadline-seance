/**
 * Small DOM helpers. The only way text enters the page is `textContent` or a text node, so board and user text is never parsed as
 * markup. Nothing here (or anywhere in `src/ui`) uses `innerHTML`; `imports.test.ts` scans for it.
 */

export type Child = Node | string | null | undefined | false;

export interface ElProps {
  readonly class?: string | undefined;
  readonly id?: string | undefined;
  /** Plain text, set with `textContent`. Cannot be combined with children. */
  readonly text?: string | undefined;
  /** Attributes. `undefined`, `null` and `false` leave the attribute out; `true` writes an empty attribute. */
  readonly attrs?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  /** `data-*` attributes, written without the prefix. */
  readonly data?: Readonly<Record<string, string | number | boolean | null | undefined>>;
  /** Event listeners by event name. */
  readonly on?: Readonly<Record<string, (event: Event) => void>>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Attributes that would turn text into behavior or styling: never written from strings. */
function assertSafeAttribute(name: string, value: string): void {
  if (/^on/i.test(name)) throw new Error(`attribute "${name}" is an event handler; use the "on" property`);
  if (name.toLowerCase() === 'style') throw new Error('the style attribute is not allowed; set styles through element.style (CSSOM)');
  if (name.toLowerCase() === 'srcdoc') throw new Error('srcdoc is not allowed');
  if (/^\s*javascript:/i.test(value)) throw new Error(`attribute "${name}" cannot hold a javascript: URL`);
}

function applyProps(node: Element, props: ElProps | undefined): void {
  if (props === undefined) return;
  if (props.class !== undefined) node.setAttribute('class', props.class);
  if (props.id !== undefined) node.id = props.id;
  for (const [name, value] of Object.entries(props.attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    const text = value === true ? '' : String(value);
    assertSafeAttribute(name, text);
    node.setAttribute(name, text);
  }
  for (const [name, value] of Object.entries(props.data ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(`data-${name}`, value === true ? '' : String(value));
  }
  for (const [event, listener] of Object.entries(props.on ?? {})) node.addEventListener(event, listener);
}

function appendChildren(node: Element, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

/** Creates an HTML element. Strings become text nodes. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props?: ElProps, children: readonly Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyProps(node, props);
  if (props?.text !== undefined) node.textContent = props.text;
  appendChildren(node, children);
  return node;
}

/** Creates an SVG element in the SVG namespace. */
export function svgEl(tag: string, props?: ElProps, children: readonly Child[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  if (props?.text !== undefined) node.textContent = props.text;
  appendChildren(node, children);
  return node;
}

/** Writes text only when it changed, so a patch that changes nothing touches nothing. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Sets or removes an attribute only when its value changed. `null`, `undefined` and `false` remove it; `true` writes an empty attribute. */
export function setAttr(node: Element, name: string, value: string | number | boolean | null | undefined): void {
  if (value === null || value === undefined || value === false) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
    return;
  }
  const text = value === true ? '' : String(value);
  assertSafeAttribute(name, text);
  if (node.getAttribute(name) !== text) node.setAttribute(name, text);
}

/** Adds or removes a class only when needed. */
export function setClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

/** Removes every child. */
export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Makes the children of `container` exactly `desired`, in order, touching the DOM only where something is out of place. Elements that
 * are already in the right place are not moved, so their focus and running animations survive. `container` must hold only these children.
 */
export function syncChildren(container: Element, desired: readonly Element[]): void {
  for (let i = 0; i < desired.length; i++) {
    const want = desired[i] as Element;
    const have = container.children[i];
    if (have !== want) container.insertBefore(want, have ?? null);
  }
  while (container.children.length > desired.length) container.lastElementChild?.remove();
}

/** Things created once per key and kept (a ticket's card is the same element for as long as it exists). */
export class Keyed<E> {
  private readonly items = new Map<string, E>();

  constructor(private readonly create: (key: string) => E) {}

  /** The item for `key`, created on first use. */
  get(key: string): E {
    let item = this.items.get(key);
    if (item === undefined) {
      item = this.create(key);
      this.items.set(key, item);
    }
    return item;
  }

  /** Forgets every key that is not in `keep`, so items of tickets that left the board are released. */
  retain(keep: ReadonlySet<string>): void {
    for (const key of [...this.items.keys()]) if (!keep.has(key)) this.items.delete(key);
  }
}

// ---- focus -------------------------------------------------------------------------------------------------------------

/** The `data-focus` id of the focused control (or of the element that contains the focus), if any. */
export function focusIdOf(root: ParentNode, active: Element | null): string | null {
  if (active === null || !(active instanceof HTMLElement)) return null;
  const holder = active.closest<HTMLElement>('[data-focus]');
  return holder !== null && root.contains(holder) ? (holder.dataset.focus ?? null) : null;
}

/**
 * Puts the focus back where it was. Call it after a patch, with the id read before it. If the focus is still somewhere inside `root`
 * it is left alone. Otherwise try `id`, then each of `fallbacks` in order, and finally `last` (for example a section heading).
 * Focus never falls back to the page.
 */
export function restoreFocus(root: ParentNode, id: string | null, fallbacks: readonly string[] = [], last?: HTMLElement | null): void {
  const doc = root instanceof Document ? root : (root as Element).ownerDocument;
  const active = doc.activeElement;
  if (active !== null && active !== doc.body && root.contains(active)) return;
  if (id === null) return;
  for (const candidate of [id, ...fallbacks]) {
    const target = root.querySelector<HTMLElement>(`[data-focus="${candidate.replace(/["\\]/g, '\\$&')}"]`);
    if (target !== null) {
      target.focus();
      return;
    }
  }
  last?.focus();
}
