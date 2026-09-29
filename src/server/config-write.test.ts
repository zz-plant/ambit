/**
 * What the visualiser's config editing leaves behind.
 *
 * SECURITY.md says it writes a `.bak` before it changes anything, and for a
 * while only `ambit apply` and rollback did: the sentence was true of the
 * terminal and false of the browser. The route test in api.test.ts holds the
 * promise end to end; these hold the write itself, including the cases the
 * route never reaches.
 */
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'ambit-config-write-'));
const path = join(dir, 'opencode.json');
const backup = `${path}.bak`;

// The config path is read when the module loads, so the import waits for it.
process.env.OPENCODE_CONFIG = path;
const { writeConfig } = await import('./config.ts');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A clean slate: no config, no backup, whatever the last test left. */
function reset() {
  rmSync(path, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
}

test('an edit keeps the config it replaces in a .bak, byte for byte', async () => {
  reset();
  // Tabs and a trailing newline: a backup rebuilt from parsed JSON would lose
  // both, and a person restoring it would see a diff they never made.
  const before = '{\n\t"mcp": { "git": { "enabled": true } }\n}\n';
  writeFileSync(path, before);

  expect(await writeConfig({ mcp: { git: { enabled: false } } })).toBe(true);

  expect(readFileSync(backup, 'utf8')).toBe(before);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ mcp: { git: { enabled: false } } });
});

test('each edit replaces the backup, so it is the config before the latest edit', async () => {
  reset();
  writeFileSync(path, JSON.stringify({ n: 0 }));

  await writeConfig({ n: 1 });
  await writeConfig({ n: 2 });

  expect(JSON.parse(readFileSync(backup, 'utf8'))).toEqual({ n: 1 });
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ n: 2 });
});

test('with no config there is nothing to keep, and the write goes ahead', async () => {
  reset();

  expect(await writeConfig({ mcp: {} })).toBe(true);

  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ mcp: {} });
  expect(() => statSync(backup)).toThrow(/ENOENT/);
});

test('an edit that cannot be backed up is not made', async () => {
  reset();
  const before = JSON.stringify({ mcp: { git: { enabled: true } } });
  writeFileSync(path, before);
  // A directory where the backup belongs: the copy fails whoever runs this,
  // which a read-only file would not, since root writes through one.
  mkdirSync(backup);

  expect(await writeConfig({ mcp: { git: { enabled: false } } })).toBe(false);

  expect(readFileSync(path, 'utf8')).toBe(before);
});

// Modes are a POSIX idea; the backup takes the config's, whatever the umask.
test.skipIf(process.platform === 'win32')(
  'the backup is no more readable than the config it copies',
  async () => {
    reset();
    writeFileSync(path, JSON.stringify({ provider: { anthropic: { apiKey: 'sk-test' } } }));
    chmodSync(path, 0o600);

    await writeConfig({ provider: {} });
    expect(statSync(backup).mode & 0o777).toBe(0o600);

    // An older backup that was left open does not stay open.
    chmodSync(backup, 0o644);
    await writeConfig({ provider: { again: {} } });
    expect(statSync(backup).mode & 0o777).toBe(0o600);
  }
);
