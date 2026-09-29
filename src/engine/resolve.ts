/**
 * Which node a caller meant by the words it used.
 *
 * An agent names a capability the way it last read one: `combo:shell-execution`
 * from the briefing, `shell-execution` from a plan, `Shell Execution` from a
 * report. The tools took those differently. Some added the `combo:` prefix
 * themselves, one refused a name outright, one simulated the acquisition of an
 * id the graph does not hold and reported a larger frontier for it, and one
 * answered an empty list for a typo, which reads as "no evidence yet". Each was
 * a small choice made where the id arrived, and together they meant an agent
 * could not predict what a slightly wrong id would do.
 *
 * This is the one place that decides. It normalises, which is safe: a missing
 * prefix, a different case, spaces where a hyphen goes. It never guesses. A
 * word that fits no node, or fits two, comes back with the candidates and the
 * caller stops there, because an id chosen on an agent's behalf can be a
 * different capability under a different grant.
 */
import type { Db } from './db.ts';
import { nearest, squash } from '../shared/nearest.ts';

type Resolution =
  | { ok: true; id: string; name: string; via: 'id' | 'combo' | 'name' }
  | {
      ok: false;
      /** `missing`: nothing was given. `unknown`: no node fits. `ambiguous`: more than one does. */
      reason: 'missing' | 'unknown' | 'ambiguous';
      error: string;
      did_you_mean: string[];
    };

type NodeRow = { id: string; name: string; kind: string };

/** What follows the kind prefix: `shell-execution` for `combo:shell-execution`. */
const bodyOf = (id: string) => id.slice(id.indexOf(':') + 1);

function resolveCapability(db: Db, given: unknown): Resolution {
  const word = typeof given === 'string' ? given.trim() : '';
  if (!word) {
    return { ok: false, reason: 'missing', error: 'A capability is needed.', did_you_mean: [] };
  }

  const rows = db.prepare('SELECT id, name, kind FROM capabilities').all() as NodeRow[];
  const byId = new Map(rows.map(r => [r.id, r]));

  const exact = byId.get(word);
  if (exact) return { ok: true, id: exact.id, name: exact.name, via: 'id' };

  // A bare word has always meant a combo: the CLI and three of the tools
  // prefixed it themselves.
  if (!word.includes(':')) {
    const combo = byId.get(`combo:${word}`);
    if (combo) return { ok: true, id: combo.id, name: combo.name, via: 'combo' };
  }

  // Normalised equality, over ids, the part after the kind, and display names.
  // An action is reached by its exact id only: its name (`run_command`) is not
  // unique across the capabilities that confer one.
  const want = squash(word);
  const same = rows.filter(
    r =>
      r.kind !== 'action' &&
      (squash(r.id) === want || squash(bodyOf(r.id)) === want || squash(r.name) === want)
  );
  const combos = same.filter(r => r.id.startsWith('combo:'));
  const pick =
    same.length === 1 ? same[0] : !word.includes(':') && combos.length === 1 ? combos[0] : null;
  if (pick) return { ok: true, id: pick.id, name: pick.name, via: 'name' };
  if (same.length > 1) {
    const ids = same.map(r => r.id);
    return {
      ok: false,
      reason: 'ambiguous',
      error: `"${word}" fits more than one node: ${ids.join(', ')}. Use the full id.`,
      did_you_mean: ids,
    };
  }

  // Nothing fits. Offer what resembles it, once per node however many of its
  // spellings matched.
  const labels = new Map<string, string>();
  for (const r of rows) {
    if (r.kind === 'action') continue;
    for (const label of [r.id, bodyOf(r.id), r.name])
      if (!labels.has(label)) labels.set(label, r.id);
  }
  const close: string[] = [];
  for (const label of nearest(word, [...labels.keys()], 12)) {
    const id = labels.get(label) as string;
    if (!close.includes(id)) close.push(id);
  }
  return {
    ok: false,
    reason: 'unknown',
    error: `No capability "${word}" in this graph.`,
    did_you_mean: close.slice(0, 5),
  };
}

export { resolveCapability, type Resolution };
