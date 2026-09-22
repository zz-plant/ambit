import React from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type { Connection, Item } from '../utils/configImporter';
import {
  typeLabel,
  statusLabel,
  metaKeyLabel,
  isConfigEntry,
  isRuntimeNode,
} from '../utils/labels';
import { costOf, gapOf, outageSplit, readableSeconds, unlockCascade } from './civ/layout';
import { useCopied } from '../hooks/useCopied';
import { Term } from './Term';
import { typeColor, typeSymbol } from '../utils/typeColors';

/**
 * A prerequisite's edge, in the legend's words and not the data model's. The
 * rows used to print `hard-dep` and `soft-dep`, the one place the internal
 * vocabulary reached a reader.
 */
const prerequisiteLabel = (conn: Connection) =>
  conn.type === 'soft-dep' ? 'optional' : 'required';

interface NodeDetailPanelProps {
  /** Show a neighbour where it lives: a node on the map, an entry in My Setup. */
  onShow?: (id: string) => void;
}

/**
 * One direction of a node's edges: what it needs, or what it enables. Keyed
 * with the colour the map draws that direction in, and hidden when empty.
 */
function LinkList({
  title,
  edge,
  links,
  onShow,
}: {
  title: string;
  edge: 'needs' | 'enables';
  links: { node: Item; note?: string }[];
  onShow: (id: string) => void;
}) {
  if (links.length === 0) return null;
  return (
    <div className="sp-links">
      <div className="sp-section-label">
        <span className={`sp-edge-dot sp-edge-dot--${edge}`} aria-hidden="true" />
        {title} ({links.length})
      </div>
      <div className="sp-link-list">
        {links.map(({ node, note }) => (
          <button type="button" key={node.id} className="sp-link" onClick={() => onShow(node.id)}>
            <span className="sp-link-dot" style={{ background: typeColor(node.type) }} />
            <span className="sp-link-name">{node.name}</span>
            {note && <span className="sp-link-type">{note}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NodeDetailPanel({ onShow }: NodeDetailPanelProps = {}) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const selectedId = useAmbitStore(s => s.selectedItem);
  const selectItem = useAmbitStore(s => s.selectItem);
  const simulatedNodeId = useAmbitStore(s => s.simulatedNodeId);
  const startOutage = useAmbitStore(s => s.startOutageSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const startGap = useAmbitStore(s => s.startGapSimulation);
  const clearSim = useAmbitStore(s => s.clearSimulation);
  const backend = useAmbitStore(s => s.backend);
  const toggleMcpEnabled = useAmbitStore(s => s.toggleMcpEnabled);

  const item = items.find(i => i.id === selectedId);
  const [copiedCmd, copy] = useCopied();
  const [toggling, setToggling] = React.useState(false);
  const [toggleError, setToggleError] = React.useState<string | null>(null);

  if (!item) return null;

  const color = typeColor(item.type);

  const lifecycle = item.meta?.lifecycle as string | undefined;
  const lastChecked = item.meta?.lastChecked as string | undefined;
  const agoLabel = (ts?: string) => {
    if (!ts) return undefined;
    const ms = Date.now() - new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z').getTime();
    if (!(ms >= 0)) return undefined;
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `${mins}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / (60 * 24))}d ago`;
  };
  // Gate on the label, not the timestamp: a `lastChecked` the writing and
  // reading clocks disagree about is truthy and names no interval.
  const checkedAgo = agoLabel(lastChecked);
  // One passing run is a weaker claim than forty-seven of fifty, and the line
  // used to read the same for both.
  const reliability = item.meta?.reliability as { passed: number; total: number } | undefined;
  const runs =
    reliability && reliability.total > 1
      ? ` · ${reliability.passed} of ${reliability.total} runs passed`
      : '';
  const authority = item.meta?.authority as { execute: string; observe?: string } | undefined;
  const failures =
    (item.meta?.failures as
      | { class: string; signal: string; times: number; last: string }[]
      | undefined) ?? [];
  const actions =
    (item.meta?.actions as { id: string; name: string; mode: string }[] | undefined) ?? [];
  const daysSinceChange = item.meta?.daysSinceChange as number | undefined;
  const evidence =
    item.status !== 'built' || !lifecycle
      ? undefined
      : lifecycle === 'reliable'
        ? {
            color: 'var(--ok)',
            text: `✓ Check passing consistently${checkedAgo ? ` · last run ${checkedAgo}` : ''}${runs}`,
          }
        : lifecycle === 'verified'
          ? {
              color: 'var(--ok)',
              text: `✓ Check passed${checkedAgo ? ` · last run ${checkedAgo}` : ''}${runs}`,
            }
          : lifecycle === 'degraded' || lifecycle === 'broken'
            ? {
                color: 'var(--error)',
                text: `! Check failing${checkedAgo ? ` · last run ${checkedAgo}` : ''}${runs}`,
              }
            : lifecycle === 'configured'
              ? {
                  color: 'var(--text-muted)',
                  text: 'Configured — never verified. Nothing has demonstrated this works.',
                }
              : undefined;

  const byId = new Map(items.map(i => [i.id, i]));
  // One hop each way, the same two sets the map colours: what this needs, and
  // what it enables. They were one list with an edge word on each row.
  const needs = connections
    .filter(c => c.to === item.id && byId.has(c.from))
    .map(c => ({ node: byId.get(c.from)!, conn: c }));
  const enables = connections
    .filter(c => c.from === item.id && byId.has(c.to))
    .map(c => ({ node: byId.get(c.to)!, conn: c }));
  const neighbors = [...needs, ...enables];

  // The header already says whether a node is reached or being retired. The
  // one thing it cannot say is that a node has no edges at all.
  const isolated = neighbors.length === 0 && !isRuntimeNode(item);

  // Only a config entry names something the config apply route can edit.
  const enabled = item.status === 'built';

  const isKeystone = enables.length >= 3 || isRuntimeNode(item);

  // The transitive answers, stated before the simulations that draw them. The
  // panel used to offer `ambit impact` to copy into a terminal, though the
  // page could answer it: the same walks the simulations run. For a reached
  // node, what stops and what only loses a provider; for one that is not,
  // what stands in the way and what reaching it would reach.
  const split = item.status === 'built' ? outageSplit(items, connections, item.id) : null;
  const gap = item.status === 'built' ? null : gapOf(items, connections, item.id);
  const cascade = item.status === 'built' ? 0 : unlockCascade(items, connections, item.id).size;
  const plural = (n: number) => (n === 1 ? 'capability' : 'capabilities');

  // Details lists only facts that exist and that nothing above has stated. A
  // local MCP server has no url, and a row reading "Url undefined" is noise;
  // false and 0 are real values, so they stay. Lifecycle and the check time are
  // the evidence line, state and next are the status in the header, the era is
  // the column the node sits in, and the setup cost is written as a duration.
  const isStated = (v: unknown) =>
    v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);
  const saidElsewhere = new Set([
    'lifecycle',
    'lastChecked',
    'state',
    'next',
    'era',
    'eraName',
    'setupSeconds',
    'providers',
    'credentials',
    'reliability',
    'authority',
    'failures',
    'actions',
    'daysSinceChange',
  ]);
  const details = Object.entries(item.meta).filter(
    ([k, v]) => !saidElsewhere.has(k) && isStated(v)
  );
  const setup = item.status === 'built' ? '' : costOf(item);

  return (
    <div className="star-panel">
      <div className="sp-grab-bar" aria-hidden="true" />
      <div className="sp-hdr">
        <span className="sp-sig" style={{ color }} aria-hidden="true">
          {typeSymbol(item.type)}
        </span>
        <div className="sp-title-group">
          <div className="sp-designation">{item.name}</div>
          <div className="sp-class">
            {item.type === 'possibility' ? (
              <Term name="combo">{typeLabel(item.type)}</Term>
            ) : item.type === 'mcp-server' ? (
              <Term name="tool-server">{typeLabel(item.type)}</Term>
            ) : (
              typeLabel(item.type)
            )}{' '}
            ·{' '}
            <span className={`sp-status sp-status--${item.status}`}>
              {statusLabel(item.status, item)}
            </span>
          </div>
        </div>
        <button
          type="button"
          className="sp-close"
          onClick={() => selectItem(null)}
          aria-label="Close details"
        >
          ✕
        </button>
      </div>

      {isKeystone && (
        <p className="sp-keystone">
          <span aria-hidden="true">★</span>
          <span>
            <Term name="keystone" /> · {enables.length} other{' '}
            {enables.length === 1 ? 'capability depends' : 'capabilities depend'} on this
          </span>
        </p>
      )}

      {evidence && (
        <p className="sp-evidence" style={{ color: evidence.color }}>
          {evidence.text}
        </p>
      )}

      {/* Whether it may act, apart from whether it can: the engine's effective
          mode, which no web surface used to show, and then the finer answer,
          per action, which is the one an agent acts on. */}
      {authority && (
        <p className="sp-authority">
          {authority.execute === 'autonomous'
            ? 'Acts without asking'
            : authority.execute === 'confirm'
              ? 'Asks before acting'
              : 'Forbidden to act'}
          {authority.observe && authority.observe !== authority.execute
            ? ` · ${
                authority.observe === 'autonomous'
                  ? 'looks without asking'
                  : authority.observe === 'confirm'
                    ? 'asks before looking'
                    : 'may not look'
              }`
            : ''}
        </p>
      )}
      {actions.length > 0 && (
        <ul className="sp-actions" aria-label="What it may do">
          {actions.map(a => (
            <li key={a.id} className={`sp-action sp-action--${a.mode}`}>
              <span className="sp-action-name">{a.name.replace(/_/g, ' ')}</span>
              <span className="sp-action-mode">
                {a.mode === 'autonomous'
                  ? 'without asking'
                  : a.mode === 'confirm'
                    ? 'asks'
                    : 'forbidden'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        The one edit the browser may make to a real config, and only to an
        entry that is already there: `enabled: true|false`. Creating an entry
        stays a hand edit, because an MCP entry carries a command the runtime
        executes — see the security posture in AGENTS.md. Offered only where it
        means something: an entry read out of the config, with an engine behind
        the page to write it back.
      */}
      {backend === 'live' && item.type === 'mcp-server' && isConfigEntry(item) && (
        <div className="sp-toggle-row">
          <div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              className={`sp-switch ${enabled ? 'sp-switch--on' : ''}`}
              disabled={toggling}
              onClick={async () => {
                setToggling(true);
                setToggleError(null);
                const ok = await toggleMcpEnabled(item.name, !enabled);
                if (!ok) setToggleError('Could not write the config. Is it writable?');
                setToggling(false);
              }}
            >
              <span className="sp-switch-knob" aria-hidden="true" />
              {/* The label names what the switch controls; the knob and
                  aria-checked carry the state, which the header states once. */}
              <span className="sp-switch-label">Enabled in your config</span>
            </button>
          </div>
          <p className="sp-toggle-note">
            {toggleError ??
              (enabled
                ? 'Switching this off writes enabled: false to your agent config. Restart the runtime for it to take effect.'
                : 'Switched off in your agent config. Switch it back on here.')}
          </p>
        </div>
      )}

      {/* The impact in one line, then the simulation that draws it: an outage
          for a reached node; the gap, and an unlock, for one that is not. */}
      {(() => {
        const isSimulated = simulatedNodeId === item.id;
        const stops = split?.stops.size ?? 0;
        const weakened = split?.weakened.size ?? 0;
        const missing = gap ? [...gap.missing] : [];
        // Name the direct ones first: they are what to reach, the rest is
        // what those need in turn.
        const direct = missing.filter(id => needs.some(n => n.node.id === id));
        const named = (direct.length ? direct : missing)
          .slice(0, 3)
          .map(id => byId.get(id)?.name || id);
        const more = missing.length - named.length;

        return (
          <div className="sp-sim-group">
            {item.status === 'built' ? (
              <p className="sp-impact">
                {stops
                  ? `If this went down, ${stops} other ${plural(stops)} would stop working${
                      weakened ? ` and ${weakened} would lose a provider` : ''
                    }.`
                  : weakened
                    ? `Nothing else would stop working without it, but ${weakened} ${plural(weakened)} would lose a provider.`
                    : 'Nothing else stops working without it.'}
              </p>
            ) : missing.length ? (
              <p className="sp-impact">
                Blocked by {named.join(', ')}
                {more > 0 ? ` and ${more} more` : ''}
                {gap?.seconds ? `, about ${readableSeconds(gap.seconds)} of setup first` : ''}.
              </p>
            ) : (
              <p className="sp-impact">
                {cascade
                  ? `Prerequisites met. Unlocking it would make ${cascade} more ${plural(cascade)} reachable.`
                  : 'Prerequisites met. Unlocking it reaches nothing further on its own.'}
              </p>
            )}
            {isSimulated ? (
              <button type="button" className="sp-action-btn sp-action-btn--sim" onClick={clearSim}>
                Exit simulation
              </button>
            ) : item.status === 'built' ? (
              <button
                type="button"
                className="sp-action-btn sp-action-btn--outage"
                onClick={() => startOutage(item.id)}
              >
                Simulate an outage
              </button>
            ) : (
              <>
                {missing.length > 0 && (
                  <button
                    type="button"
                    className="sp-action-btn sp-action-btn--gap"
                    onClick={() => startGap(item.id)}
                  >
                    Show the gap on the map
                  </button>
                )}
                <button
                  type="button"
                  className="sp-action-btn sp-action-btn--unlock"
                  onClick={() => startAcquisition(item.id)}
                >
                  Simulate unlocking this
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/* Classified by the engine from what the runtime said: a 401 is a
          permission, a missing binary is a tool. "Check failing" says what;
          this says why. */}
      {failures.length > 0 && (
        <div className="sp-failures">
          <div className="sp-section-label">Failing lately</div>
          {failures.map(f => (
            <p key={`${f.class}/${f.signal}`} className="sp-failure">
              {f.signal} · {f.class} · {f.times}×
              {agoLabel(f.last) ? ` · last ${agoLabel(f.last)}` : ''}
            </p>
          ))}
        </div>
      )}

      {item.description && <div className="sp-desc">{item.description}</div>}

      {isolated && <p className="sp-note">Connected to nothing else on this map.</p>}

      {/* The one command the page cannot run for you: a check executes, so
          it runs only where a person types it. */}
      <div className="sp-cli-actions">
        <div className="sp-section-label">Check it</div>
        <div className="sp-cli-row">
          <code className="sp-cli-cmd">ambit verify {item.id}</code>
          <button
            type="button"
            className={`sp-cli-copy-btn ${copiedCmd === 'verify' ? 'sp-cli-copy-btn--copied' : ''}`}
            onClick={() => copy('verify', `ambit verify ${item.id}`)}
            aria-label={`Copy command ambit verify ${item.id}`}
          >
            {copiedCmd === 'verify' ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      </div>

      <LinkList
        title="Needs"
        edge="needs"
        links={needs.map(({ node, conn }) => ({ node, note: prerequisiteLabel(conn) }))}
        onShow={onShow ?? selectItem}
      />
      <LinkList
        title="Enables"
        edge="enables"
        links={enables.map(({ node }) => ({ node }))}
        onShow={onShow ?? selectItem}
      />

      {(setup ||
        details.length > 0 ||
        (daysSinceChange !== undefined && daysSinceChange >= 14)) && (
        <div className="sp-attrs">
          <div className="sp-section-label">Details</div>
          {setup && (
            <div className="sp-attr-row">
              <span className="sp-attr-key">Setup time</span>
              <span className="sp-attr-val">{setup}</span>
            </div>
          )}
          {daysSinceChange !== undefined && daysSinceChange >= 14 && (
            <div className="sp-attr-row">
              <span className="sp-attr-key">
                <Term name="decay">Config unchanged</Term>
              </span>
              <span className="sp-attr-val">{daysSinceChange} days</span>
            </div>
          )}
          {details.map(([k, v]) => (
            <div key={k} className="sp-attr-row">
              <span className="sp-attr-key">
                {k === 'maturity' ? <Term name="maturity" /> : metaKeyLabel(k)}
              </span>
              <span className="sp-attr-val" title={String(v)}>
                {String(v)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NodeDetailPanel;
