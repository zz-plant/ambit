/**
 * What a card's own buttons send.
 *
 * The routes they call decide as the person at the page and refuse a proposal
 * that is not what the card showed, so the request carries the hash the card
 * was drawn from and nothing that names a person. The routes themselves are
 * held in api.test.ts; this holds the page's half of the contract.
 */
import { afterEach, expect, test, vi } from 'vitest';
import type { ProposalRow } from '../../shared/api';
import { useAmbitStore } from './ambitStore';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A stand-in for the API that records what the decision routes were sent. */
function fakeApi() {
  const sent: { path: string; body: any }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (path === '/api/health') return reply({ status: 'ok' });
      if (path === '/api/proposals') return reply({ proposals: [] });
      if (/^\/api\/proposals\/[^/]+\/(approve|reject)$/.test(path)) {
        sent.push({ path, body: JSON.parse(String(init?.body)) });
        return reply({ proposal: 'prop-1', approved_by: 'human:web', artifact: undefined });
      }
      return reply({ error: `unexpected ${path}` }, 404);
    })
  );
  return sent;
}

const draft = { id: 'prop-1', status: 'draft', proposal_hash: 'abc123' } as ProposalRow;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useAmbitStore.setState({ demo: false, proposals: [] });
});

test('approving from a card sends the hash it was drawn from, and no actor', async () => {
  const sent = fakeApi();
  useAmbitStore.setState({ demo: false, proposals: [draft] });

  expect((await useAmbitStore.getState().approveProposal('prop-1')).ok).toBe(true);

  expect(sent).toEqual([
    { path: '/api/proposals/prop-1/approve', body: { proposalHash: 'abc123' } },
  ]);
});

test('turning a card down sends the hash and the reason, and no actor', async () => {
  const sent = fakeApi();
  useAmbitStore.setState({ demo: false, proposals: [draft] });

  expect((await useAmbitStore.getState().rejectProposal('prop-1', 'not this quarter')).ok).toBe(
    true
  );

  expect(sent).toEqual([
    {
      path: '/api/proposals/prop-1/reject',
      body: { proposalHash: 'abc123', reason: 'not this quarter' },
    },
  ]);
});

test('a proposal the page no longer holds is sent with no hash, so the server refuses it', async () => {
  const sent = fakeApi();
  useAmbitStore.setState({ demo: false, proposals: [] });

  await useAmbitStore.getState().approveProposal('prop-gone');

  // JSON drops an undefined field: the server answers "name the proposalHash".
  expect(sent[0].body).toEqual({});
});
