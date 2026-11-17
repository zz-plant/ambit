/**
 * What to add for the project in a folder.
 *
 * The tree's next steps are the same in every folder. A person working in one
 * repository asks something narrower: which tool would this project's agent
 * use, and which of them is already here or set up in another runtime.
 * `ambit repo` reads the folder's manifests as data (package.json, Cargo.toml,
 * pyproject.toml, go.mod, Docker files, git, database files) and answers from
 * the servers the configs declare: add one another runtime already runs, or
 * the goal that reaches one nobody runs yet. The field is still called
 * `superpowers` in the JSON, since scripts read it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { toolServers, type ToolServer } from './weight.ts';
import { addCommand, runtimesFound } from './connect.ts';

export interface RepoStack {
  name: string;
  root: string;
  languages: string[];
  frameworks: string[];
  databases: string[];
  testing: string[];
  infra: string[];
  indicators: string[];
}

export interface RepoSuperpower {
  title: string;
  reason: string;
  command?: string;
  action_type: 'add' | 'connect' | 'goal' | 'verify';
}

export interface RepoReport {
  repo: RepoStack;
  superpowers: RepoSuperpower[];
  summary: string;
}

/** Safely read JSON from disk. */
function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Inspect the workspace directory and detect languages, tools, and stack. */
export function inspectRepoStack(dir = process.cwd()): RepoStack {
  const stack: RepoStack = {
    name: basename(dir),
    root: dir,
    languages: [],
    frameworks: [],
    databases: [],
    testing: [],
    infra: [],
    indicators: [],
  };

  if (existsSync(join(dir, '.git'))) {
    stack.infra.push('Git');
    stack.indicators.push('.git');
  }

  // Node.js / TypeScript / JavaScript
  const pkgPath = join(dir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = readJson(pkgPath);
    if (pkg) {
      if (pkg.name) stack.name = pkg.name;
      const deps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      if (deps.typescript || existsSync(join(dir, 'tsconfig.json'))) {
        stack.languages.push('TypeScript');
      } else {
        stack.languages.push('JavaScript');
      }

      // Frameworks
      if (deps.next) stack.frameworks.push('Next.js');
      else if (deps.react) stack.frameworks.push('React');
      if (deps.vue) stack.frameworks.push('Vue');
      if (deps.express) stack.frameworks.push('Express');
      if (deps['@nestjs/core']) stack.frameworks.push('NestJS');
      if (deps.fastify) stack.frameworks.push('Fastify');

      // Databases / ORMs
      if (deps['better-sqlite3'] || deps.sqlite3 || deps['sql.js']) stack.databases.push('SQLite');
      if (deps['@prisma/client'] || deps.prisma) stack.databases.push('Prisma');
      if (deps['drizzle-orm']) stack.databases.push('Drizzle');
      if (deps.pg || deps.postgres) stack.databases.push('PostgreSQL');
      if (deps.mysql2 || deps.mysql) stack.databases.push('MySQL');
      if (deps.redis || deps.ioredis) stack.databases.push('Redis');
      if (deps.mongoose || deps.mongodb) stack.databases.push('MongoDB');

      // Testing
      if (deps.vitest) stack.testing.push('Vitest');
      if (deps.jest) stack.testing.push('Jest');
      if (deps.playwright || deps['@playwright/test']) stack.testing.push('Playwright');
      if (deps.cypress) stack.testing.push('Cypress');

      stack.indicators.push('package.json');
    }
  }

  // Rust
  if (existsSync(join(dir, 'Cargo.toml'))) {
    stack.languages.push('Rust');
    stack.indicators.push('Cargo.toml');
  }

  // Python
  if (existsSync(join(dir, 'pyproject.toml')) || existsSync(join(dir, 'requirements.txt'))) {
    stack.languages.push('Python');
    stack.indicators.push(
      existsSync(join(dir, 'pyproject.toml')) ? 'pyproject.toml' : 'requirements.txt'
    );
  }

  // Go
  if (existsSync(join(dir, 'go.mod'))) {
    stack.languages.push('Go');
    stack.indicators.push('go.mod');
  }

  // Docker
  if (
    existsSync(join(dir, 'Dockerfile')) ||
    existsSync(join(dir, 'docker-compose.yml')) ||
    existsSync(join(dir, 'compose.yaml'))
  ) {
    stack.infra.push('Docker');
    stack.indicators.push('Docker');
  }

  // Local databases on disk
  try {
    const files = readdirSync(dir);
    const dbFiles = files.filter(
      f => f.endsWith('.db') || f.endsWith('.sqlite') || f.endsWith('.sqlite3')
    );
    if (dbFiles.length && !stack.databases.includes('SQLite')) {
      stack.databases.push(`SQLite (${dbFiles[0]})`);
    }
  } catch {
    // skip unreadable dir
  }

  // Deduplicate
  stack.languages = [...new Set(stack.languages)];
  stack.frameworks = [...new Set(stack.frameworks)];
  stack.databases = [...new Set(stack.databases)];
  stack.testing = [...new Set(stack.testing)];
  stack.infra = [...new Set(stack.infra)];

  return stack;
}

/**
 * What adding a server another runtime already runs takes in this one: the
 * runtime's own command where it ships one, with the same launch line and
 * none of the environment, whose values can be tokens and are not printed.
 * Undefined where the runtime ships none or the server is remote.
 */
function addInto(runtime: string, server: ToolServer): string | undefined {
  if (server.remote || !server.command) return undefined;
  return addCommand(runtime, { name: server.name, command: server.command, args: server.args });
}

/** The reason line's tail: where the server's entry is now, and its environment if it has one. */
function copyFrom(server: ToolServer): string {
  const keys = Object.keys(server.env ?? {});
  const from = server.runtimes.join(', ');
  return keys.length
    ? ` It is configured in ${from}; set ${keys.join(', ')} as that entry does.`
    : ` It is configured in ${from}.`;
}

/** What the project in `dir` uses, and what to add for it. */
export function analyzeRepo(dir = process.cwd(), home = process.env.HOME || '/'): RepoReport {
  const stack = inspectRepoStack(dir);
  const servers = toolServers(home);
  const installedRuntimes = runtimesFound(home).map(r => r.target.runtime);

  const superpowers: RepoSuperpower[] = [];

  // Database tools
  const hasDb = stack.databases.length > 0;
  if (hasDb) {
    const dbServer = servers.find(
      s =>
        s.name.includes('sqlite') ||
        s.name.includes('postgres') ||
        s.name.includes('database') ||
        s.name.includes('db')
    );
    if (dbServer) {
      // Check if missing in any installed runtime
      const missing = installedRuntimes.filter(rt => !dbServer.runtimes.includes(rt));
      if (missing.length) {
        superpowers.push({
          title: `Add ${dbServer.name} to ${missing[0]}`,
          reason: `The project uses ${stack.databases.join(', ')}. With ${dbServer.name}, an agent in ${missing[0]} reads the schema and queries it without a shell script.${copyFrom(dbServer)}`,
          command: addInto(missing[0], dbServer),
          action_type: 'add',
        });
      }
    } else {
      superpowers.push({
        title: 'A database MCP server',
        reason: `The project uses ${stack.databases.join(', ')}, and no server here reaches a database. One lets an agent read the schema and run read-only queries.`,
        command: 'ambit goal data-access',
        action_type: 'goal',
      });
    }
  }

  // Browser / UI testing
  const hasBrowserTesting = stack.testing.some(
    t => t.includes('Playwright') || t.includes('Cypress')
  );
  const playwrightServer = servers.find(s => s.name.toLowerCase().includes('playwright'));
  if (hasBrowserTesting) {
    if (playwrightServer) {
      const missing = installedRuntimes.filter(rt => !playwrightServer.runtimes.includes(rt));
      if (missing.length) {
        superpowers.push({
          title: `Add Playwright MCP to ${missing[0]}`,
          reason: `The project has end-to-end browser tests. With Playwright, an agent in ${missing[0]} can drive a browser to reproduce and check them.${copyFrom(playwrightServer)}`,
          command: addInto(missing[0], playwrightServer),
          action_type: 'add',
        });
      } else {
        superpowers.push({
          title: 'Playwright MCP server, in place',
          reason: `The project has browser tests, and ${playwrightServer.name} is configured in ${playwrightServer.runtimes.join(', ')}.`,
          action_type: 'verify',
        });
      }
    } else {
      superpowers.push({
        title: 'A Playwright MCP server',
        reason:
          'The project has browser tests, and no server here drives a browser. Playwright lets an agent take screenshots and reproduce a broken page.',
        command: 'ambit goal browser-automation',
        action_type: 'goal',
      });
    }
  }

  // Version control / GitHub
  if (stack.infra.includes('Git')) {
    const ghServer = servers.find(s => s.name.toLowerCase().includes('github'));
    if (ghServer) {
      const missing = installedRuntimes.filter(rt => !ghServer.runtimes.includes(rt));
      if (missing.length) {
        superpowers.push({
          title: `Add GitHub MCP to ${missing[0]}`,
          reason: `The project is a git repository. With the GitHub server, an agent in ${missing[0]} reads issues and reviews pull requests where it works.${copyFrom(ghServer)}`,
          command: addInto(missing[0], ghServer),
          action_type: 'add',
        });
      }
    }
  }

  // Docker
  if (stack.infra.includes('Docker')) {
    const dockerServer = servers.find(s => s.name.toLowerCase().includes('docker'));
    if (!dockerServer) {
      superpowers.push({
        title: 'A Docker MCP server',
        reason:
          'The project has Docker configuration, and no server here reaches Docker. One lets an agent check which containers run and read their logs.',
        command: 'ambit goal containerization',
        action_type: 'goal',
      });
    }
  }

  const toAdd = superpowers.filter(s => s.command).length;
  const summary = `${stack.name} (${[...stack.languages, ...stack.frameworks, ...stack.databases].join(', ') || 'workspace'}) · ${toAdd ? `${toAdd} to add` : 'nothing to add'}`;

  return {
    repo: stack,
    superpowers,
    summary,
  };
}
