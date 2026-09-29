/**
 * Which node a caller meant. The resolver normalises and never guesses, and
 * these hold both halves: what it accepts, and what it refuses to choose.
 */
import { describe, expect, test } from 'vitest';
import { capabilityToAsk, resolveCapability } from './resolve.ts';
import { makeGraph } from './testing/graph.ts';

const graph = () =>
  makeGraph({
    capabilities: [
      { id: 'combo:shell-execution', name: 'Shell Execution', category: 'combo' },
      { id: 'combo:version-control', name: 'Version Control', category: 'combo' },
      { id: 'act:shell-execution/run_command', name: 'run_command', kind: 'action' },
      // Two nodes that share a word: a combo and a provider of it.
      { id: 'combo:docker', name: 'Docker', category: 'combo' },
      { id: 'tool:docker', name: 'Docker Engine', kind: 'provider' },
      // Two that share one and neither is a combo.
      { id: 'svc:ollama', name: 'Ollama', kind: 'resource' },
      { id: 'tool:ollama', name: 'Ollama CLI', kind: 'provider' },
    ],
  });

describe('resolveCapability accepts what normalising makes exact', () => {
  test('an id as it is', () => {
    const r = resolveCapability(graph(), 'combo:shell-execution');
    expect(r).toMatchObject({ ok: true, id: 'combo:shell-execution', via: 'id' });
  });

  test('a bare word, which has always meant a combo', () => {
    const r = resolveCapability(graph(), 'shell-execution');
    expect(r).toMatchObject({ ok: true, id: 'combo:shell-execution', via: 'combo' });
  });

  test('a display name, in any case and with spaces', () => {
    for (const word of ['Shell Execution', 'shell execution', 'SHELL_EXECUTION']) {
      expect(resolveCapability(graph(), word)).toMatchObject({
        ok: true,
        id: 'combo:shell-execution',
        via: 'name',
      });
    }
  });

  test('an id in the wrong case', () => {
    expect(resolveCapability(graph(), 'Combo:Version-Control')).toMatchObject({
      ok: true,
      id: 'combo:version-control',
    });
  });

  test('surrounding whitespace', () => {
    expect(resolveCapability(graph(), '  combo:docker \n')).toMatchObject({ id: 'combo:docker' });
  });

  test('the combo, when a bare word also fits a provider', () => {
    // `Docker` is a combo and `tool:docker` is what runs it. A bare word means the combo.
    expect(resolveCapability(graph(), 'DOCKER')).toMatchObject({ ok: true, id: 'combo:docker' });
  });

  test('an action by its exact id', () => {
    expect(resolveCapability(graph(), 'act:shell-execution/run_command')).toMatchObject({
      ok: true,
      via: 'id',
    });
  });
});

describe('resolveCapability refuses to choose', () => {
  test('a word that fits no node comes back with what resembles it, and no invented node', () => {
    const r = resolveCapability(graph(), 'shell-exection');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('unknown');
    expect(r.error).toContain('"shell-exection"');
    expect(r.did_you_mean).toContain('combo:shell-execution');
  });

  test('a word that resembles nothing offers nothing', () => {
    const r = resolveCapability(graph(), 'quantum-teleportation');
    expect(r).toMatchObject({ ok: false, reason: 'unknown', did_you_mean: [] });
  });

  test('a word that fits two nodes lists both instead of taking one', () => {
    const r = resolveCapability(graph(), 'ollama');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('ambiguous');
    expect(r.did_you_mean.sort()).toEqual(['svc:ollama', 'tool:ollama']);
  });

  test('an action by its short name, which is not unique across capabilities', () => {
    const r = resolveCapability(graph(), 'run_command');
    expect(r.ok).toBe(false);
  });

  test('nothing given', () => {
    for (const given of [undefined, null, '', '   ', 7, {}]) {
      expect(resolveCapability(graph(), given)).toMatchObject({ ok: false, reason: 'missing' });
    }
  });

  test('names each node once however many of its spellings match', () => {
    const r = resolveCapability(graph(), 'shell');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.did_you_mean).toEqual(['combo:shell-execution']);
  });
});

describe('capabilityToAsk puts the question to the right node, or answers a slip as one', () => {
  test('an id, a bare word and a name are asked about as the node they name', () => {
    for (const word of ['combo:shell-execution', 'shell-execution', 'Shell Execution']) {
      expect(capabilityToAsk(graph(), word)).toEqual({ ask: 'combo:shell-execution' });
    }
  });

  test('a wall that resembles nothing goes to the gate as it was written', () => {
    // The gate says no, and that is worth filing: nothing supplies it.
    expect(capabilityToAsk(graph(), '  quantum-teleportation ')).toEqual({
      ask: 'quantum-teleportation',
    });
  });

  test('a word that resembles a node is a slip, with the candidates and no question asked', () => {
    const r = capabilityToAsk(graph(), 'shell-exection');
    expect(r).toEqual({
      answer: {
        error: 'No capability "shell-exection" in this graph.',
        did_you_mean: ['combo:shell-execution'],
      },
    });
  });

  test('a word that fits two nodes is not asked about either', () => {
    const r = capabilityToAsk(graph(), 'ollama');
    expect(r).toMatchObject({ answer: { error: expect.stringContaining('more than one node') } });
  });

  test('nothing given is not a question', () => {
    expect(capabilityToAsk(graph(), undefined)).toMatchObject({
      answer: { error: 'A capability is needed.' },
    });
  });
});
