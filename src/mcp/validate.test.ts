/**
 * The schema as the contract: what is accepted as it stands, what is accepted
 * because the meaning is not in doubt, and what is refused with the whole list
 * of what is wrong at once.
 */
import { describe, expect, test } from 'vitest';
import { BASE_TOOLS, type ToolDef } from './tools.ts';
import { checkArguments } from './validate.ts';

const tool = (name: string): ToolDef => {
  const found = BASE_TOOLS.find(t => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return { ...found, name: `ambit_${found.name}` };
};

const plan = tool('plan'); // capId*
const digest = tool('digest'); // days (number)
const goal = tool('goal'); // goal*, judge (boolean), judgeUrl
const verify = tool('verify'); // capId, optional

describe('what is accepted', () => {
  test('arguments as the schema names them', () => {
    expect(checkArguments(plan, { capId: 'combo:x' })).toEqual({
      ok: true,
      args: { capId: 'combo:x' },
    });
  });

  test('no arguments, for a tool that takes none or needs none', () => {
    expect(checkArguments(tool('stats'), undefined)).toEqual({ ok: true, args: {} });
    expect(checkArguments(tool('stats'), null)).toEqual({ ok: true, args: {} });
    expect(checkArguments(verify, {})).toEqual({ ok: true, args: {} });
  });

  test('a capability under any of its three names, whichever the schema shows', () => {
    for (const key of ['capId', 'capabilityId', 'capability', 'capability_id', 'CapID']) {
      const r = checkArguments(plan, { [key]: 'x' });
      expect(r, key).toEqual({ ok: true, args: { capId: 'x' } });
    }
    // And the other way round: `ambit_can` shows `capability` and takes `capId`.
    expect(checkArguments(tool('can'), { capId: 'x' })).toEqual({
      ok: true,
      args: { capability: 'x' },
    });
  });

  test('null and an empty string, which say "I have no value" for an optional argument', () => {
    expect(checkArguments(digest, { days: null })).toEqual({ ok: true, args: {} });
    expect(checkArguments(verify, { capId: '' })).toEqual({ ok: true, args: {} });
    expect(checkArguments(verify, { capId: '   ' })).toEqual({ ok: true, args: {} });
  });

  test('a number sent as a string, and a boolean sent as a word', () => {
    expect(checkArguments(digest, { days: '14' })).toEqual({ ok: true, args: { days: 14 } });
    expect(checkArguments(digest, { days: ' 2.5 ' })).toEqual({ ok: true, args: { days: 2.5 } });
    const r = checkArguments(goal, { goal: 'x', judge: 'TRUE' });
    expect(r).toEqual({ ok: true, args: { goal: 'x', judge: true } });
  });

  test('a string given as a number, which an id or a name sometimes is', () => {
    expect(checkArguments(tool('run_begin'), { id: 42 })).toEqual({ ok: true, args: { id: '42' } });
  });

  test('the schema spelling wins when a capability is sent twice', () => {
    const r = checkArguments(plan, { capabilityId: 'from-alias', capId: 'from-schema' });
    expect(r).toEqual({ ok: true, args: { capId: 'from-schema' } });
  });
});

describe('what is refused', () => {
  test('a missing required argument, named, with what the tool takes', () => {
    const r = checkArguments(plan, {});
    expect(r).toEqual({
      ok: false,
      error: 'ambit_plan: capId is required.',
      takes: 'capId* (string)',
    });
  });

  test('a required argument that is empty is missing', () => {
    expect(checkArguments(plan, { capId: '' })).toMatchObject({ ok: false });
    expect(checkArguments(plan, { capId: null })).toMatchObject({ ok: false });
  });

  test('an argument the tool does not take, so it is not silently dropped', () => {
    const r = checkArguments(verify, { cap: 'x' });
    expect(r).toMatchObject({ ok: false, error: 'ambit_verify: no argument named cap.' });
  });

  test('everything wrong at once, so one retry is enough', () => {
    const r = checkArguments(goal, { judge: 'maybe', color: 'red', size: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('judge must be a boolean, got "maybe"');
    expect(r.error).toContain('goal is required');
    expect(r.error).toContain('no arguments named color, size');
    expect(r.takes).toBe('goal* (string), judge (boolean), judgeUrl (string)');
  });

  test('a value of the wrong kind, said the way a model can act on it', () => {
    expect(checkArguments(digest, { days: 'soon' })).toMatchObject({
      ok: false,
      error: 'ambit_digest: days must be a number, got "soon".',
    });
    expect(checkArguments(digest, { days: {} })).toMatchObject({
      error: 'ambit_digest: days must be a number, got object.',
    });
    expect(checkArguments(digest, { days: Number.NaN })).toMatchObject({ ok: false });
  });

  test('arguments that are not an object', () => {
    for (const bad of ['plan', 7, ['capId'], true]) {
      expect(checkArguments(plan, bad)).toMatchObject({
        ok: false,
        error: 'ambit_plan: arguments must be an object.',
      });
    }
  });

  test('a name that only looks inherited, which a bare truth test would have accepted', () => {
    // `constructor` is on every object and `__proto__` is what JSON.parse makes
    // an own key of: neither is an argument, and neither reaches the result.
    expect(checkArguments(plan, { capId: 'x', constructor: 'y' })).toMatchObject({ ok: false });
    const parsed = JSON.parse('{"capId": "x", "__proto__": {"admin": true}}');
    const r = checkArguments(plan, parsed);
    expect(r).toMatchObject({ ok: false });
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });
});

describe('the catalogue itself', () => {
  test('a tool that needs a capability says so in its schema, so a client can check first', () => {
    for (const name of [
      'impact',
      'evidence',
      'plan',
      'paths',
      'simulate',
      'propose',
      'blocked',
      'can',
      'catalog',
    ]) {
      const t = tool(name);
      const key = 'capability' in t.inputSchema.properties ? 'capability' : 'capId';
      expect(t.inputSchema.required, name).toEqual([key]);
    }
  });

  test('a tool declares one name for its capability, not three', () => {
    const names = ['capId', 'capabilityId', 'capability'];
    for (const t of BASE_TOOLS) {
      const declared = names.filter(n => n in t.inputSchema.properties);
      expect(declared.length, t.name).toBeLessThanOrEqual(1);
    }
  });

  test('every required argument is declared, and every property has a type', () => {
    for (const t of BASE_TOOLS) {
      for (const r of t.inputSchema.required ?? []) {
        expect(t.inputSchema.properties, `${t.name}.${r}`).toHaveProperty(r);
      }
      for (const [k, p] of Object.entries(t.inputSchema.properties)) {
        expect(['string', 'number', 'boolean'], `${t.name}.${k}`).toContain(p.type);
      }
    }
  });
});
