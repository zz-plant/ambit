import { expect, test } from 'vitest';
import { removeIn, setIn } from './jsonEdit.ts';
import { parseJsonc } from './opencode.ts';

const commented = `{
  // the models this machine runs
  "provider": {
    "ollama": {
      "options": { "baseURL": "http://127.0.0.1:11434/v1" }, // not a comment: "http://"
    },
  },
  "mcp": { "github": { "type": "local", "command": ["gh-mcp"] } }
}
`;

test('an entry added and then removed gives back the same bytes, comments and all', () => {
  const entry = { npm: '@ai-sdk/openai-compatible', models: { 'nomic-embed-text': {} } };
  const added = setIn(commented, ['provider', 'nomic-embed'], entry);
  expect(parseJsonc(added).provider['nomic-embed']).toEqual(entry);
  expect(added).toContain('// the models this machine runs');
  expect(added).toContain('    "nomic-embed": {\n      "npm"');
  expect(removeIn(added, ['provider', 'nomic-embed'])).toBe(commented);
});

test('a section that is not there is created, and one member on a line stays on it', () => {
  const added = setIn(commented, ['agent', 'reviewer'], { model: 'x' });
  expect(parseJsonc(added).agent).toEqual({ reviewer: { model: 'x' } });
  const inline = setIn(commented, ['mcp', 'playwright'], { type: 'local' });
  expect(inline).toContain('"command": ["gh-mcp"] }, "playwright": {');
  expect(removeIn(inline, ['mcp', 'playwright'])).toBe(commented);
});

test('an existing member keeps its place and only its value changes', () => {
  const text = '{\n\t"a": 1,\n\t"b": 2\n}\n';
  expect(setIn(text, ['a'], { on: true })).toBe('{\n\t"a": {\n\t\t"on": true\n\t},\n\t"b": 2\n}\n');
});

test('the first, a middle and the only member can each be removed', () => {
  const text = '{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}';
  expect(removeIn(text, ['a'])).toBe('{\n  "b": 2,\n  "c": 3\n}');
  expect(removeIn(text, ['b'])).toBe('{\n  "a": 1,\n  "c": 3\n}');
  expect(removeIn('{ "only": {} }', ['only'])).toBe('{}');
  expect(removeIn(text, ['missing'])).toBe(text);
  expect(removeIn(text, ['a', 'deeper'])).toBe(text);
});

test('after a trailing comma the new member gets a line of its own, and the comment stays put', () => {
  const text = '{\n  "mcp": {\n    "git": {}, // kept\n  }\n}\n';
  const added = setIn(text, ['mcp', 'fetch'], { type: 'local' });
  expect(added).toBe(
    '{\n  "mcp": {\n    "git": {}, // kept\n    "fetch": {\n      "type": "local"\n    },\n  }\n}\n'
  );
  expect(removeIn(added, ['mcp', 'fetch'])).toBe(text);
  // A member removed with its line takes its own comment with it.
  expect(removeIn('{\n  "a": 1,\n  "b": 2, // b\n  "c": 3\n}', ['b'])).toBe(
    '{\n  "a": 1,\n  "c": 3\n}'
  );
});

test('an empty object takes a member on a line of its own', () => {
  expect(setIn('{\n  "mcp": {}\n}', ['mcp', 'x'], 1)).toBe('{\n  "mcp": {\n    "x": 1\n  }\n}');
});

test('braces and comment markers inside strings are not structure', () => {
  const text = '{ "glob": "src/**/*.ts", "url": "https://x/{y}", "n": -1.5e3 }';
  const added = setIn(text, ['z'], true);
  expect(parseJsonc(added)).toMatchObject({ glob: 'src/**/*.ts', url: 'https://x/{y}', z: true });
  expect(removeIn(added, ['z'])).toBe(text);
});
