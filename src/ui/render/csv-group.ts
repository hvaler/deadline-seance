import { CSV_LIMITS, exportCsv, importCsv } from '../../engine/index';
import type { Board, CsvError } from '../../engine/index';
import type { Ctx, Part } from '../context';
import { el } from '../dom';
import { initialStateFor } from '../model';
import type { AppState } from '../model';
import { releaseFromFileName } from '../release';
import { solveState } from '../solve';
import { describeCsvError } from '../text';

/**
 * "Your tickets": import a Jira CSV (a file picker and a drop zone), download the sample as a CSV, and export the board for Jira. The file is read
 * on this computer (`Services.reader`); nothing is uploaded. A file with errors changes nothing and lists every problem in an announced region.
 */
export interface ImportGroup {
  readonly node: HTMLElement;
  readonly part: Part;
}

export interface ImportHooks {
  /** The banner of the page, to bring into view after an import. */
  readonly banner: () => HTMLElement | null;
}

export const CSV_TYPE = 'text/csv;charset=utf-8';
export const SAMPLE_FILE = 'deadline-seance-sample.csv';
export const EXPORT_FILE = 'deadline-seance-tickets.csv';
export const DEFAULT_NEXT_RELEASE = 'Next release';
export const DEFAULT_CURRENT_RELEASE = 'Current release';
export const DOWNLOADED = 'Download started.';
export const DOWNLOADED_NO_CUT = 'Download started. The freeze is impossible, so Fix Version/s is empty.';
export const UNREADABLE = 'The file could not be read.';

/** What an import takes from the board the app started with. */
function baseOf(board: Board): { people: Board['people']; timeZone: string; nextReleaseWeeks: number; zombieThreshold: number } {
  return { people: board.people, timeZone: board.timeZone, nextReleaseWeeks: board.nextReleaseWeeks, zombieThreshold: board.zombieThreshold };
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function createImportGroup(ctx: Ctx, hooks: ImportHooks): ImportGroup {
  const { services } = ctx;
  const doc = ctx.root.ownerDocument;

  const fileInput = el('input', {
    class: 'csv-file',
    attrs: { type: 'file', accept: '.csv,text/csv', hidden: true, 'aria-label': 'Import Jira CSV', tabindex: -1 },
    data: { focus: 'csv-file' },
  });
  const importButton = el('button', {
    class: 'button button-primary',
    attrs: { type: 'button' },
    data: { action: 'csv-pick', focus: 'csv-pick' },
    text: 'Import Jira CSV',
    on: { click: () => fileInput.click() },
  });
  const sampleButton = el('button', {
    class: 'button',
    attrs: { type: 'button' },
    data: { action: 'csv-sample', focus: 'csv-sample' },
    text: 'Download sample CSV',
    on: { click: () => downloadSample() },
  });
  const exportButton = el('button', {
    class: 'button',
    attrs: { type: 'button' },
    data: { action: 'csv-export', focus: 'csv-export' },
    text: 'Export CSV for Jira',
    on: { click: () => downloadExport() },
  });
  const nextInput = el('input', {
    id: 'csv-next-release',
    class: 'text-field',
    attrs: { type: 'text', maxlength: 60, autocomplete: 'off', value: DEFAULT_NEXT_RELEASE },
    data: { focus: 'csv-next-release' },
  });
  const drop = el('div', { class: 'csv-drop', attrs: { 'aria-hidden': 'true' }, data: { region: 'csv-drop' }, text: 'or drop a .csv file here' });
  const status = el('p', { class: 'csv-status', attrs: { role: 'status' }, data: { region: 'csv-status' } });
  const group = el('div', { class: 'csv-group', attrs: { role: 'group', 'aria-labelledby': 'csv-heading' }, data: { region: 'csv' } }, [
    el('h3', { id: 'csv-heading', class: 'csv-heading', text: 'Your tickets' }),
    el('p', { class: 'csv-hint', text: 'Import an export from Jira, or download the sample, change it and import it back. The file is read on this computer and goes nowhere.' }),
    el('div', { class: 'csv-actions' }, [importButton, sampleButton]),
    drop,
    el('div', { class: 'csv-actions' }, [
      el('label', { class: 'field-label', attrs: { for: 'csv-next-release' }, text: 'Next release name' }),
      nextInput,
      exportButton,
    ]),
    status,
    fileInput,
  ]);

  let errors: HTMLElement | null = null;
  let sayFrame: number | null = null;

  function say(text: string): void {
    status.textContent = '';
    if (sayFrame !== null) services.frame.cancel(sayFrame);
    sayFrame = services.frame.request(() => {
      sayFrame = null;
      status.textContent = text;
    });
  }

  function clearErrors(): void {
    errors?.remove();
    errors = null;
  }

  function showErrors(list: readonly CsvError[]): void {
    clearErrors();
    errors = el('div', { class: 'csv-errors', attrs: { role: 'alert', tabindex: -1 }, data: { region: 'csv-errors' } }, [
      el('h4', { class: 'csv-errors-title', text: 'The file was not imported' }),
      el('ol', { class: 'csv-error-list' }, list.map((e) => el('li', { text: describeCsvError(e) }))),
    ]);
    group.append(errors);
    errors.focus();
  }

  function showMessage(text: string): void {
    clearErrors();
    errors = el('div', { class: 'csv-errors', attrs: { role: 'alert', tabindex: -1 }, data: { region: 'csv-errors' } }, [
      el('h4', { class: 'csv-errors-title', text: 'The file was not imported' }),
      el('p', { text }),
    ]);
    group.append(errors);
    errors.focus();
  }

  // ---- importing ----
  async function handleFile(file: File): Promise<void> {
    clearErrors();
    // The size is checked before anything is read.
    if (file.size > CSV_LIMITS.bytes) return showErrors([{ code: 'file-too-large', row: null, column: null, limit: CSV_LIMITS.bytes }]);
    let text: string;
    try {
      text = await services.reader.read(file);
    } catch {
      return showMessage(UNREADABLE);
    }
    const result = importCsv(text, baseOf(ctx.store.getState().builtIn.board));
    if (!result.ok) return showErrors(result.error);
    ctx.act({
      type: 'board/load',
      board: result.value.board,
      name: file.name,
      release: releaseFromFileName(file.name),
      skipped: result.value.skipped.count,
      warnings: result.value.warnings,
      putDown: result.value.putDownTickets,
    });
    // The button the user pressed is at the bottom of the page and the board changed at the top: show them.
    const banner = hooks.banner();
    if (banner !== null) {
      services.page.reveal(banner, { instant: true });
      banner.focus();
    }
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file !== undefined) void handleFile(file);
    fileInput.value = ''; // choosing the same file again must work
  });

  // ---- the drop zone, and a guard so that a missed drop does not open the file in the tab ----
  const over = (event: DragEvent): void => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    drop.classList.add('is-over');
  };
  drop.addEventListener('dragenter', over);
  drop.addEventListener('dragover', over);
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    drop.classList.remove('is-over');
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) void handleFile(file);
  });
  const guard = (event: Event): void => {
    if (hasFiles(event as DragEvent)) event.preventDefault();
  };
  doc.addEventListener('dragover', guard);
  doc.addEventListener('drop', guard);

  // ---- downloads ----
  const nextRelease = (): string => nextInput.value.replace(/\s+/g, ' ').trim() || DEFAULT_NEXT_RELEASE;

  function downloadSample(): void {
    const built = ctx.store.getState().builtIn;
    const start = solveState(initialStateFor(built.board, built.release));
    const csv = exportCsv({
      board: built.board,
      home: built.board,
      kept: start.status === 'ok' ? new Set(start.kept) : null,
      release: built.release ?? DEFAULT_CURRENT_RELEASE,
      nextRelease: nextRelease(),
    });
    services.files.save(SAMPLE_FILE, csv, CSV_TYPE);
    say(DOWNLOADED);
  }

  function downloadExport(): void {
    const state = ctx.store.getState();
    const solution = solveState(state);
    const kept = solution.status === 'ok' ? new Set(solution.kept) : null;
    const closed = state.source.kind === 'file' ? state.source.putDown : [];
    const csv = exportCsv({ board: state.board, home: state.home, closed, kept, release: state.release ?? DEFAULT_CURRENT_RELEASE, nextRelease: nextRelease() });
    services.files.save(EXPORT_FILE, csv, CSV_TYPE);
    say(kept === null ? DOWNLOADED_NO_CUT : DOWNLOADED);
  }

  // ---- the errors go away with the next thing that replaces the board ----
  let lastChange: AppState['change'] = ctx.store.getState().change;
  return {
    node: group,
    part: {
      update(_view, state) {
        if (state.change === lastChange) return;
        lastChange = state.change;
        if (state.change.kind === 'done' && ['reset', 'load', 'sample'].includes(state.change.subject.kind)) clearErrors();
      },
      destroy() {
        doc.removeEventListener('dragover', guard);
        doc.removeEventListener('drop', guard);
        if (sayFrame !== null) services.frame.cancel(sayFrame);
        group.remove();
      },
    },
  };
}
