/**
 * What a call to a runtime's own tool exercises, by the name the runtime gives
 * it, and what a shell command exercises, by the programs it runs.
 *
 * Every runtime names the same few tools its own way: Claude Code's `Write` is
 * OpenCode's `write`, Codex's `apply_patch`, Cursor's `edit_file` and Gemini
 * CLI's `write_file`. Left to the tree's `detect` patterns, most of those names
 * meant nothing and some meant the wrong thing: Cursor's `grep_search` was Web
 * Research, by the pattern that makes a search server one. So the gate asked
 * about a file changed with `Edit` and said nothing about one changed with
 * `Write`, and the map listed tools it has a node for as used and on none.
 *
 * A name in the table means what the table says and nothing else; `attribute`
 * in failures.ts reads it before any pattern. Each row also says how the gate
 * asks about a call: `observe` for a tool that only reads, which the tree lets
 * run unasked, `execute` for one that acts, and not at all for one that hands
 * its work to calls of their own (a subagent's, or the steps a skill sets out),
 * each of which comes through the gate in turn.
 *
 * A shell command is Shell Execution, and also what its programs are: `git
 * push` is Version Control, `wrangler deploy` is Hosting, and `op read` is
 * Secret Management, which the tree forbids, so the gate refuses it as it
 * refuses the 1Password server. The gate reads the command from the call it is
 * handed and keeps nothing. The ledger never sees one, since the hooks write
 * no tool's input (SECURITY.md), so there a shell call is Shell Execution alone.
 * Only programs whose node the tree takes a stance on are listed: the gate asks
 * about a capability with no grant, and listing a test runner would have put
 * every test run to the person for nothing anyone decided.
 *
 * This reads what a command says, not what it could become. A script or an
 * alias runs programs the command does not name, and stays Shell Execution.
 */

/** How the gate asks about a call: as reading, or as acting. Both are actions every node grants. */
export type Act = 'observe' | 'execute';

/** What one of a runtime's own tools is. */
export interface BuiltInTool {
  /** The entry the tool is (`tool:bash`), or the curated node when no entry stands for it. */
  means: string;
  /** What the gate asks for it; absent when the work arrives as calls of its own. */
  act?: Act;
}

/** One capability a shell command exercises through a program it runs. */
export interface Exercised {
  means: string;
  act: Act;
}

const BUILT_INS: Array<[names: string[], tool: BuiltInTool]> = [
  // Claude Code and OpenCode `bash`, Codex `shell` and `exec_command`, Cursor
  // `Shell` and `run_terminal_cmd`, Gemini CLI `run_shell_command`.
  [
    ['bash', 'shell', 'exec_command', 'run_terminal_cmd', 'run_shell_command'],
    { means: 'tool:bash', act: 'execute' },
  ],
  [
    [
      'edit',
      'multiedit',
      'write',
      'notebookedit',
      'patch',
      'apply_patch',
      'edit_file',
      'search_replace',
      'delete_file',
      'write_file',
      'replace',
    ],
    { means: 'tool:edit', act: 'execute' },
  ],
  // Reading and searching the files here. The tree puts reading under File
  // Editing (`read_file` is one of its actions, and the filesystem server
  // supplies it), and asks nothing to observe it.
  [
    [
      'read',
      'glob',
      'grep',
      'ls',
      'list',
      'read_file',
      'list_dir',
      'grep_search',
      'file_search',
      'codebase_search',
      'read_many_files',
      'list_directory',
      'search_file_content',
    ],
    { means: 'tool:edit', act: 'observe' },
  ],
  // A request to a host the call names, so it acts, as the gate has asked of
  // `WebFetch` since Web Research's patterns first matched it.
  [
    ['webfetch', 'websearch', 'web_fetch', 'web_search', 'google_web_search'],
    { means: 'combo:web-research', act: 'execute' },
  ],
  [['task', 'agent'], { means: 'combo:subagents' }],
  [['skill'], { means: 'combo:skill-library' }],
];

const BY_NAME = new Map(
  BUILT_INS.flatMap(([names, tool]) => names.map(name => [name, tool] as const))
);

/** What a runtime's own tool is, by the name a runtime calls it, or undefined for any other tool. */
export function builtInTool(name: string): BuiltInTool | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/** A program's node, by the name it is run under. */
const PROGRAMS: Record<string, string> = {
  git: 'combo:version-control',
  gh: 'combo:version-control',
  glab: 'combo:version-control',
  wrangler: 'combo:hosting',
  vercel: 'combo:hosting',
  netlify: 'combo:hosting',
  flyctl: 'combo:hosting',
  railway: 'combo:hosting',
  heroku: 'combo:hosting',
  psql: 'combo:data-access',
  sqlite3: 'combo:data-access',
  mysql: 'combo:data-access',
  duckdb: 'combo:data-access',
  mongosh: 'combo:data-access',
  supabase: 'combo:production-database',
  turso: 'combo:production-database',
  neonctl: 'combo:production-database',
  pscale: 'combo:production-database',
  op: 'combo:secret-management',
  vault: 'combo:secret-management',
  doppler: 'combo:secret-management',
  sops: 'combo:secret-management',
  bw: 'combo:secret-management',
  stripe: 'combo:payments',
  'sentry-cli': 'combo:error-tracking',
  crontab: 'combo:scheduled-work',
};

/** git subcommands that only read the repository. */
const GIT_READS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'blame',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'cat-file',
  'describe',
  'shortlog',
  'grep',
]);

/** git options that take the word after them as their value. */
const GIT_VALUED = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);

/** gh verbs that only read: `gh pr view`, `gh run list`, `gh pr checks`. */
const GH_READS = new Set(['view', 'list', 'status', 'diff', 'checks', 'watch']);

/** Words a command starts with that run the word after them: `sudo git push`, `if git diff`. */
const PREFIXES = new Set([
  'sudo',
  'env',
  'time',
  'nohup',
  'exec',
  'command',
  'nice',
  'timeout',
  '!',
  '{',
  'if',
  'then',
  'else',
  'elif',
  'while',
  'until',
  'do',
]);

/** Runners whose next word is the program: `npx wrangler deploy`. */
const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);

/** Package managers whose subcommand runs a program: `pnpm dlx`, `npm exec`, `bun x`. */
const RUNNING_SUBCOMMANDS: Record<string, Set<string>> = {
  npm: new Set(['exec', 'x']),
  pnpm: new Set(['dlx', 'exec']),
  yarn: new Set(['dlx', 'exec']),
  bun: new Set(['x']),
};

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);

/** How deep `bash -c "…"` and `eval` are followed into the command they run. */
const MAX_DEPTH = 3;

/**
 * The capabilities a shell command exercises through the programs it runs,
 * beyond Shell Execution itself, each once.
 */
export function commandExercises(command: string, depth = 0): Exercised[] {
  const found = new Map<string, Exercised>();
  for (const words of simpleCommands(command)) {
    for (const e of exercisedBy(words, depth)) found.set(`${e.means} ${e.act}`, e);
  }
  return [...found.values()];
}

/** The first word after `from` that is not an option. */
function operand(words: string[], from: number): number {
  let i = from;
  while (i < words.length && words[i].startsWith('-')) i++;
  return i;
}

/** What one simple command (`git push origin main`) exercises. */
function exercisedBy(words: string[], depth: number): Exercised[] {
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (PREFIXES.has(word)) {
      i++;
      // `sudo -E git`, `timeout 30 git`, `nice -n 10 git`.
      while (i < words.length && (words[i].startsWith('-') || /^\d+[smhd]?$/.test(words[i]))) i++;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      i++;
    } else {
      break;
    }
  }
  if (i >= words.length) return [];
  const program = (words[i].split('/').pop() ?? '').toLowerCase();
  const rest = words.slice(i + 1);

  if (SHELLS.has(program) || program === 'eval') {
    if (depth >= MAX_DEPTH) return [];
    if (program === 'eval') return commandExercises(rest.join(' '), depth + 1);
    const flag = rest.findIndex(w => /^-[a-z]*c[a-z]*$/.test(w));
    return flag >= 0 && rest[flag + 1] !== undefined
      ? commandExercises(rest[flag + 1], depth + 1)
      : [];
  }
  if (RUNNERS.has(program)) {
    const next = operand(rest, 0);
    return exercisedBy(rest.slice(next + (rest[next] === '--' ? 1 : 0)), depth);
  }
  const sub = operand(rest, 0);
  if (RUNNING_SUBCOMMANDS[program]?.has(rest[sub])) {
    const next = operand(rest, sub + 1);
    return exercisedBy(rest.slice(next + (rest[next] === '--' ? 1 : 0)), depth);
  }

  const means = PROGRAMS[program];
  if (!means) return [];
  if (program === 'git') return [{ means, act: gitReads(rest) ? 'observe' : 'execute' }];
  if (program === 'gh') {
    const [noun, verb] = rest.filter(w => !w.startsWith('-'));
    const reads = noun === 'status' || GH_READS.has(verb);
    return [{ means, act: reads ? 'observe' : 'execute' }];
  }
  return [{ means, act: 'execute' }];
}

/** Whether a git command only reads: its subcommand, past `-C dir` and the like. */
function gitReads(args: string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    if (GIT_VALUED.has(args[i])) i++;
    else if (!args[i].startsWith('-')) return GIT_READS.has(args[i]);
  }
  return false;
}

/**
 * A command line cut into its simple commands, each as its words with quotes
 * removed: `cd app && git push` is `cd app` and `git push`. Splits at `;`,
 * `&&`, `||`, `|`, `&`, newlines, parentheses, backquotes and `$(`, but not
 * inside quotes; skips comments and the body of a here-document, so a file
 * written with `cat <<EOF` is not read as commands. Anything stranger than
 * that is read as words, and at worst names a program the line does not run,
 * which costs a question and never lets anything through.
 */
function simpleCommands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  let begun = false;
  const pending: string[] = [];
  const endWord = () => {
    if (word || begun) words.push(word);
    word = '';
    begun = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\') {
      if (line[i + 1] !== '\n') word += line[i + 1] ?? '';
      i++;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      word += line.slice(i + 1, end < 0 ? undefined : end);
      begun = true;
      i = end < 0 ? line.length : end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') j += line[j] === '\\' ? 2 : 1;
      word += line.slice(i + 1, j).replace(/\\(["\\$`])/g, '$1');
      begun = true;
      i = j;
    } else if (c === '<' && line[i + 1] === '<' && line[i + 2] !== '<') {
      // A here-document: its delimiter now, its body skipped at the newline.
      endWord();
      let j = i + 2;
      if (line[j] === '-') j++;
      while (line[j] === ' ' || line[j] === '\t') j++;
      const quote = line[j] === "'" || line[j] === '"' ? line[j] : '';
      const start = quote ? j + 1 : j;
      let end = start;
      while (end < line.length && (quote ? line[end] !== quote : !/[\s;&|<>()]/.test(line[end])))
        end++;
      pending.push(line.slice(start, end));
      i = quote ? end : end - 1;
    } else if (c === '\n') {
      endCommand();
      // Each pending body runs to the line that is its delimiter alone.
      while (pending.length) {
        const delimiter = pending.shift();
        while (i + 1 < line.length) {
          const next = line.indexOf('\n', i + 1);
          const body = line.slice(i + 1, next < 0 ? line.length : next);
          i = next < 0 ? line.length : next;
          if (body.trim() === delimiter) break;
        }
      }
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if (';&|()`'.includes(c)) {
      endCommand();
    } else if (c === '$' && line[i + 1] === '(') {
      endCommand();
      i++;
    } else if (c === '#' && !word && !begun) {
      const end = line.indexOf('\n', i);
      i = end < 0 ? line.length : end - 1;
    } else {
      word += c;
    }
  }
  endCommand();
  return out;
}
