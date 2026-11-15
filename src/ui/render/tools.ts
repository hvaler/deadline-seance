import type { Ctx, Part } from '../context';
import { el, setText } from '../dom';
import { createImportGroup } from './csv-group';

/** Where the MCP server is explained. A link is navigation, not a request: the CSP's connect-src 'none' does not apply to it. */
export const MCP_DOCS_URL = 'https://github.com/hvaler/deadline-seance/blob/main/docs/mcp.md';

/** What the tools need from the rest of the app: what to do when the death certificate button is pressed. */
export interface ToolsHook {
  readonly onCertificate: (opener: HTMLElement) => void;
  /** The banner of your tickets, to bring into view after an import. */
  readonly banner: () => HTMLElement | null;
}

export function mountTools(section: HTMLElement, ctx: Ctx, hook: ToolsHook): Part {
  const reset = el('button', {
    class: 'button button-primary',
    attrs: { type: 'button' },
    data: { action: 'reset', focus: 'reset' },
    text: 'Reset the sample board',
    on: { click: () => ctx.act({ type: 'board/reset' }) },
  });

  const certificate = el('button', {
    class: 'button',
    attrs: { type: 'button', 'aria-haspopup': 'dialog' },
    data: { action: 'certificate', focus: 'certificate' },
    text: 'Death certificate',
    on: { click: (event) => hook.onCertificate(event.currentTarget as HTMLElement) },
  });

  const mcp = el('p', { class: 'mcp-note', data: { note: 'mcp' } }, [
    'The same rule runs as an MCP server for the Kiro agent: see ',
    el('a', { attrs: { href: MCP_DOCS_URL, rel: 'noopener noreferrer' }, text: 'docs/mcp.md' }),
  ]);
  const csv = createImportGroup(ctx, { banner: hook.banner });
  section.append(el('div', { class: 'tools-row' }, [reset, certificate]), csv.node, mcp);
  return {
    update(view, state) {
      setText(reset, state.source.kind === 'built-in' ? 'Reset the sample board' : 'Reset your tickets');
      csv.part.update(view, state);
    },
    destroy: () => csv.part.destroy?.(),
  };
}
