/**
 * `ambit check init` scaffolds a read-only declared check and refuses writes.
 */
import { test, expect } from 'vitest';
import { checkInit, readOnlyViolation } from './checkInit.ts';
import { makeGraph } from './testing/graph.ts';

function graph() {
  return makeGraph({ capabilities: [{ id: 'combo:x', name: 'X', category: 'combo' }] });
}

test('a command that writes is refused, and the reason is named', () => {
  const db = graph();
  const r = checkInit(db, 'x', { command: 'rm -rf /tmp/ambit' });
  expect(r.error).toContain('Refused');
  expect(r.verify).toBeUndefined();
  expect(readOnlyViolation('curl -o /tmp/x https://example.com')).toBeTruthy();
  expect(readOnlyViolation('git push origin main')).toBeTruthy();
  db.close();
});

test('a read-only command scaffolds a verify block', () => {
  const db = graph();
  const r = checkInit(db, 'x', { command: 'command -v curl' });
  expect(r.verify).toEqual({ command: ['sh', '-c', 'command -v curl'], timeout_seconds: 10 });
  expect(r.error).toBeUndefined();
  db.close();
});

test('redirecting to /dev/null or a descriptor is read-only, a file is not', () => {
  expect(readOnlyViolation('command -v tsc >/dev/null 2>&1')).toBeUndefined();
  expect(readOnlyViolation('curl -sf https://example.com >/dev/null')).toBeUndefined();
  expect(readOnlyViolation('echo x > /tmp/ambit-check.txt')).toContain('redirect');
});

test('no command yields a placeholder with guidance, never a registration', () => {
  const db = graph();
  const r = checkInit(db, 'x');
  expect((r.verify?.command ?? []).join(' ')).toContain('<a read-only command');
  expect(r.note).toContain('read-only');
  expect(r.note).toContain('--command=');
  db.close();
});

test('an unknown capability is refused before any scaffold', () => {
  const db = graph();
  const r = checkInit(db, 'nope');
  expect(r.error).toContain('No capability');
  db.close();
});
