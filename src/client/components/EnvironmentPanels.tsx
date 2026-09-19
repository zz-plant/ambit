import { type ReactNode, useState } from 'react';
import type { InfrastructureScanResponse, RepoScanResponse } from '../../shared/api';
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
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" className="tp-empty-graphic" aria-hidden="true">
      <rect x="8" y="10" width="32" height="28" rx="4" strokeWidth="1.6" strokeDasharray="3 2" />
      <circle cx="18" cy="18" r="2.5" strokeWidth="1.6" />
      <circle cx="18" cy="30" r="2.5" strokeWidth="1.6" />
      <circle cx="30" cy="24" r="2.5" strokeWidth="1.6" />
      <path d="M18 20.5 V27.5 M18 20.5 C18 24 30 20 30 24" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function InfraEmptyIllustration() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" className="tp-empty-graphic" aria-hidden="true">
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

export function InfrastructurePanel({ scan }: { scan: InfrastructureScanResponse | null }) {
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
  return (
    <div className="tp-list">
      <p className="tp-note">
        {online} online · {degraded} degraded · {offline} offline · {unknown} unknown. Probed{' '}
        {new Date(scan.generatedAt).toLocaleTimeString()}.
      </p>
      {scan.findings.map(f => (
        <p key={f.message} className={`tp-finding tp-finding--${f.severity}`}>
          {f.message}
        </p>
      ))}
      {scan.nodes.map(n => (
        <div key={n.id} className="tp-item tp-item--static">
          <div className="tp-item-hdr">
            <span className="tp-item-name">{n.name}</span>
            <span className={`tp-badge tp-badge--${n.status}`}>{n.status}</span>
          </div>
          <div className="tp-item-meta">
            {n.kind} — {n.description}
          </div>
        </div>
      ))}
    </div>
  );
}
