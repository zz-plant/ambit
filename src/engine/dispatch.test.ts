/**
 * Out-of-band approval dispatch (roadmap §12.10).
 *
 * The push is one HTTP POST, so the tests capture what would be sent instead
 * of sending it: the dialect per service, the decision a draft carries, the
 * signed artifact an approval carries, and the refusal to send anywhere that
 * was not configured.
 */
import { test, expect, afterEach } from 'vitest';
import { APPLIABLE, cli, cliAsync, getDb, join, dir, seed } from './testing/cli.ts';
import {
  detectKind,
  dispatchProposal,
  dispatchPending,
  proposalMessage,
  webhookRequest,
} from './dispatch.ts';
import type { ProposalRow } from './rows.ts';

afterEach(() => {
  delete process.env.AMBIT_APPROVAL_WEBHOOK;
  delete process.env.AMBIT_APPROVAL_WEBHOOK_KIND;
  delete process.env.AMBIT_TELEGRAM_CHAT_ID;
  delete process.env.PUSHOVER_USER;
  delete process.env.PUSHOVER_TOKEN;
});

/** A fetch that records the request and answers 200. */
function recorder(status = 200) {
  const calls: Array<{ url: string; init: any }> = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init });
    return { ok: status < 400, status, statusText: status < 400 ? 'OK' : 'Refused' } as Response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test('detectKind reads the service off the host', () => {
  expect(detectKind('https://hooks.slack.com/services/T0/B0/x')).toBe('slack');
  expect(detectKind('https://discord.com/api/webhooks/1/abc')).toBe('discord');
  expect(detectKind('https://api.telegram.org/bot123:abc/sendMessage')).toBe('telegram');
  expect(detectKind('https://ntfy.sh/ambit')).toBe('ntfy');
  expect(detectKind('https://api.pushover.net/1/messages.json')).toBe('pushover');
  expect(detectKind('https://example.internal/hook')).toBe('generic');
  expect(detectKind('not a url')).toBe('generic');
});

test('nothing is sent without a configured webhook', async () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const r = await cliAsync('dispatch', p.proposal);
  expect(r.error).toContain('No webhook configured');

  const db = getDb(join(dir, 'graph.db'));
  const row = db
    .prepare('SELECT dispatched_at FROM proposals WHERE id = ?')
    .get<ProposalRow>(p.proposal)!;
  expect(row.dispatched_at).toBeNull();
  db.close();
});

test('a draft dispatches the decision and the commands that make it', async () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const { calls, fetchImpl } = recorder();

  const db = getDb(join(dir, 'graph.db'));
  const r = await dispatchProposal(db, p.proposal, {
    to: 'https://hooks.slack.com/services/T0/B0/x',
    fetchImpl,
  });
  expect(r.dispatched).toBe(p.proposal);
  expect(r.kind).toBe('slack');
  expect(r.signed).toBe(false);

  expect(calls).toHaveLength(1);
  const body = JSON.parse(calls[0].init.body);
  expect(body.text).toContain(p.proposal);
  expect(body.text).toContain(`ambit approve ${p.proposal}`);
  expect(body.text).toContain(`ambit reject ${p.proposal}`);

  const row = db
    .prepare('SELECT dispatched_at, dispatched_to FROM proposals WHERE id = ?')
    .get<ProposalRow>(p.proposal)!;
  expect(row.dispatched_at).toBeTruthy();
  expect(row.dispatched_to).toBe('slack');
  db.close();
});

test('an approved proposal dispatches its signed artifact', async () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  cli('approve', p.proposal, 'kanav');
  const { calls, fetchImpl } = recorder();

  const db = getDb(join(dir, 'graph.db'));
  const r = await dispatchProposal(db, p.proposal, {
    to: 'https://example.internal/hook',
    fetchImpl,
  });
  expect(r.kind).toBe('generic');
  expect(r.signed).toBe(true);

  const body = JSON.parse(calls[0].init.body);
  expect(body.event).toBe('proposal.approved');
  expect(body.artifact.sig).toMatch(/^[0-9a-f]{64}$/);
  const stored = JSON.parse(
    db.prepare('SELECT approval_artifact FROM proposals WHERE id = ?').get<ProposalRow>(p.proposal)!
      .approval_artifact!
  );
  // The receipt on the phone is the receipt apply verifies.
  expect(body.artifact).toEqual(stored);
  expect(body.text).toContain(`ambit apply ${p.proposal}`);
  db.close();
});

test('each service gets its own dialect', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const db = getDb(join(dir, 'graph.db'));
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get<ProposalRow>(p.proposal)!;
  db.close();
  const message = proposalMessage(row);

  const discord = webhookRequest(
    { url: 'https://discord.com/api/webhooks/1/abc', kind: 'discord' },
    message,
    row
  ) as any;
  expect(JSON.parse(discord.body).content).toContain(p.proposal);

  const ntfy = webhookRequest({ url: 'https://ntfy.sh/ambit', kind: 'ntfy' }, message, row) as any;
  expect(ntfy.headers['Content-Type']).toBe('text/plain');
  expect(ntfy.headers.Title).toContain('Ambit');
  expect(ntfy.body).toContain(p.proposal);

  // Telegram: the chat id moves from the query into the body, and a bare bot
  // URL gets its method.
  const telegram = webhookRequest(
    { url: 'https://api.telegram.org/bot123:abc?chat_id=42', kind: 'telegram' },
    message,
    row
  ) as any;
  expect(telegram.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
  expect(JSON.parse(telegram.body)).toMatchObject({ chat_id: '42' });

  const noChat = webhookRequest(
    { url: 'https://api.telegram.org/bot123:abc', kind: 'telegram' },
    message,
    row
  ) as any;
  expect(noChat.error).toContain('chat');
});

test('a refused push is reported and leaves the proposal unmarked', async () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const { fetchImpl } = recorder(403);
  const db = getDb(join(dir, 'graph.db'));
  const r = await dispatchProposal(db, p.proposal, {
    to: 'https://api.telegram.org/bot123:secret/sendMessage?chat_id=1',
    fetchImpl,
  });
  expect(r.error).toContain('403');
  const row = db
    .prepare('SELECT dispatched_at FROM proposals WHERE id = ?')
    .get<ProposalRow>(p.proposal)!;
  expect(row.dispatched_at).toBeNull();
  db.close();
});

test('the bot token never appears in what dispatch reports', async () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const { fetchImpl } = recorder();
  const db = getDb(join(dir, 'graph.db'));
  const r = await dispatchProposal(db, p.proposal, {
    to: 'https://api.telegram.org/bot123:secret/sendMessage?chat_id=1',
    fetchImpl,
  });
  expect(JSON.stringify(r)).not.toContain('secret');
  expect(r.to).toContain('bot***');
  db.close();
});

test('propose --dispatch and approve --dispatch push in the same breath', async () => {
  seed(APPLIABLE).close();
  // No webhook configured: the draft is still made, and the push says why it
  // did not happen rather than failing the propose.
  const p = await cliAsync('propose', 'web-research', '--dispatch');
  expect(p.proposal).toMatch(/^prop-/);
  expect(p.dispatch.error).toContain('No webhook configured');

  const a = await cliAsync('approve', p.proposal, 'kanav', '--dispatch');
  expect(a.approved_by).toBeTruthy();
  expect(a.dispatch.error).toContain('No webhook configured');
});

test('pushover receives token and user formatted payload', () => {
  seed(APPLIABLE).close();
  const p = cli('propose', 'web-research');
  const db = getDb(join(dir, 'graph.db'));
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get<ProposalRow>(p.proposal)!;
  db.close();
  const message = proposalMessage(row);

  const pushover = webhookRequest(
    { url: 'https://api.pushover.net/1/messages.json?user=u123&token=t456', kind: 'pushover' },
    message,
    row
  ) as any;
  expect(pushover.url).toBe('https://api.pushover.net/1/messages.json');
  const parsed = JSON.parse(pushover.body);
  expect(parsed.user).toBe('u123');
  expect(parsed.token).toBe('t456');
  expect(parsed.message).toContain(p.proposal);

  const missingToken = webhookRequest(
    { url: 'https://api.pushover.net/1/messages.json', kind: 'pushover' },
    message,
    row
  ) as any;
  expect(missingToken.error).toContain('Pushover needs user and token');
});

test('dispatch pending pushes all draft proposals', async () => {
  seed(APPLIABLE).close();
  const p1 = cli('propose', 'web-research');
  const { calls, fetchImpl } = recorder();

  const db = getDb(join(dir, 'graph.db'));
  const r = await dispatchPending(db, {
    to: 'https://hooks.slack.com/services/T0/B0/x',
    fetchImpl,
  });
  expect(r.count).toBeGreaterThanOrEqual(1);
  expect(calls.length).toBeGreaterThanOrEqual(1);
  const row = db
    .prepare('SELECT dispatched_at FROM proposals WHERE id = ?')
    .get<ProposalRow>(p1.proposal)!;
  expect(row.dispatched_at).toBeTruthy();
  db.close();
});
