/**
 * The models kept on this machine, read from the directories the runtimes that
 * serve them store them in.
 *
 * Names only. A directory listing says which models are here; nothing opens a
 * model file, a manifest's contents or a socket, so a model server that is not
 * running is read the same as one that is, and discovery stays out of the five
 * commands that reach the network (AGENTS.md, security posture, invariant 4).
 * The only imports are `node:fs` and `node:path`, and a test holds that.
 *
 * Ollama keeps models under `~/.ollama/models`, or `$OLLAMA_MODELS` when set
 * (https://docs.ollama.com/faq, "Where are models stored?"). A model is a
 * manifest at `manifests/<host>/<namespace>/<model>/<tag>`, and newer releases
 * add `manifests-v2/` in the same shape, with `:` in a host written `%3A` and
 * each entry a link that counts only while its target exists
 * (https://github.com/ollama/ollama/blob/main/manifest/paths.go). A name is
 * shown as `ollama list` shows it: the public host and the `library`
 * namespace are left out (`DisplayShortest` in
 * https://github.com/ollama/ollama/blob/main/types/model/name.go).
 *
 * LM Studio keeps them under `~/.lmstudio/models/<publisher>/<model>/`, one
 * directory per model holding its weight files
 * (https://lmstudio.ai/docs/app/advanced/import-model), and older installs
 * under `~/.cache/lm-studio/models`, which LM Studio's own tools still look in
 * (https://github.com/lmstudio-ai/mlx-engine/blob/main/demo.py,
 * https://github.com/lmstudio-ai/lmstudio-js/blob/main/packages/lms-common-server/src/findLMStudioHome.ts).
 * It documents no variable for the folder, so `AMBIT_LMSTUDIO_MODELS` names a
 * moved one, and replaces both defaults when set.
 */
import { existsSync, readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

/** One runtime's models, as discovery found them on disk. */
export interface LocalModelStore {
  /** As a person knows it: `Ollama`, `LM Studio`. */
  label: string;
  /**
   * The provider key the graph files its models under. It starts `local`, the
   * convention the curated tree reads a local provider by (`^provider:local`
   * in Local Runtime), so Hosted Inference (`^provider:(?!local)`,
   * `^model:(?!local)`) never counts one and the spend meter never prices one.
   */
  provider: 'local-ollama' | 'local-lmstudio';
  /** The model names found, as the runtime itself shows them, sorted. */
  models: string[];
}

const PUBLIC_HOSTS = new Set(['registry.ollama.ai', 'ollama.com']);
/** What LM Studio loads: llama.cpp's single file, or MLX's weight shards. */
const WEIGHT_FILE = /\.(gguf|safetensors)$/i;

/** A directory's entries, or none for one that is missing, unreadable or a file. */
function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(e => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

/** A tag is a file or a link, never a directory, and a link counts only while its target exists. */
function isTag(dir: string, entry: Dirent): boolean {
  return !entry.isDirectory() && existsSync(join(dir, entry.name));
}

/** `ollama list`'s name for a manifest path: the public host and `library` are left out. */
function ollamaName(host: string, namespace: string, model: string, tag: string): string {
  if (!PUBLIC_HOSTS.has(host.toLowerCase())) return `${host}/${namespace}/${model}:${tag}`;
  if (namespace.toLowerCase() !== 'library') return `${namespace}/${model}:${tag}`;
  return `${model}:${tag}`;
}

export function ollamaModelsDir(home = process.env.HOME || '/'): string {
  return process.env.OLLAMA_MODELS || join(home, '.ollama', 'models');
}

export function lmStudioModelsDirs(home = process.env.HOME || '/'): string[] {
  const override = process.env.AMBIT_LMSTUDIO_MODELS;
  if (override) return [override];
  return [join(home, '.lmstudio', 'models'), join(home, '.cache', 'lm-studio', 'models')];
}

/** The models in an Ollama store, from the manifest tree's directory names. */
export function readOllamaModels(root: string): string[] {
  const found = new Set<string>();
  for (const tree of ['manifests', 'manifests-v2']) {
    const base = join(root, tree);
    for (const host of entries(base)) {
      const hostDir = join(base, host.name);
      const hostName = host.name.replace(/%3A/gi, ':');
      for (const namespace of entries(hostDir)) {
        const namespaceDir = join(hostDir, namespace.name);
        for (const model of entries(namespaceDir)) {
          const modelDir = join(namespaceDir, model.name);
          for (const tag of entries(modelDir)) {
            if (!isTag(modelDir, tag)) continue;
            found.add(ollamaName(hostName, namespace.name, model.name, tag.name));
          }
        }
      }
    }
  }
  return [...found].sort();
}

/** The models in LM Studio's folders: each `<publisher>/<model>` directory holding a weight file. */
export function readLmStudioModels(roots: string[]): string[] {
  const found = new Set<string>();
  for (const root of roots) {
    for (const publisher of entries(root)) {
      const publisherDir = join(root, publisher.name);
      for (const model of entries(publisherDir)) {
        const files = entries(join(publisherDir, model.name));
        if (files.some(f => WEIGHT_FILE.test(f.name))) {
          found.add(`${publisher.name}/${model.name}`);
        }
      }
    }
  }
  return [...found].sort();
}

/** Every store with at least one model in it. A runtime installed and never used adds nothing. */
export function localModelStores(home = process.env.HOME || '/'): LocalModelStore[] {
  const stores: LocalModelStore[] = [
    {
      label: 'Ollama',
      provider: 'local-ollama',
      models: readOllamaModels(ollamaModelsDir(home)),
    },
    {
      label: 'LM Studio',
      provider: 'local-lmstudio',
      models: readLmStudioModels(lmStudioModelsDirs(home)),
    },
  ];
  return stores.filter(store => store.models.length > 0);
}
