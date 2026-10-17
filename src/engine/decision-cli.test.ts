import { expect, test } from 'vitest';
import { cliAsync, seed } from './testing/cli.ts';

test('judge goal retains the authored vocabulary path without contacting a provider', async () => {
  seed({}).close();
  const out = await cliAsync('judge', 'goal', 'run commands');
  expect(out).toMatchObject({
    kind: 'goal',
    decisions: [],
    suggestions: [{ source: 'vocabulary', capability_ids: ['combo:shell-execution'] }],
  });
});
test('judge evaluate defaults to an offline authored smoke corpus', async () => {
  seed({}).close();
  const out = await cliAsync('judge', 'evaluate');
  expect(out).toMatchObject({ mode: 'vocabulary', total: 8 });
  expect(out).not.toHaveProperty('brier');
});
test('judge history is local and a missing receipt cannot be accepted or planned', async () => {
  seed({}).close();
  expect(await cliAsync('judge', 'history')).toMatchObject({ decisions: [] });
  expect(await cliAsync('judge', 'review', 'decision:nope', 'accepted')).toHaveProperty('error');
  expect(await cliAsync('judge', 'plan', 'decision:nope')).toHaveProperty('error');
});
test('judge validates options and input sources before a model can be called', async () => {
  seed({}).close();
  expect(await cliAsync('judge', 'goal', 'opaque', '--provider=unrecognized')).toHaveProperty(
    'error'
  );
  expect(await cliAsync('judge', 'goal', 'opaque', '--threshold=0')).toHaveProperty('error');
  expect(await cliAsync('judge', 'attention')).toHaveProperty('error');
  expect(await cliAsync('judge', 'tools')).toHaveProperty('error');
  expect(await cliAsync('judge', 'media', '/missing/clip.json')).toHaveProperty('error');
});
