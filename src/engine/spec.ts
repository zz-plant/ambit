/**
 * A spec-driven development spec, read as data, and what its tasks need.
 *
 * `ambit goal "<sentence>"` asks what one goal needs. A spec is the same
 * question asked forty times, once per task, by a document an agent is about
 * to work through: before the first task, which of the capabilities those
 * tasks lean on are reached, which are a step away, which wait on something
 * else, and which are failing their check.
 *
 * Spec Kit writes one feature to `specs/<NNN-feature>/`: `spec.md`, then
 * `plan.md` with its research, data model, contracts and quickstart beside it,
 * then `tasks.md`. `.specify/` holds templates, scripts and memory, and no
 * feature (https://github.com/github/spec-kit/blob/main/spec-driven.md). A task
 * is a checkbox line, `- [ ] T012 [P] [US1] Create User model in src/models/user.py`:
 * an id, `[P]` when it can run in parallel, its user story, and a description
 * naming files (https://github.com/github/spec-kit/blob/main/templates/tasks-template.md).
 * The plan's Technical Context names what the feature is built on under bold
 * labels, and Primary Dependencies, Storage and Testing are the ones whose
 * values are tools (https://github.com/github/spec-kit/blob/main/templates/plan-template.md).
 *
 * OpenSpec writes a change to `openspec/changes/<change>/` (proposal.md,
 * design.md, tasks.md, specs/), and its tasks are the same checkbox lines,
 * numbered by group: `- [ ] 1.1 Create ThemeContext with light/dark state`
 * (https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md).
 * Kiro keeps a tasks.md under `.kiro/specs/<feature>/` too, and its pages do
 * not show the line's format (https://kiro.dev/docs/specs/), so it is read as
 * the plain checkbox list any tasks.md is, and never named as supported.
 *
 * Read as data and nothing else (rule 7). A spec is a file anyone can commit,
 * so a cloned repository's tasks.md has travelled: nothing in it runs, no link
 * in it is followed, no URL fetched, and a fenced block is skipped, since the
 * commands in one are an example and not a task. Only markdown is opened, and
 * in a directory only the three names below, so the flag cannot be pointed at
 * a key file to have it read back a line at a time.
 *
 * The routing is not new. A task line goes through `routeSentence`, the words
 * `ambit goal` matches, and a plan's tools through `detects`, the patterns the
 * seed matches config ids with: one index for intent, one for tool names, the
 * same two the rest of the engine reads.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Db } from './db.ts';
import { routeSentence } from './goals.ts';
import { judgeGoal } from './judge.ts';
import { readableCost } from './next.ts';
import { loadTechTree } from './paths.ts';
import { planFor } from './planning.ts';
import { detects } from './seed/techtree.ts';
import { recheckCommand } from './vocabulary.ts';

const TASKS = 'tasks.md';
const PLAN = 'plan.md';
const SPEC = 'spec.md';

/** Larger than any spec a person writes, and small enough to read without thinking about it. */
const MAX_BYTES = 1_000_000;

/** The Technical Context labels whose values are tools. Language, platform, goals and scale name none. */
const TOOL_FIELDS = new Set(['primary dependencies', 'storage', 'testing']);

/** What a value says when the plan has not decided yet. */
const UNDECIDED = /needs clarification|^(n\/a|none|tbd|-)$/i;

type Format = 'spec-kit' | 'openspec' | 'markdown';

/** One line of work: a task, or a requirement when the spec has no task list yet. */
interface SpecLine {
  id?: string;
  text: string;
}

/** One Technical Context field, as `Storage` and `PostgreSQL 16`. */
interface ContextField {
  field: string;
  value: string;
}

interface ReadSpec {
  format: Format;
  read: string[];
  lines: SpecLine[];
  context: ContextField[];
}

type Failed = { error: string; did_you_mean?: string[] };

/**
 * A line's words, and nothing a terminal or a shell would act on.
 *
 * A link keeps its words and loses its target; an autolink and a bare URL go
 * entirely. Control characters and the bidirectional overrides go too, since
 * the text is printed back and a spec's author chooses every byte of it.
 */
function plainText(raw: string): string {
  return (
    raw
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[a-z][a-z0-9+.-]*:[^>\s]*>/gi, ' ')
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
      .replace(/[`*~]/g, '')
      // An escape sequence goes whole, so a colour code does not leave `[31m` behind.
      .replace(/\p{Cc}\[[0-9;?]*[ -/]*[@-~]/gu, ' ')
      .replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
  );
}

/** A checkbox line, done or not, at any indent. */
const CHECKBOX = /^\s*[-*+]\s+\[[ xX]\]\s+(.+)$/;
/** Spec Kit's `T012`, or OpenSpec's `1.1` and a numbered list's `3.`. */
const TASK_ID = /^(T\d{1,5}|\d{1,3}(?:\.\d{1,3})*)\.?\s+/;
/** `[P]` and `[US1]` after the id. A bracket a link opens is the link's, and stays. */
const MARKERS = /^(?:\[[^\]\n]{1,16}\](?!\()\s*)+/;
/** Spec Kit's `- **FR-001**: System MUST …`. */
const REQUIREMENT = /^\s*[-*+]\s+\*\*((?:N?FR)-\d{1,4})\*\*:?\s*(.+)$/;

/**
 * The lines of one markdown file worth routing, and its Technical Context.
 *
 * Comments are blanked and fenced blocks skipped before anything is read: a
 * template's example tasks sit in both, and none of them is this feature's.
 */
function parseMarkdown(source: string): { lines: SpecLine[]; context: ContextField[] } {
  const text = source.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ''));
  const lines: SpecLine[] = [];
  const context: ContextField[] = [];
  let fence: string | undefined;
  let contextDepth = 0;
  for (const line of text.split(/\r?\n/)) {
    const opens = line.match(/^\s*(`{3,}|~{3,})/);
    if (opens) {
      if (!fence) fence = opens[1][0];
      else if (opens[1][0] === fence) fence = undefined;
      continue;
    }
    if (fence) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const depth = heading[1].length;
      if (/^technical context\b/i.test(heading[2].trim())) contextDepth = depth;
      else if (contextDepth && depth <= contextDepth) contextDepth = 0;
      continue;
    }

    const task = line.match(CHECKBOX);
    if (task) {
      let body = task[1];
      const id = body.match(TASK_ID);
      if (id) body = body.slice(id[0].length);
      body = body.replace(MARKERS, '');
      const said = plainText(body);
      if (said) lines.push({ ...(id ? { id: id[1] } : {}), text: said });
      continue;
    }
    const requirement = line.match(REQUIREMENT);
    if (requirement) {
      const said = plainText(requirement[2]);
      if (said) lines.push({ id: requirement[1], text: said });
      continue;
    }
    if (contextDepth) {
      const field = line
        .replace(/\*/g, '')
        .replace(/^\s*[-+]\s+/, '')
        .match(/^\s*([A-Za-z][A-Za-z /-]{1,40}?)\s*:\s*(.+)$/);
      if (!field || !TOOL_FIELDS.has(field[1].toLowerCase())) continue;
      const value = plainText(field[2]);
      if (value && !UNDECIDED.test(value)) context.push({ field: field[1], value });
    }
  }
  return { lines, context };
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The feature directories under a repository's root, for a `--spec` pointed one level too high. */
function featuresUnder(root: string, shown: string): string[] {
  const found: string[] = [];
  for (const parent of ['specs', join('openspec', 'changes'), join('.kiro', 'specs')]) {
    let names: string[] = [];
    try {
      names = readdirSync(join(root, parent)).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (name === 'archive') continue;
      if ([TASKS, PLAN, SPEC].some(f => isFile(join(root, parent, name, f))))
        found.push(join(shown, parent, name));
    }
  }
  return found.slice(0, 10);
}

/** Which tool wrote a spec, from where it sits and what is beside it. */
function formatOf(dir: string, lines: SpecLine[]): Format {
  const beside = (name: string) => isFile(join(dir, name));
  if (beside('proposal.md') || /openspec[\\/]changes[\\/]/.test(dir)) return 'openspec';
  if (beside(PLAN) || beside(SPEC) || lines.some(l => /^T\d+$/.test(l.id ?? ''))) return 'spec-kit';
  return 'markdown';
}

/**
 * Reads a spec directory or one markdown file in it.
 *
 * In a directory, tasks.md is the work and plan.md says what it is built on.
 * spec.md is read for its requirements only while there is no task list,
 * since the tasks are written from it and every need would count twice.
 */
function readSpec(path: string): ReadSpec | Failed {
  const at = resolve(path);
  let isDir: boolean;
  try {
    isDir = statSync(at).isDirectory();
  } catch {
    return { error: `No spec at ${path}.` };
  }
  let dir = at;
  let files: string[];
  if (isDir) {
    const present = [TASKS, PLAN, SPEC].filter(f => isFile(join(at, f)));
    if (!present.length) {
      const features = featuresUnder(at, path);
      return {
        error: `${path} holds no ${TASKS}, ${PLAN} or ${SPEC}. Name a feature's directory, such as specs/001-name or openspec/changes/name.`,
        ...(features.length ? { did_you_mean: features } : {}),
      };
    }
    files = present.filter(f => f !== SPEC || !present.includes(TASKS));
  } else {
    if (!/\.md$/i.test(at))
      return { error: `${path} is not markdown: a spec is a directory or a .md file.` };
    dir = dirname(at);
    files = [basename(at)];
  }

  const lines: SpecLine[] = [];
  const context: ContextField[] = [];
  for (const name of files) {
    const file = join(dir, name);
    if (statSync(file).size > MAX_BYTES)
      return { error: `${name} is over a megabyte; a spec that size is not one to read whole.` };
    const parsed = parseMarkdown(readFileSync(file, 'utf8'));
    lines.push(...parsed.lines);
    context.push(...parsed.context);
  }
  return { format: formatOf(dir, lines), read: files, lines, context };
}

interface Need {
  id: string;
  name: string;
  status?: 'reached' | 'failing' | 'next' | 'blocked';
  /** The task ids that routed here, or a task's words where it had no id. */
  tasks: string[];
  /** The Technical Context fields that named a tool providing it. */
  plan?: string[];
  blocked_by?: string[];
  check?: string;
}

/**
 * What a spec's tasks need, against this graph.
 *
 * Each task line is routed the way `ambit goal "<sentence>"` routes one, and a
 * line only counts toward the capability the vocabulary would recommend for it:
 * the others it brushes are a shortlist for a person, not a requirement. Each
 * need is then planned with `planFor`, and the steps of every plan are merged in
 * the order the first plan to name each one put it, which keeps a prerequisite
 * ahead of whatever needs it, so the gap reads top to bottom the way one goal's
 * plan does.
 */
function specGoal(db: Db, path?: string) {
  if (!path) return { error: 'Usage: ambit goal --spec <a spec directory, or its tasks.md>' };
  const spec = readSpec(path);
  if ('error' in spec) return spec;
  if (!spec.lines.length && !spec.context.length) {
    return {
      error: `No tasks in ${spec.read.join(', ')}: a task is a checkbox line, "- [ ] T001 Create the project".`,
    };
  }

  const needs = new Map<string, Need>();
  const need = (id: string, name: string): Need => {
    let n = needs.get(id);
    if (!n) {
      n = { id, name, tasks: [] };
      needs.set(id, n);
    }
    return n;
  };
  const unrouted: SpecLine[] = [];
  for (const line of spec.lines) {
    const { ranked, recommended } = routeSentence(line.text);
    const hit = ranked.find(r => r.id === recommended);
    if (hit) need(hit.id, hit.name).tasks.push(line.id ?? line.text);
    else unrouted.push(line);
  }
  const tree = loadTechTree();
  for (const field of spec.context) {
    for (const node of tree.nodes ?? []) {
      if (!detects(node, field.value)) continue;
      const n = need(`combo:${node.id}`, node.name);
      n.plan = [...new Set([...(n.plan ?? []), field.field])];
    }
  }

  // A capstone is reached by its steps and is not a step of its own.
  const capstone = new Set(
    (tree.nodes ?? []).filter((n: any) => n.detect?.requires_met).map((n: any) => `combo:${n.id}`)
  );
  const steps = new Map<string, any>();
  const failing = new Map<string, { id: string; name: string; check: string }>();
  for (const n of needs.values()) {
    const plan = planFor(db, n.id) as any;
    // A node the tree routes to and this graph has not seeded yet: said by
    // `seed`, and never given a status the graph did not compute.
    if (plan.error) continue;
    if (plan.degraded === true) {
      n.status = 'failing';
      n.check = recheckCommand(n.id);
      failing.set(n.id, { id: n.id, name: n.name, check: n.check });
      continue;
    }
    if (plan.steps === 0) {
      n.status = 'reached';
      continue;
    }
    const before = (plan.order as any[]).filter(s => s.id !== n.id);
    const broken = Array.isArray(plan.degraded)
      ? (plan.degraded as { id: string; name: string }[])
      : [];
    for (const d of broken) failing.set(d.id, { ...d, check: recheckCommand(d.id) });
    n.status = before.length || broken.length ? 'blocked' : 'next';
    if (n.status === 'blocked')
      n.blocked_by = [...before.map(s => s.name), ...broken.map(d => d.name)];
    for (const step of plan.order as any[]) {
      if (capstone.has(step.id)) continue;
      const known = steps.get(step.id);
      if (!known) steps.set(step.id, { ...step, for: step.id === n.id ? [] : [n.name] });
      else if (step.id !== n.id && !known.for.includes(n.name)) known.for.push(n.name);
    }
  }

  const gap = [...steps.values()].map(({ options, preference_conflicts, ...s }) => ({
    ...s,
    for: needs.has(s.id) || !s.for.length ? undefined : s.for,
  }));
  const position = new Map(gap.map((s, i) => [s.id, i]));
  const rank = (n: Need) =>
    n.status === 'reached' ? -2 : n.status === 'failing' ? -1 : (position.get(n.id) ?? gap.length);
  const ordered = [...needs.values()].sort((a, b) => rank(a) - rank(b));
  const seconds = gap.reduce((sum, s) => sum + (s.setup_seconds || 0), 0);
  return {
    spec: path,
    format: spec.format,
    read: spec.read,
    tasks: spec.lines.length,
    routed: spec.lines.length - unrouted.length,
    needs: ordered,
    steps: gap,
    ...(seconds ? { setup_seconds: seconds, estimated_setup: readableCost(seconds) } : {}),
    failing: [...failing.values()],
    unrouted,
  };
}

/**
 * Puts the tasks the vocabulary could not route to a judgment model on this
 * machine, the way `ambit goal --judge` puts one sentence. Loopback only, by
 * `judgeUrl`; a suggestion is attached to its task and never becomes a need,
 * since a probability is not a match. The first failure stops the asking, so
 * a judge that is not running costs one timeout and not one per task.
 */
async function judgeUnrouted(report: any, url?: string) {
  if (report?.error || !report?.unrouted?.length) return report;
  const unrouted = report.unrouted.map((l: SpecLine) => ({ ...l }));
  let asked: string | undefined;
  let model: string | undefined;
  for (const line of unrouted) {
    const judged = await judgeGoal(line.text, { url });
    if ('error' in judged) return { ...report, unrouted, judged: { error: judged.error } };
    asked = judged.asked;
    model = judged.model ?? model;
    if (judged.suggested) line.suggested = judged.suggested;
  }
  return {
    ...report,
    unrouted,
    judged: {
      asked,
      ...(model ? { model } : {}),
      suggested: unrouted.filter((l: any) => l.suggested).length,
    },
  };
}

export { judgeUnrouted, parseMarkdown, readSpec, specGoal };
