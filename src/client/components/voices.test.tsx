/**
 * Who acted, and an ask with its answer.
 *
 * A mark is drawn only for an actor whose id says what it is: a guessed
 * avatar is an identity nobody declared. A bubble holds what the ledger
 * recorded and never a sentence Ambit wrote in someone's voice.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { actorKind, actorLabel, monogram } from '../utils/actors';
import { ActorMark } from './ActorMark';
import { Callout } from './civ/marks';
import { Seal } from './figures';

test('an actor id names its kind by prefix, and an unknown one names none', () => {
  expect(actorKind('human:web')).toBe('person');
  expect(actorKind('human:kanav')).toBe('person');
  expect(actorKind('agent')).toBe('agent');
  expect(actorKind('agent:researcher')).toBe('agent');
  expect(actorKind('device:nas')).toBe('machine');
  expect(actorKind('ambit')).toBe('system');
  expect(actorKind('mcp:github')).toBeNull();
  expect(actorKind(undefined)).toBeNull();
});

test('the person at this page is "you", whichever id recorded them', () => {
  for (const id of ['human:web', 'human:you']) {
    expect(monogram(id)).toBe('Y');
    expect(actorLabel(id)).toBe('you');
  }
  expect(monogram('agent:code-reviewer')).toBe('Cr');
  expect(monogram('human:kanav')).toBe('Ka');
});

test('a mark is drawn for a known kind, in its own shape, and for nothing else', () => {
  const person = renderToStaticMarkup(<ActorMark id="human:web" />);
  expect(person).toContain('actor-mark--person');
  expect(person).toContain('<circle');
  expect(person).toContain('aria-label="person: you"');
  expect(renderToStaticMarkup(<ActorMark id="agent:x" />)).toContain('<rect');
  expect(renderToStaticMarkup(<ActorMark id="device:nas" />)).toContain('<polygon');
  expect(renderToStaticMarkup(<ActorMark id="mcp:github" />)).toBe('');
  expect(renderToStaticMarkup(<ActorMark id={null} />)).toBe('');
  // Beside a name that already says who, it is not read a second time.
  expect(renderToStaticMarkup(<ActorMark id="human:web" decorative />)).toContain(
    'aria-hidden="true"'
  );
});

test('the seal is named only when it stands for something on its own', () => {
  expect(renderToStaticMarkup(<Seal />)).toContain('aria-hidden="true"');
  expect(renderToStaticMarkup(<Seal label="signed" />)).toContain('aria-label="signed"');
});

test('the outage callout says what went down, in capitals, with the count', () => {
  const html = renderToStaticMarkup(
    <svg>
      <title>callout</title>
      <Callout r={22} text="DOWN · STOPS 10" color="var(--error)" />
    </svg>
  );
  expect(html).toContain('DOWN · STOPS 10');
  expect(html).toContain('class="civ-callout"');
});
