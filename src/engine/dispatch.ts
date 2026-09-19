import type { Migratable } from './migrate.ts';
import type { ProposalRow } from './rows.ts';
import { draftSummary } from './attention.ts';

/**
 * Out-of-band approval dispatch (roadmap §12.10).
 *
 * A long-running agent drafts a proposal and the loop stalls until someone at
 * the machine opens a terminal. This pushes the decision to wherever the
 * person already is — a Slack channel, a Discord channel, a Telegram chat, an
 * ntfy topic, or any endpoint that takes JSON — carrying the goal, the cost,
 * what it unlocks and the exact commands that decide it. Once approved, the
 * same push carries the signed artifact, so the receipt on the phone is the
 * receipt `ambit apply` will verify.
 *
 * What it never does: mint an approval. A webhook is a one-way channel out.
 * The reply comes back through `ambit approve <id> <person>` on a machine that
 * holds the approval key, which is what keeps a compromised chat from granting
 * anything.
 */

type WebhookKind = 'slack' | 'discord' | 'telegram' | 'ntfy' | 'pushover' | 'generic';

interface WebhookTarget {
  url: string;
  kind: WebhookKind;
}

/**
 * Where to push, and in what dialect.
 *
 * An explicit URL wins; `AMBIT_APPROVAL_WEBHOOK` is the standing choice. The
 * dialect is read off the host so nobody has to say "this is Slack" — and
 * `AMBIT_APPROVAL_WEBHOOK_KIND` overrides for a proxy on an unfamiliar host.
 */
function webhookTarget(explicit?: string): WebhookTarget | null {
  const url = explicit || process.env.AMBIT_APPROVAL_WEBHOOK;
  if (!url) return null;
  const forced = process.env.AMBIT_APPROVAL_WEBHOOK_KIND as WebhookKind | undefined;
  return { url, kind: forced && KINDS.has(forced) ? forced : detectKind(url) };
}

const KINDS = new Set<WebhookKind>(['slack', 'discord', 'telegram', 'ntfy', 'pushover', 'generic']);

function detectKind(url: string): WebhookKind {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    return 'generic';
  }
  if (host === 'hooks.slack.com') return 'slack';
  if (host === 'discord.com' || host === 'discordapp.com') return 'discord';
  if (host === 'api.telegram.org') return 'telegram';
  if (host === 'api.pushover.net') return 'pushover';
  if (host === 'ntfy.sh' || host.startsWith('ntfy.')) return 'ntfy';
  const own = process.env.NTFY_SERVER;
  if (own) {
    try {
      if (new URL(own).hostname === host) return 'ntfy';
    } catch {}
  }
  return 'generic';
}

/** The URL as it may appear in output: secrets are redacted. */
function redact(url: string): string {
  return url.replace(/\/bot[^/]+/, '/bot***').replace(/([?&]token=)[^&]+/, '$1***');
}

/**
 * What the person on the other end reads.
 *
 * Draft: the decision, with the commands that make it. Approved: the signed
 * artifact, so what they see is what apply will verify. Anything else:
 * the status, since a push about a rejected or applied proposal is a
 * notification and not a request.
 */
function proposalMessage(row: ProposalRow) {
  const summary = draftSummary(row);
  const lines: string[] = [];
  let title: string;
  let artifact: any;

  if (row.status === 'draft') {
    title = 'Ambit · a proposal waits on you';
    const buys = summary.unlocks ? `, unlocks ${summary.unlocks.slice(0, 3).join(', ')}` : '';
    const bill = summary.recurring ? `, ${summary.recurring}` : '';
    lines.push(`${row.id}: ${row.goal} — ${summary.cost}${bill}${buys}`);
    if (summary.privacy) lines.push(`Privacy: ${summary.privacy}`);
    lines.push(`Approve: ambit approve ${row.id} <your name>`);
    lines.push(`Decline: ambit reject ${row.id} <your name> "why"`);
  } else if (row.status === 'approved') {
    title = 'Ambit · approved, awaiting apply';
    lines.push(`${row.id}: ${row.goal} — approved by ${row.approved_by || 'someone'}`);
    if (row.approval_artifact) {
      try {
        artifact = JSON.parse(row.approval_artifact);
        lines.push(`Signed ${artifact.timestamp}, expires ${artifact.expires_at}`);
        lines.push(`Signature ${String(artifact.sig).slice(0, 16)}…`);
      } catch {}
    }
    lines.push(`Apply: ambit apply ${row.id}`);
  } else {
    title = `Ambit · proposal ${row.status}`;
    lines.push(`${row.id}: ${row.goal} is ${row.status}.`);
  }

  return { title, text: lines.join('\n'), summary, artifact };
}

interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

/**
 * One message, in the dialect each service accepts.
 *
 * Slack and Discord take a text field and nothing else is needed. Telegram
 * wants a chat id beside the text: read from the URL's query (`?chat_id=`) or
 * `AMBIT_TELEGRAM_CHAT_ID`, and a bare `/bot<token>` URL gets `/sendMessage`
 * appended. ntfy takes plain text with a title header. Anything else gets the
 * whole record as JSON, artifact included, for a receiver that wants to render
 * it its own way.
 */
function webhookRequest(
  target: WebhookTarget,
  message: ReturnType<typeof proposalMessage>,
  row: ProposalRow
): WebhookRequest | { error: string } {
  const json = { 'Content-Type': 'application/json' };
  switch (target.kind) {
    case 'slack':
      return {
        url: target.url,
        headers: json,
        body: JSON.stringify({ text: `*${message.title}*\n${message.text}` }),
      };
    case 'discord':
      return {
        url: target.url,
        headers: json,
        body: JSON.stringify({ content: `**${message.title}**\n${message.text}`.slice(0, 2000) }),
      };
    case 'telegram': {
      let url: URL;
      try {
        url = new URL(target.url);
      } catch {
        return { error: `Not a URL: ${redact(target.url)}` };
      }
      const chatId = url.searchParams.get('chat_id') || process.env.AMBIT_TELEGRAM_CHAT_ID;
      if (!chatId) {
        return {
          error:
            'Telegram needs a chat: put ?chat_id=<id> on the webhook URL or set AMBIT_TELEGRAM_CHAT_ID.',
        };
      }
      url.searchParams.delete('chat_id');
      if (!url.pathname.endsWith('/sendMessage')) {
        url.pathname = `${url.pathname.replace(/\/$/, '')}/sendMessage`;
      }
      return {
        url: url.toString(),
        headers: json,
        body: JSON.stringify({ chat_id: chatId, text: `${message.title}\n${message.text}` }),
      };
    }
    case 'ntfy':
      return {
        url: target.url,
        headers: { 'Content-Type': 'text/plain', Title: message.title },
        body: message.text,
      };
    case 'pushover': {
      let url: URL;
      try {
        url = new URL(target.url);
      } catch {
        return { error: `Not a URL: ${redact(target.url)}` };
      }
      const token = url.searchParams.get('token') || process.env.PUSHOVER_TOKEN;
      const user = url.searchParams.get('user') || process.env.PUSHOVER_USER;
      if (!token || !user) {
        return {
          error:
            'Pushover needs user and token: put ?user=<key>&token=<token> on the webhook URL or set PUSHOVER_USER and PUSHOVER_TOKEN.',
        };
      }
      return {
        url: 'https://api.pushover.net/1/messages.json',
        headers: json,
        body: JSON.stringify({
          token,
          user,
          title: message.title,
          message: message.text,
        }),
      };
    }
    default:
      return {
        url: target.url,
        headers: json,
        body: JSON.stringify({
          source: 'ambit',
          event: `proposal.${row.status}`,
          title: message.title,
          text: message.text,
          proposal: message.summary,
          status: row.status,
          approved_by: row.approved_by || undefined,
          artifact: message.artifact,
        }),
      };
  }
}

export interface DispatchOptions {
  /** Overrides `AMBIT_APPROVAL_WEBHOOK` for this push. */
  to?: string;
  /** Injected in tests; `fetch` otherwise. */
  fetchImpl?: typeof fetch;
}

/**
 * Pushes one proposal to the configured webhook.
 *
 *   ambit dispatch <proposal-id> [--to=<url>]
 *   AMBIT_APPROVAL_WEBHOOK=https://hooks.slack.com/… ambit propose x --dispatch
 *
 * Opt-in like `notify`: with no URL configured nothing leaves the machine, and
 * the answer says so instead of failing quietly. A successful push is recorded
 * on the proposal so the pending report can say it already asked.
 */
async function dispatchProposal(
  db: Migratable,
  proposalId?: string,
  options: DispatchOptions = {}
): Promise<any> {
  if (!proposalId) return { error: 'Usage: ambit dispatch <proposal-id> [--to=<url>]' };
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get<ProposalRow>(proposalId);
  if (!row) return { error: `No proposal ${proposalId}. See ambit proposals.` };

  const target = webhookTarget(options.to);
  if (!target) {
    return {
      error:
        'No webhook configured. Pass --to=<url> or set AMBIT_APPROVAL_WEBHOOK; nothing is sent without one.',
    };
  }

  const message = proposalMessage(row);
  const request = webhookRequest(target, message, row);
  if ('error' in request) return request;

  const send = options.fetchImpl || fetch;
  try {
    const res = await send(request.url, {
      method: 'POST',
      headers: request.headers,
      body: request.body,
    });
    if (!res.ok) {
      return { error: `${target.kind} refused: ${res.status} ${res.statusText}` };
    }
  } catch (e: any) {
    return { error: `Could not reach ${redact(target.url)}: ${e?.message || e}` };
  }

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('UPDATE proposals SET dispatched_at = ?, dispatched_to = ? WHERE id = ?').run(
    now,
    target.kind,
    proposalId
  );

  return {
    dispatched: proposalId,
    status: row.status,
    to: redact(target.url),
    kind: target.kind,
    bytes: request.body.length,
    signed: Boolean(message.artifact),
    note:
      row.status === 'approved'
        ? 'Sent with the signed artifact. Apply still verifies it here.'
        : 'Sent with the decision and the commands that make it. Approval still happens here.',
  };
}

/**
 * Pushes all pending draft proposals to the configured webhook.
 *
 *   ambit dispatch pending [--to=<url>]
 *   ambit dispatch --pending [--to=<url>]
 */
async function dispatchPending(db: Migratable, options: DispatchOptions = {}): Promise<any> {
  const rows = db
    .prepare("SELECT id FROM proposals WHERE status = 'draft' ORDER BY created_at ASC")
    .all<ProposalRow>();
  if (!rows || rows.length === 0) {
    return { dispatched: [], count: 0, note: 'No pending draft proposals to dispatch.' };
  }
  const results = [];
  for (const r of rows) {
    const res = await dispatchProposal(db, r.id, options);
    results.push(res);
  }
  return {
    dispatched: results,
    count: results.length,
  };
}

export {
  webhookTarget,
  detectKind,
  proposalMessage,
  webhookRequest,
  dispatchProposal,
  dispatchPending,
  redact,
};
