/**
 * What a runtime's own tool is by the name it is given, and what a shell
 * command exercises by the programs it runs.
 */
import { expect, test } from 'vitest';
import { captureFailure } from './failures.ts';
import { makeGraph } from './testing/graph.ts';
import { builtInTool, commandExercises } from './tool-names.ts';

test('the same tool is one entry whichever runtime names it', () => {
  for (const name of [
    'Bash',
    'bash',
    'Shell',
    'exec_command',
    'run_terminal_cmd',
    'run_shell_command',
  ]) {
    expect(builtInTool(name)).toEqual({ means: 'tool:bash', act: 'execute' });
  }
  for (const name of ['Write', 'Edit', 'MultiEdit', 'apply_patch', 'edit_file', 'write_file']) {
    expect(builtInTool(name)).toEqual({ means: 'tool:edit', act: 'execute' });
  }
  // Reading the files here is File Editing observed, never Web Research.
  for (const name of ['Read', 'Grep', 'Glob', 'grep_search', 'codebase_search', 'read_file']) {
    expect(builtInTool(name)).toEqual({ means: 'tool:edit', act: 'observe' });
  }
  expect(builtInTool('WebFetch')).toEqual({ means: 'combo:web-research', act: 'execute' });
  // A subagent's calls come through the gate themselves; launching one is not asked about.
  expect(builtInTool('Task')).toEqual({ means: 'combo:subagents' });
  expect(builtInTool('TodoWrite')).toBeUndefined();
  expect(builtInTool('mcp__github__create_issue')).toBeUndefined();
});

const VC = 'combo:version-control';

test('git that only reads is observed, and git that changes anything acts', () => {
  expect(commandExercises('git status')).toEqual([{ means: VC, act: 'observe' }]);
  expect(commandExercises('git -C ../repo --no-pager log --oneline')).toEqual([
    { means: VC, act: 'observe' },
  ]);
  expect(commandExercises('git push --force origin main')).toEqual([{ means: VC, act: 'execute' }]);
  expect(commandExercises('git -c user.name=x commit -m "status"')).toEqual([
    { means: VC, act: 'execute' },
  ]);
  expect(commandExercises('gh pr view 12')).toEqual([{ means: VC, act: 'observe' }]);
  expect(commandExercises('gh pr merge 12 --squash')).toEqual([{ means: VC, act: 'execute' }]);
});

test('a command line is read as every simple command in it, each once', () => {
  expect(commandExercises('cd app && git push')).toEqual([{ means: VC, act: 'execute' }]);
  expect(commandExercises('git status; git diff | head')).toEqual([{ means: VC, act: 'observe' }]);
  expect(commandExercises('git push && npx wrangler deploy')).toEqual([
    { means: VC, act: 'execute' },
    { means: 'combo:hosting', act: 'execute' },
  ]);
  expect(commandExercises('echo $(git rev-parse HEAD)')).toEqual([{ means: VC, act: 'observe' }]);
});

test('a program is found past runners, prefixes, paths and a shell it is handed to', () => {
  for (const command of [
    'npx wrangler deploy',
    'bunx wrangler deploy',
    'pnpm dlx wrangler deploy',
    'npm exec -- wrangler deploy',
    'CLOUDFLARE_ENV=prod ./node_modules/.bin/wrangler deploy',
  ]) {
    expect(commandExercises(command)).toEqual([{ means: 'combo:hosting', act: 'execute' }]);
  }
  expect(commandExercises('sudo -E env PGHOST=x /usr/bin/psql -c "select 1"')).toEqual([
    { means: 'combo:data-access', act: 'execute' },
  ]);
  expect(commandExercises('timeout 30 op read op://vault/item/field')).toEqual([
    { means: 'combo:secret-management', act: 'execute' },
  ]);
  expect(commandExercises(`bash -lc "git push"`)).toEqual([{ means: VC, act: 'execute' }]);
  expect(commandExercises(`eval 'op read x'`)).toEqual([
    { means: 'combo:secret-management', act: 'execute' },
  ]);
});

test('words that only mention a program run nothing', () => {
  expect(commandExercises(`echo "git push; op read x"`)).toEqual([]);
  expect(commandExercises(`grep -rn 'git push' .`)).toEqual([]);
  expect(commandExercises('# git push first\nls -la')).toEqual([]);
  // A file written through a here-document is the file's text, not commands.
  expect(
    commandExercises("cat > deploy.sh <<'EOF'\ngit push\nop read x\nEOF\nchmod +x deploy.sh")
  ).toEqual([]);
  expect(commandExercises('cat <<EOF\ngit push\nEOF\ngit status')).toEqual([
    { means: VC, act: 'observe' },
  ]);
  // A script runs programs its command does not name: Shell Execution only.
  expect(commandExercises('./scripts/release.sh')).toEqual([]);
  expect(commandExercises('npx vitest run')).toEqual([]);
});

const SECRETS = { means: 'combo:secret-management', act: 'execute' };

test('a command substitution runs inside double quotes, and the rest of the string is text', () => {
  expect(commandExercises('echo "$(op read op://private/github/token)"')).toEqual([SECRETS]);
  expect(commandExercises('echo "token: `op read x`"')).toEqual([SECRETS]);
  expect(commandExercises('echo "$(echo "$(op read x)")"')).toEqual([SECRETS]);
  // Arithmetic runs nothing, and neither does a quoted mention beside a substitution.
  expect(commandExercises('echo "$((1 + 2)) and op read x"')).toEqual([]);
  // A commit message written the way Claude Code writes one: the here-document's
  // body is text, and a `)` in it does not close the substitution early.
  expect(
    commandExercises(`git commit -m "$(cat <<'EOF'\nStep 1) push it\nop read x\nEOF\n)"`)
  ).toEqual([{ means: VC, act: 'execute' }]);
});

test('a failing call is attributed by the name its runtime gives the tool', () => {
  const db = makeGraph({
    capabilities: [
      { id: 'combo:shell-execution', name: 'Shell Execution', kind: 'capability' },
      { id: 'combo:file-editing', name: 'File Editing', kind: 'capability' },
      { id: 'combo:web-research', name: 'Web Research', kind: 'capability' },
      { id: 'tool:bash', name: 'Shell Execution', kind: 'provider', category: 'tool' },
      { id: 'tool:edit', name: 'File Editor', kind: 'provider', category: 'tool' },
    ],
    dependencies: [
      { from: 'tool:bash', to: 'combo:shell-execution', kind: 'provides' },
      { from: 'tool:edit', to: 'combo:file-editing', kind: 'provides' },
    ],
  });
  try {
    const failed = (tool: string) =>
      captureFailure(db, { source: 'claude-code', tool, message: 'EACCES: permission denied' });
    // Claude Code spells it `Bash`; this went unattributed.
    expect(failed('Bash')).toMatchObject({ capability: 'tool:bash' });
    // Matched by Web Research's `search` pattern, a local grep was a web deficit.
    expect(failed('grep_search')).toMatchObject({ capability: 'tool:edit' });
    // A name the table holds means what it says, or nothing: never a pattern's guess.
    expect(failed('Task')).toMatchObject({ capability: 'unattributed' });
  } finally {
    db.close();
  }
});
