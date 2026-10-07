/**
 * The models Ollama and LM Studio keep on disk, read by name into the graph.
 *
 * Every folder here is made in the test's own temp directory: the suite points
 * OLLAMA_MODELS and AMBIT_LMSTUDIO_MODELS at nothing (vitest.config.ts), so the
 * models on the machine running it never reach an assertion.
 */
import { chmodSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { spentOn } from './economics.ts';
import {
  lmStudioModelsDirs,
  localModelStores,
  ollamaModelsDir,
  readLmStudioModels,
  readOllamaModels,
} from './local-models.ts';
import {
  dir,
  getDb,
  join,
  mkdirSync,
  rmSync,
  rows,
  seedWith,
  symlinkSync,
  withEnv,
  writeFileSync,
} from './testing/cli.ts';

/** An empty file at `path`, with its directories. */
function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, '');
}

/** An Ollama store holding `names` as `[host, namespace, model, tag]` manifests. */
function ollamaStore(root: string, names: [string, string, string, string][]): string {
  for (const parts of names) touch(join(root, 'manifests', ...parts));
  return root;
}

test('Ollama models are named as `ollama list` names them, from both manifest trees', () => {
  const root = ollamaStore(join(dir, 'ollama'), [
    ['registry.ollama.ai', 'library', 'qwen3-coder', '30b-128k'],
    ['registry.ollama.ai', 'library', 'nomic-embed-text', 'latest'],
    ['registry.ollama.ai', 'someone', 'tuned', '8b'],
    ['hf.co', 'unsloth', 'Qwen3-Next-80B-A3B-Instruct-GGUF', 'Q2_K'],
  ]);
  // The newer tree: the public host is ollama.com, a port's colon is written
  // %3A, and each entry is a link that counts only while its target exists.
  const blob = join(root, 'blobs', 'sha256-manifest');
  touch(blob);
  const v2 = join(root, 'manifests-v2');
  mkdirSync(join(v2, 'ollama.com', 'library', 'qwen3-coder'), { recursive: true });
  symlinkSync(blob, join(v2, 'ollama.com', 'library', 'qwen3-coder', '30b-128k'));
  mkdirSync(join(v2, 'localhost%3A5000', 'team', 'private'), { recursive: true });
  symlinkSync(blob, join(v2, 'localhost%3A5000', 'team', 'private', 'v1'));
  mkdirSync(join(v2, 'ollama.com', 'library', 'gone'), { recursive: true });
  symlinkSync(join(root, 'blobs', 'collected'), join(v2, 'ollama.com', 'library', 'gone', 'x'));
  touch(join(root, 'manifests', '.DS_Store'));

  expect(readOllamaModels(root)).toEqual([
    'hf.co/unsloth/Qwen3-Next-80B-A3B-Instruct-GGUF:Q2_K',
    'localhost:5000/team/private:v1',
    'nomic-embed-text:latest',
    'qwen3-coder:30b-128k',
    'someone/tuned:8b',
  ]);
});

test('a manifest is found by its name alone: one nobody may read is still listed', () => {
  const root = ollamaStore(join(dir, 'sealed'), [
    ['registry.ollama.ai', 'library', 'llama3.1', '8b'],
  ]);
  const manifest = join(root, 'manifests', 'registry.ollama.ai', 'library', 'llama3.1', '8b');
  chmodSync(manifest, 0o000);
  try {
    expect(readOllamaModels(root)).toEqual(['llama3.1:8b']);
  } finally {
    chmodSync(manifest, 0o644);
  }
});

test('LM Studio models are the publisher/model folders holding a weight file, in either home', () => {
  const current = join(dir, 'lmstudio', 'models');
  const older = join(dir, 'cache', 'lm-studio', 'models');
  touch(join(current, 'lmstudio-community', 'gpt-oss-20b-GGUF', 'gpt-oss-20b-MXFP4.gguf'));
  touch(join(current, 'mlx-community', 'Qwen3-8B-4bit', 'model.safetensors'));
  touch(join(current, 'mlx-community', 'Qwen3-8B-4bit', 'config.json'));
  // A download that never finished, and a folder of something else.
  touch(join(current, 'nomic-ai', 'half-done', 'model.gguf.part'));
  touch(join(current, 'notes.txt'));
  touch(join(older, 'nomic-ai', 'nomic-embed-text-v1.5-GGUF', 'nomic-embed-text-v1.5.Q8_0.gguf'));

  expect(readLmStudioModels([current, older])).toEqual([
    'lmstudio-community/gpt-oss-20b-GGUF',
    'mlx-community/Qwen3-8B-4bit',
    'nomic-ai/nomic-embed-text-v1.5-GGUF',
  ]);
});

test('each store is looked for where its runtime keeps it, unless a variable names another', () => {
  const home = join(dir, 'home');
  withEnv({ OLLAMA_MODELS: undefined, AMBIT_LMSTUDIO_MODELS: undefined }, () => {
    expect(ollamaModelsDir(home)).toBe(join(home, '.ollama', 'models'));
    expect(lmStudioModelsDirs(home)).toEqual([
      join(home, '.lmstudio', 'models'),
      join(home, '.cache', 'lm-studio', 'models'),
    ]);
    // A runtime installed with no model pulled adds nothing.
    mkdirSync(join(home, '.ollama', 'models', 'manifests'), { recursive: true });
    expect(localModelStores(home)).toEqual([]);
  });
  withEnv({ OLLAMA_MODELS: '/elsewhere/ollama', AMBIT_LMSTUDIO_MODELS: '/elsewhere/lms' }, () => {
    expect(ollamaModelsDir(home)).toBe('/elsewhere/ollama');
    expect(lmStudioModelsDirs(home)).toEqual(['/elsewhere/lms']);
  });
});

test('the reader can only list directories: it imports nothing that opens a socket', () => {
  const source = readFileSync(join(import.meta.dirname, 'local-models.ts'), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m => m[1]);
  expect(imports).toEqual(['node:fs', 'node:path']);
});

/** Seeds a hosted provider from a config, and the given model folders from disk. */
function seedWithModels(ollama: string, lmstudio: string): void {
  const config = join(dir, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({ provider: { anthropic: { models: { 'claude-sonnet': {} } } } })
  );
  const dbPath = join(dir, 'graph.db');
  seedWith(
    {
      OPENCODE_CONFIG: config,
      OLLAMA_MODELS: ollama,
      AMBIT_LMSTUDIO_MODELS: lmstudio,
      TOOLCHAIN_DB: dbPath,
      AMBIT_DB: dbPath,
    },
    JSON.stringify({
      config_keys: { provider: { type: 'provider', domain: 'ai-ml' } },
      skill_dirs: [],
    })
  );
}

test('local models reach the local nodes of the tree, never Hosted Inference, and are never priced as hosted', () => {
  const ollama = ollamaStore(join(dir, 'ollama'), [
    ['registry.ollama.ai', 'library', 'qwen3-coder', '30b-128k'],
    ['registry.ollama.ai', 'library', 'mxbai-embed-large', 'latest'],
  ]);
  const lmstudio = join(dir, 'lmstudio');
  touch(join(lmstudio, 'nomic-ai', 'nomic-embed-text-v1.5-GGUF', 'model.Q8_0.gguf'));
  seedWithModels(ollama, lmstudio);

  const db = getDb(join(dir, 'graph.db'));
  const proof = (node: string) =>
    rows(
      db,
      `SELECT from_capability AS f FROM dependencies
       WHERE to_capability = 'combo:${node}' AND kind = 'provides' ORDER BY f`
    ).map(r => r.f);
  const state = (id: string) =>
    rows(db, `SELECT state FROM capabilities WHERE id = '${id}'`)[0]?.state;

  // Each model under the server that serves it, as a configured one is.
  expect(
    rows(
      db,
      "SELECT from_capability AS f, to_capability AS t, kind FROM dependencies WHERE to_capability LIKE 'model:local-%' ORDER BY t"
    )
  ).toEqual([
    {
      f: 'provider:local-lmstudio',
      t: 'model:local-lmstudio/nomic-ai/nomic-embed-text-v1.5-GGUF',
      kind: 'runs_on',
    },
    {
      f: 'provider:local-ollama',
      t: 'model:local-ollama/mxbai-embed-large:latest',
      kind: 'runs_on',
    },
    { f: 'provider:local-ollama', t: 'model:local-ollama/qwen3-coder:30b-128k', kind: 'runs_on' },
  ]);
  expect(rows(db, "SELECT kind FROM capabilities WHERE id = 'provider:local-ollama'")).toEqual([
    { kind: 'resource' },
  ]);

  for (const node of ['local-runtime', 'local-tool-calling', 'local-embeddings']) {
    expect([node, state(`combo:${node}`)]).toEqual([node, 'unlocked']);
  }
  expect(proof('local-runtime')).toContain('provider:local-ollama');
  expect(proof('local-runtime')).toContain('provider:local-lmstudio');
  expect(proof('local-tool-calling')).toEqual(['model:local-ollama/qwen3-coder:30b-128k']);
  expect(proof('local-embeddings')).toEqual([
    'model:local-lmstudio/nomic-ai/nomic-embed-text-v1.5-GGUF',
    'model:local-ollama/mxbai-embed-large:latest',
  ]);
  expect(proof('extended-context')).toEqual(['model:local-ollama/qwen3-coder:30b-128k']);
  // Hosted Inference is the configured provider's alone.
  expect(proof('hosted-inference')).toEqual([
    'model:anthropic/claude-sonnet',
    'provider:anthropic',
  ]);

  // The spend meter files tokens under the node whose patterns name the model.
  expect(spentOn(db, 'anthropic/claude-sonnet')).toBe('combo:hosted-inference');
  expect(spentOn(db, 'local-ollama/qwen3-coder:30b-128k')).toBeNull();
  expect(spentOn(db, 'local-lmstudio/nomic-ai/nomic-embed-text-v1.5-GGUF')).toBeNull();
  db.close();
});

test('a model deleted from disk is retired by the next seed', () => {
  const ollama = ollamaStore(join(dir, 'ollama'), [
    ['registry.ollama.ai', 'library', 'qwen3', '8b'],
    ['registry.ollama.ai', 'library', 'gemma3', '4b'],
  ]);
  const lmstudio = join(dir, 'no-lmstudio');
  seedWithModels(ollama, lmstudio);
  rmSync(join(ollama, 'manifests', 'registry.ollama.ai', 'library', 'qwen3'), { recursive: true });
  seedWithModels(ollama, lmstudio);

  const db = getDb(join(dir, 'graph.db'));
  const live = rows(
    db,
    "SELECT id FROM capabilities WHERE id LIKE 'model:local-%' AND retired_at IS NULL"
  ).map(r => r.id);
  const toolCalling = rows(
    db,
    "SELECT state FROM capabilities WHERE id = 'combo:local-tool-calling'"
  )[0];
  db.close();
  expect(live).toEqual(['model:local-ollama/gemma3:4b']);
  // Qwen was the only tool-calling model; gemma3 is not one the tree names.
  expect(toolCalling.state).toBe('locked');
});
