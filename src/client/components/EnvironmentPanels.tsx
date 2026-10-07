import { type ReactNode, useEffect, useState } from 'react';
import type {
  InfrastructureScanResponse,
  MachineModes,
  RepoScanResponse,
  UnmappedResponse,
} from '../../shared/api';
import { formatRelativeTime } from '../../shared/format';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';

/**
 * The two scans the server has always computed and nothing has ever drawn.
 *
 * `/api/repos/scan` opens every repository's own agent config and reports how
 * far it has drifted from the global one; `/api/infrastructure/scan` probes
 * the devices and services named in a manifest, and the local Docker socket. Both shipped with no caller in
 * the client, so the work was done on request and thrown away. They sit in the
 * side panel rather than on the map because neither is a capability: one is a
 * comparison between configs, the other is a reading taken just now.
 */

/** Waiting, or a scan that had nothing to say. Same shape for both panels. */
function PanelNote({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="tp-empty tp-empty--note">
      {icon}
      <div>{children}</div>
    </div>
  );
}

function RepoEmptyIllustration() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      className="tp-empty-graphic"
      aria-hidden="true"
    >
      <rect x="8" y="10" width="32" height="28" rx="4" strokeWidth="1.6" strokeDasharray="3 2" />
      <circle cx="18" cy="18" r="2.5" strokeWidth="1.6" />
      <circle cx="18" cy="30" r="2.5" strokeWidth="1.6" />
      <circle cx="30" cy="24" r="2.5" strokeWidth="1.6" />
      <path
        d="M18 20.5 V27.5 M18 20.5 C18 24 30 20 30 24"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function InfraEmptyIllustration() {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      className="tp-empty-graphic"
      aria-hidden="true"
    >
      <rect x="8" y="9" width="32" height="12" rx="3" strokeWidth="1.6" />
      <rect x="8" y="27" width="32" height="12" rx="3" strokeWidth="1.6" />
      <circle cx="14" cy="15" r="1.5" fill="currentColor" />
      <circle cx="14" cy="33" r="1.5" fill="currentColor" />
      <line x1="20" y1="15" x2="34" y2="15" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <line x1="20" y1="33" x2="34" y2="33" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <path d="M24 21 V27" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  );
}

/**
 * A server the global config has and this repository's does not, with the
 * entry ready to paste. The endpoint composes it and the person pastes it: an
 * MCP entry carries a command the runtime executes, so it crosses into a
 * config only by their own hand.
 */
function MissingServer({ name }: { name: string }) {
  const snippetFor = useAmbitStore(s => s.snippetFor);
  const known = useAmbitStore(s => Boolean(s.configMcp[name]));
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  if (!known) return <span>{name}</span>;
  return (
    <button
      type="button"
      className="tp-inline-btn"
      title={`Copy the global entry for ${name}, ready to paste into this repository's config`}
      onClick={async () => {
        const snippet = await snippetFor(name);
        if (snippet) {
          navigator.clipboard?.writeText(snippet);
          setState('copied');
        } else setState('failed');
        setTimeout(() => setState('idle'), 2000);
      }}
    >
      {name}
      <span className="tp-inline-hint">
        {state === 'copied' ? 'copied' : state === 'failed' ? 'no entry' : 'copy entry'}
      </span>
    </button>
  );
}

export function RepoDriftPanel({ scan }: { scan: RepoScanResponse | null }) {
  if (!scan) return <PanelNote>Reading each repository’s config…</PanelNote>;
  if (!scan.repos.length) {
    return (
      <PanelNote icon={<RepoEmptyIllustration />}>
        No repository carries its own <code>opencode.json</code>. Nothing has drifted, because
        nothing is local yet.
      </PanelNote>
    );
  }

  const ranked = [...scan.repos].sort((a, b) => b.drift - a.drift);
  return (
    <div className="tp-list">
      <p className="tp-note">
        Global: {scan.globalStats.mcps} servers, {scan.globalStats.agents} agents,{' '}
        {scan.globalStats.commands} commands. Each row is how far that repository differs.
      </p>
      {ranked.map(r => (
        <div key={r.name} className="tp-item tp-item--static">
          <div className="tp-item-hdr">
            <span className="tp-item-name">{r.name}</span>
            <span className="tp-badge">{Math.round(r.drift)}% drift</span>
          </div>
          <div className="tp-item-meta">
            {r.uniqueMcps.length > 0 && <span>only here: {r.uniqueMcps.join(', ')}. </span>}
            {r.missingMcps.length > 0 && (
              <span>
                missing:{' '}
                {r.missingMcps.map((m, i) => (
                  <span key={m}>
                    {i > 0 ? ', ' : ''}
                    <MissingServer name={m} />
                  </span>
                ))}
                .{' '}
              </span>
            )}
            {r.uniqueAgents.length > 0 && <span>agents: {r.uniqueAgents.join(', ')}. </span>}
            {r.defaultAgent && <span>default agent: {r.defaultAgent}.</span>}
            {!r.uniqueMcps.length && !r.missingMcps.length && !r.uniqueAgents.length && (
              <span>Same servers and agents as the global config.</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Re-renders on a timer, so a label computed from the clock does not go on saying "just now". */
function useTick(ms = 15_000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/**
 * When the scan was taken, from the scan itself and the clock now: how old the
 * reading in front of you is, and never when a machine last answered. That
 * one is a record `ambit incidents` leaves in the graph, and it has a column
 * of its own, so a machine that has gone quiet never reads as probed just now.
 * A clock a little ahead of ours is still just now.
 */
function probedLabel(generatedAt: string): string | undefined {
  const at = Date.parse(generatedAt);
  if (!Number.isFinite(at)) return undefined;
  return Date.now() - at < 10_000 ? 'just now' : formatRelativeTime(at);
}

/** What the gate said, in the words the map uses for the same three answers. */
const DECISION_WORDS = { ALLOW: 'without asking', CONFIRM: 'asks first', DENY: 'refused' } as const;

function MachineModesList({ machine }: { machine: MachineModes }) {
  return (
    <ul className="infra-modes" aria-label={`What an agent may do on ${machine.target}`}>
      {machine.actions.map(a => (
        <li
          key={a.id}
          className={`infra-mode infra-mode--${a.decision.toLowerCase()}`}
          title={a.reason}
        >
          {a.name.replace(/_/g, ' ')}
          <span className="infra-mode-word">{DECISION_WORDS[a.decision]}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The devices and services in the manifest, and the local Docker engine, as a
 * live reading: a status, a name, how old the reading is, when each last
 * answered, and for each machine what an agent may do there without asking.
 *
 * The modes are the gate's answer with the machine as the target, from this
 * machine's own grants. A service is not a machine and is not asked. A row the
 * scan had nothing to probe says so and never claims it was probed just now.
 * Last seen and the tags come from the graph: the time is the last answer a
 * typed `ambit incidents` got, the scan here records nothing, and a row with
 * neither in the graph shows a dash and no tags.
 */
export function InfrastructurePanel({
  scan,
  onProbe,
}: {
  scan: InfrastructureScanResponse | null;
  onProbe?: () => void;
}) {
  useTick();
  if (!scan) return <PanelNote>Probing the hosts in your manifest…</PanelNote>;
  if (!scan.nodes.length) {
    return (
      <PanelNote icon={<InfraEmptyIllustration />}>
        No manifest at <code>~/.config/opencode/infrastructure.json</code>, and no Docker socket.
        List the devices and services you run in the manifest and this becomes a live reading of
        them, with any containers the local engine reports beside them — no addresses are built in.
      </PanelNote>
    );
  }

  const { online, degraded, offline, unknown } = scan.summary;
  const probed = probedLabel(scan.generatedAt);
  const modes = new Map((scan.machines ?? []).map(m => [m.id, m]));
  const recorded = new Map((scan.recorded ?? []).map(r => [r.id, r]));
  return (
    <div className="tp-list">
      <div className="infra-head">
        <p className="tp-note">
          {online} online · {degraded} degraded · {offline} offline · {unknown} unknown.
          {probed ? ` Probed ${probed}.` : ''} Last seen is the last answer{' '}
          <code>ambit incidents</code> got.
        </p>
        {onProbe && (
          <button type="button" className="tp-inline-btn" onClick={onProbe}>
            Probe again
          </button>
        )}
      </div>
      {scan.findings.map(f => (
        <p key={f.message} className={`tp-finding tp-finding--${f.severity}`}>
          {f.message}
        </p>
      ))}
      <div className="infra-table-wrap">
        <table className="infra-table">
          <caption className="sr-only">
            Devices and services, when each was probed and last seen, and what an agent may do on
            each machine
          </caption>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Name</th>
              <th scope="col">Probed</th>
              <th scope="col">Last seen</th>
              <th scope="col">Agents may, on this machine</th>
            </tr>
          </thead>
          <tbody>
            {scan.nodes.map(n => {
              const machine = modes.get(n.id);
              const record = recorded.get(n.id);
              const seen = record?.lastSeenAt ? stampDate(record.lastSeenAt) : undefined;
              return (
                <tr key={n.id}>
                  <td>
                    <span className={`tp-badge tp-badge--${n.status}`}>{n.status}</span>
                  </td>
                  <td>
                    <span className="tp-item-name">{n.name}</span>
                    <span className="infra-kind">
                      {n.kind} · {n.description}
                    </span>
                    {record?.tags && (
                      <ul className="infra-tags" aria-label={`Tags on ${n.name}`}>
                        {record.tags.map(t => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td>{n.status === 'unknown' ? 'not probed' : (probed ?? '—')}</td>
                  <td>
                    {seen ? (
                      <time dateTime={seen.toISOString()}>{formatRelativeTime(seen)}</time>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{machine ? <MachineModesList machine={machine} /> : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** SQLite's `datetime('now')` is UTC with no zone; the moment it names, or nothing if it will not parse. */
function stampDate(stamp: string): Date | undefined {
  const d = new Date(stamp.includes('T') ? stamp : `${stamp.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** A stored time as a label, or nothing if it will not parse. */
function usedAgo(stamp: string): string {
  const d = stampDate(stamp);
  return d ? formatRelativeTime(d) : '';
}

/**
 * What the agents used that no node on the map accounts for.
 *
 * The map can only show what the curated tree names, so a server used every
 * day and matched by nothing looked like no part of the range at all. This
 * lists it, by the entry it came from, with when it was last used and never
 * how often; and it offers the overlay that would put it on the map, as text
 * to paste. Nothing here writes a file.
 */
export function UnmappedPanel({ report }: { report: UnmappedResponse | null }) {
  const [copied, copy] = useCopied();
  if (!report) return <PanelNote>Reading the work ledger…</PanelNote>;
  if (!report.seen) {
    return (
      <PanelNote>
        No tool use recorded in the last {report.days} days, so there is nothing to compare with the
        map yet. <code>plugins/ambit-telemetry.js</code> records it: copy it into{' '}
        <code>~/.config/opencode/plugins/</code>.
      </PanelNote>
    );
  }
  if (!report.unmapped.length) {
    return (
      <PanelNote>
        Every tool the agents used in the last {report.days} days ({report.seen}{' '}
        {report.seen === 1 ? 'tool' : 'tools'}) is accounted for by a node on the map.
      </PanelNote>
    );
  }
  return (
    <div className="tp-list">
      <p className="tp-note">
        Used in the last {report.days} days, and on no node of the map: the part of the range the
        curated tree does not name. A server that supplies only Tool Protocol is listed, since that
        node says nothing about what it does.
      </p>
      {report.unmapped.map(u => {
        const ago = usedAgo(u.lastUsed);
        return (
          <div key={u.entry?.id ?? u.tools[0]} className="tp-item tp-item--static">
            <div className="tp-item-hdr">
              <span className="tp-item-name">{u.entry?.name ?? u.tools[0]}</span>
              {ago && <span className="tp-badge">used {ago}</span>}
            </div>
            <div className="tp-item-meta">
              {u.entry
                ? u.tools.join(' · ')
                : 'a tool with no config entry, so no overlay can match it'}
            </div>
          </div>
        );
      })}
      {report.overlay && (
        <div className="setup-overlay">
          <div className="tp-item-hdr">
            <span className="tp-item-name">Put them on the map</span>
            <button
              type="button"
              className="tp-inline-btn"
              onClick={() => copy('overlay', report.overlay!)}
            >
              {copied === 'overlay' ? 'Copied ✓' : 'Copy overlay'}
            </button>
          </div>
          {report.overlay_note && <p className="tp-note">{report.overlay_note}</p>}
          <pre className="setup-briefing-text">{report.overlay}</pre>
        </div>
      )}
    </div>
  );
}
