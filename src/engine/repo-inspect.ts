/**
 * Workspace / Repository stack intelligence and tailored agent recommendations.
 *
 * Developers rarely want generic, abstract tech-tree milestones like
 * "Typed Judgment: TypeSafe's Jev". They want to know:
 * "What tools, MCP servers, or capabilities should I give my agent to make it
 * 10x faster and safer when working on THIS specific repository?"
 *
 * `ambit repo` inspects the current repository (package.json, Cargo.toml,
 * pyproject.toml, docker-compose, git, databases) and cross-references with
 * the agent's installed tools to recommend high-leverage superpowers and
 * cross-runtime tool ports.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { toolServers } from './weight.ts';
import { runtimesFound } from './connect.ts';

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
  action_type: 'port' | 'connect' | 'goal' | 'verify';
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

/** Analyze repository and recommend context-aware agent superpowers. */
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
          title: `Port ${dbServer.name} to ${missing[0]}`,
          reason: `Project uses ${stack.databases.join(', ')}. Porting ${dbServer.name} enables direct, schema-aware queries without bash scripts.`,
          command: `ambit port ${dbServer.name} --to=${missing[0]}`,
          action_type: 'port',
        });
      }
    } else {
      superpowers.push({
        title: 'Database MCP Server',
        reason: `Project uses ${stack.databases.join(', ')}. Connect a database tool so agents can inspect schema and run safe read-only queries.`,
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
          title: `Port Playwright MCP to ${missing[0]}`,
          reason: `Project includes end-to-end browser tests. Porting Playwright to ${missing[0]} allows visual debugging and automated headless runs.`,
          command: `ambit port ${playwrightServer.name} --to=${missing[0]}`,
          action_type: 'port',
        });
      } else {
        superpowers.push({
          title: 'Playwright MCP Server',
          reason: `Project uses browser testing and ${playwrightServer.name} is configured in ${playwrightServer.runtimes.join(', ')}.`,
          action_type: 'verify',
        });
      }
    } else {
      superpowers.push({
        title: 'Playwright MCP Server',
        reason:
          'Project uses browser testing. Add Playwright MCP to let agents take screenshots and reproduce UI issues automatically.',
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
          title: `Port GitHub MCP to ${missing[0]}`,
          reason: `Git repository detected. Porting GitHub MCP lets ${missing[0]} read issues, inspect PRs, and review pull requests directly.`,
          command: `ambit port ${ghServer.name} --to=${missing[0]}`,
          action_type: 'port',
        });
      }
    }
  }

  // Docker
  if (stack.infra.includes('Docker')) {
    const dockerServer = servers.find(s => s.name.toLowerCase().includes('docker'));
    if (!dockerServer) {
      superpowers.push({
        title: 'Docker Management MCP',
        reason:
          'Project contains Docker configuration. A Docker MCP tool allows agents to check container status and inspect service logs.',
        command: 'ambit goal containerization',
        action_type: 'goal',
      });
    }
  }

  const summary = `${stack.name} (${[...stack.languages, ...stack.frameworks, ...stack.databases].join(', ') || 'workspace'}) · ${superpowers.length} recommended agent superpowers`;

  return {
    repo: stack,
    superpowers,
    summary,
  };
}
