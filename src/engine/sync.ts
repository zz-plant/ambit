/**
 * A graph and a ledger that survive the machine they were recorded on.
 * Roadmap §12.8.
 *
 * A long-running agent does not live in one place. It works in containers that
 * are recreated nightly, on a laptop and a workstation, in a cloud session that
 * is thrown away at the end of the task. Ambit's whole claim — that repeated
 * friction becomes visible, that the frontier moved, that this deficit has now
 * cost you four afternoons — depends on a memory longer than any of those, and
 * until now it was one SQLite file with no way out except a portfolio summary
 * of aggregates.
 *
 * `federation` answers "what will this environment say about itself to another
 * environment". This answers a narrower and more private question: "what does
 * this environment need to be itself again somewhere else". Same person, same
 * environment, a different machine.
 *
 * Two things are deliberately not in the file, and neither is an oversight:
 *
 *   Commands. A registered skill's check is a command, and a command that
 *   travels in a data file is a command that executes on the machine that
 *   imports it. The skill comes across as a node with its evidence; its check
 *   is re-registered locally, by whoever is there. This is the same refusal
 *   that keeps `config_patch` declarative and kept `addMcp` off the HTTP API.
 *
 *   Authority. A grant is a statement about what may run unattended *here*.
 *   Importing one would let a permissive machine widen a careful one by moving
 *   a file, which inverts the direction authority is supposed to travel.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Db } from './db.ts';

const SCHEMA_VERSION = 1;

/**
 * The tables that travel, and how a row is identified when it arrives.
 *
 * `key` names the columns that make a row the same row on both machines.
 * `mutable` tables update in place when the incoming row is newer; the rest are
 * append-only observations, and a matching key means it is already here.
 */
const TABLES: Array<{
  table: string;
  columns: string[];
  key: string[];
  mutable?: string;
}> = [
  {
    table: 'capabilities',
    columns: [
      'id',
      'name',
      'domain',
      'description',
      'category',
      'state',
      'unlock_cost_setup',
      'unlock_cost_tokens',
      'unlock_cost_api',
      'maturity_score',
      'kind',
      'lifecycle',
      'created_at',
      'updated_at',
    ],
    key: ['id'],
    mutable: 'updated_at',
  },
  {
    table: 'dependencies',
    columns: ['from_capability', 'to_capability', 'is_hard_requisite', 'description', 'kind'],
    key: ['from_capability', 'to_capability', 'kind'],
  },
  {
    table: 'session_learning',
    columns: ['session_id', 'capability_id', 'action', 'outcome_score', 'notes', 'timestamp'],
    key: ['capability_id', 'action', 'timestamp'],
  },
  {
    table: 'frontier_snapshots',
    columns: ['taken_at', 'frontier_size', 'states', 'kinds', 'verified', 'lifecycles'],
    key: ['taken_at'],
  },
  {
    table: 'failure_signals',
    columns: [
      'source',
      'session_id',
      'tool',
      'class',
      'signal',
      'capability_id',
      'detail',
      'timestamp',
    ],
    key: ['source', 'tool', 'signal', 'timestamp'],
  },
  // Work runs come before anything that references one. The list is applied in
  // order and a row whose foreign key cannot be satisfied is skipped, so an
  // intervention exported without its run was silently dropped on every
  // import — and since successful work became the evidence that earns
  // authority (§13.2), leaving the runs behind meant a rebuilt container lost
  // exactly the record that had been earning it.
  {
    table: 'work_runs',
    columns: [
      'id',
      'goal',
      'run_type',
      'source',
      'started_at',
      'ended_at',
      'outcome',
      'outcome_value_cents',
    ],
    key: ['id'],
  },
  {
    table: 'capability_use',
    columns: ['run_id', 'capability_id', 'used_at', 'duration_seconds', 'source'],
    key: ['run_id', 'capability_id', 'used_at'],
  },
  {
    table: 'human_intervention',
    columns: [
      'run_id',
      'actor_id',
      'kind',
      'capability_id',
      'action',
      'started_at',
      'active_seconds',
      'waiting_seconds',
      'outcome',
    ],
    key: ['run_id', 'actor_id', 'started_at'],
  },
  {
    table: 'outcomes',
    columns: [
      'run_id',
      'achieved',
      'objective_metric',
      'objective_name',
      'value_cents',
      'recorded_at',
    ],
    key: ['run_id', 'recorded_at'],
  },
];

/** Columns a table actually has, so an older database exports what it can. */
function presentColumns(db: Db, table: string, wanted: string[]): string[] {
  try {
    const cols = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c: any) => c.name)
    );
    return wanted.filter(c => cols.has(c));
  } catch {
    return [];
  }
}

/**
 * Writes the graph and the ledger to one file.
 *
 *   ambit sync export ~/Sync/ambit-laptop.json
 *
 * Everything in the file came from the local graph, and nothing in it is a
 * command or a credential. The file is the product; where it goes next — a
 * synced folder, a private repository, a USB stick — is the person's decision,
 * made outside this tool.
 */
function exportSync(db: Db, path?: string) {
  const out: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const spec of TABLES) {
    const cols = presentColumns(db, spec.table, spec.columns);
    if (!cols.length) continue;
    const rows = db.prepare(`SELECT ${cols.join(', ')} FROM ${spec.table}`).all();
    out[spec.table] = rows;
    counts[spec.table] = rows.length;
  }

  // A registered skill travels as a node; its check does not. Naming them is
  // what turns a silent omission into something the importing machine can act
  // on. Only the ones carrying a declared check are named: `skill:` is also
  // where discovery puts the skill files it finds on disk, and listing four
  // dozen of those as "re-register these" would bury the handful that matter.
  const skills = db
    .prepare(
      `SELECT c.id, c.name FROM capabilities c
       JOIN declared_checks d ON d.capability_id = c.id ORDER BY c.id`
    )
    .all<any>();

  const payload = {
    schema: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    environment: process.env.AMBIT_ENV || process.env.HOSTNAME || 'unnamed',
    tables: out,
    checks_not_included: skills.length
      ? skills.map(s => ({
          id: s.id,
          name: s.name,
          reregister: `ambit record ${s.id} --verify="…"`,
        }))
      : undefined,
    excluded: [
      'authority grants',
      'skill check commands',
      'proposals',
      'approval artifacts',
      'budgets',
      'sandboxes',
    ],
  };

  const file = path || 'ambit-sync.json';
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return {
    wrote: file,
    environment: payload.environment,
    // An array rather than a map: the human formatter renders a list of rows
    // and skips a nested object, so a map would silently print nothing.
    tables: Object.entries(counts).map(([table, rows]) => ({ name: table, rows })),
    excluded: payload.excluded,
    note: 'No commands, no grants, no credentials. A skill arrives as a node with its history; re-register its check on the machine that will run it.',
  };
}

/**
 * Merges another machine's file into this graph.
 *
 * Merges, never overwrites. A capability present on both takes the newer of the
 * two by `updated_at`; an observation present on both is already here and is
 * skipped, which is what makes importing the same file twice a no-op. A row
 * whose capability this machine has never heard of is kept, because that is the
 * point — a container recreated from nothing should end up with the history it
 * had, not with the history it can currently explain.
 */
function importSync(db: Db, path?: string) {
  if (!path) return { error: 'Usage: ambit sync import <path>' };
  let payload: any;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e: any) {
    return { error: `Could not read ${path}: ${e?.message || e}` };
  }
  if (!payload?.tables) return { error: `${path} is not an Ambit sync file.` };
  if (payload.schema !== SCHEMA_VERSION) {
    return { error: `${path} is schema ${payload.schema}; this Ambit reads ${SCHEMA_VERSION}.` };
  }

  const added: Record<string, number> = {};
  const updated: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  for (const spec of TABLES) {
    const rows = payload.tables[spec.table];
    if (!Array.isArray(rows) || !rows.length) continue;
    const cols = presentColumns(db, spec.table, spec.columns);
    if (!cols.length) continue;
    added[spec.table] = 0;
    updated[spec.table] = 0;
    skipped[spec.table] = 0;

    const where = spec.key.map(k => `${k} = ?`).join(' AND ');
    const find = db.prepare(
      `SELECT ${spec.mutable ? spec.mutable : spec.key[0]} AS marker FROM ${spec.table} WHERE ${where}`
    );
    const insert = db.prepare(
      `INSERT OR IGNORE INTO ${spec.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    );

    for (const row of rows) {
      const keyValues = spec.key.map(k => row[k] ?? null);
      if (keyValues.some(v => v === null)) {
        skipped[spec.table]++;
        continue;
      }
      const existing = find.get(...(keyValues as any[]));
      if (existing) {
        // Only capabilities are mutable, and only forward in time: an older
        // machine must not undo what a newer one recorded.
        if (
          spec.mutable &&
          row[spec.mutable] &&
          String(row[spec.mutable]) > String(existing.marker)
        ) {
          const setCols = cols.filter(c => !spec.key.includes(c));
          db.prepare(
            `UPDATE ${spec.table} SET ${setCols.map(c => `${c} = ?`).join(', ')} WHERE ${where}`
          ).run(...setCols.map(c => row[c] ?? null), ...(keyValues as any[]));
          updated[spec.table]++;
        } else {
          skipped[spec.table]++;
        }
        continue;
      }
      try {
        insert.run(...cols.map(c => (row[c] === undefined ? null : row[c])));
        added[spec.table]++;
      } catch {
        // A foreign key this machine cannot satisfy yet — an observation about
        // a capability whose node did not come across. Counted, not fatal.
        skipped[spec.table]++;
      }
    }
  }

  return {
    imported: path,
    from: payload.environment,
    exported_at: payload.exported_at,
    merged: Object.keys(added).map(table => ({
      name: table,
      added: added[table],
      updated: updated[table],
      skipped: skipped[table],
    })),
    added,
    updated,
    skipped,
    checks_to_reregister: payload.checks_not_included?.length
      ? payload.checks_not_included
      : undefined,
    note: payload.checks_not_included?.length
      ? 'Skills arrived as nodes. Their checks did not — a command in a data file is a command that runs on import. Re-register each one here.'
      : 'Merged by id and timestamp. Importing the same file again changes nothing.',
  };
}

export { exportSync, importSync, SCHEMA_VERSION };
