import { deathCertificate, exhume, guardCertificate, nightFacts, putDown, validateBoard } from '../src/engine/index';
import type { ValidBoard } from '../src/engine/index';
import { bad, failure, fromEngine, fromValidation, good } from './errors';
import type { HandlerResult, Outcome } from './errors';
import { buildState, loadBoard, presentBoard } from './request';
import { run } from './run';
import { CertificateInput } from './schemas';
import type { CertificateOutputValue } from './schemas';

/** `death_certificate`: the Markdown note for the night, and the verdict of the number guard on it. */
export function deathCertificateTool(raw: unknown): HandlerResult<CertificateOutputValue> {
  return run(CertificateInput, raw, (input): Outcome<{ structured: CertificateOutputValue; text: string }> => {
    const loaded = loadBoard(input.board);
    if (!loaded.ok) return loaded;
    const state = buildState(loaded.value, input);
    if (!state.ok) return state;
    const present = presentBoard(state.value);
    if (!present.ok) return present;
    // The decisions are applied to the board with the team that is here (as the web app does): exhumes first, then put-downs, each in the order given.
    let current: ValidBoard = present.value;
    for (const key of input.exhumed ?? []) {
      const out = exhume(current, state.value.freeze, key);
      if (!out.ok) return bad(fromEngine(out.error));
      if (out.value.kind === 'rejected') {
        const i = out.value.impossible;
        return bad(
          failure('solution-impossible', `Exhuming ${key} would make the freeze impossible: the must-haves would need ${i.needed} points and the capacity is ${i.capacity}.`, {
            subject: key,
          }),
        );
      }
      current = out.value.board;
    }
    for (const key of input.put_down ?? []) {
      const out = putDown(current, state.value.freeze, key);
      if (!out.ok) return bad(fromEngine(out.error));
      current = out.value.board;
    }
    // Back to the full team: the tickets and put-down keys of the decided board, the people of the request.
    const full = validateBoard({ ...state.value.board, tickets: current.tickets, wontDo: current.wontDo });
    if (!full.ok) return bad(...full.error.map(fromValidation));
    const facts = nightFacts({ home: state.value.home, board: full.value, freeze: state.value.freeze, away: state.value.away, release: input.release ?? state.value.release });
    if (!facts.ok) return bad(fromEngine(facts.error));
    const markdown = deathCertificate(facts.value);
    const guard = guardCertificate(facts.value);
    const structured: CertificateOutputValue = {
      markdown,
      guard: { ok: guard.ok, offending: guard.offending.map((o) => ({ text: o.text, reason: o.reason, at: o.at })) },
    };
    return good({ structured, text: markdown });
  });
}
