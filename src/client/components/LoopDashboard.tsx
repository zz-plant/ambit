import React from 'react';
import { useAmbitStore } from '../store/ambitStore';
import type {
  LoopAuthority,
  LoopDemand,
  LoopNext,
  LoopOpportunity,
  LoopSince,
  LoopSnapshot,
} from '../../shared/api';
import { useCopied } from '../hooks/useCopied';
import { HoursSparkline, NUM, StackedBar, money } from './figures';

/**
 * The work ledger's view of a month: where human attention went, what it cost,
 * and what would pay back fastest.
 *
 * Everything here is quantity, so everything here is drawn rather than
 * narrated. The page used to say "Today: 43 interventions a month, 8.6h of
 * your time, $2150/mo. After: 0.8h a month, saving $1935/mo. Pays back in 0.6
 * months" — five numbers in a sentence, three times over, with no way to
 * compare one row against the next except by holding them in your head. The
 * numbers have not changed; they are now on shared scales, so the comparison
 * happens in the eye instead.
 *
 * Three rules the figures below keep:
 *
 *   A scale is shared or it is not a scale. Every hours mark on the page sits
 *   on one 0–9h axis, drawn once, so a long bar means more hours wherever it
 *   appears. The old payback bar filled proportionally to nothing at all.
 *
 *   Label the marks, not the axis. Direct labels beat a legend the reader has
 *   to look away to decode, and they are what makes the one red/green pairing
 *   legible to a colourblind reader.
 *
 *   Ink that encodes nothing is removed. No gridlines behind the bars, no
 *   frames, no fill under a value that a position already carries.
 *
 * The same page renders the demo's sample and a real machine's ledger — one
 * shape from `/api/loop`, labelled with where it came from. A ledger that has
 * recorded nothing gets the empty state below rather than a page of zeroes.
 */

interface LoopDashboardProps {
  /** Show a capability on the map, with the unlock simulation running. */
  onShowOnMap?: (capabilityId: string) => void;
  /** Show a capability where it lives, with nothing running. */
  onShow?: (capabilityId: string) => void;
}

/** What an older API server, or a fixture written before it, leaves out. */
const NO_AUTHORITY: LoopAuthority = {
  autonomous: 0,
  confirm: 0,
  forbidden: 0,
  promotable: [],
  budgets: [],
  sandboxes: [],
};

/**
 * What was forecast against what happened, on one axis.
 *
 * A ratio of 1.1 says nothing on its own; two marks on a shared scale say
 * "predicted 37, got 41" and let the reader judge the gap themselves.
 */
function ForecastPair({ predicted, observed }: { predicted: number; observed: number }) {
  const w = 200;
  const max = Math.max(predicted, observed) * 1.15;
  const x = (v: number) => 34 + (v / max) * (w - 68);
  return (
    <svg
      className="fig-pair"
      viewBox={`0 0 ${w} 42`}
      role="img"
      aria-label={`Forecast ${predicted} hours, observed ${observed} hours`}
    >
      {/* The two marks sit close together precisely when the forecast was
          good, which is the moment two labels on one baseline collide into
          nonsense. One goes above the axis and one below, so the figure is
          legible exactly where it matters most. */}
      <text className="fig-tick" x={x(predicted)} y={9} textAnchor="middle">
        {predicted}h forecast
      </text>
      <line className="fig-pair-track" x1={4} y1={20} x2={w - 4} y2={20} />
      <line className="fig-pair-span" x1={x(predicted)} y1={20} x2={x(observed)} y2={20} />
      <circle className="fig-dot-hollow" cx={x(predicted)} cy={20} r={4} />
      <circle className="fig-dot" cx={x(observed)} cy={20} r={4.5} />
      <text className="fig-tick fig-tick--strong" x={x(observed)} y={36} textAnchor="middle">
        {observed}h spent
      </text>
    </svg>
  );
}

/**
 * The assurance split as one bar rather than four chips.
 *
 * Order matters and is not cosmetic: proven is green and failing is red, and
 * at ΔE 5.6 under deuteranopia those two are the same colour — so the grey
 * unproven segment sits between them, they never share an edge, and every
 * segment carries its own written label. Colour is the last thing doing the
 * work here, not the first.
 */
function AssuranceBar({ status }: { status: LoopSnapshot['status'] }) {
  const proven = status.verified;
  const unproven = Math.max(status.reached - status.verified - status.failing, 0);
  const failing = status.failing;
  const unreached = Math.max(status.total - status.reached, 0);
  const segments = [
    { key: 'proven', n: proven, label: 'check passed' },
    { key: 'unproven', n: unproven, label: 'configured, never checked' },
    { key: 'failing', n: failing, label: 'check failing' },
    { key: 'unreached', n: unreached, label: 'not reached' },
  ];

  return (
    <figure className="fig fig--assurance">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="fig-kpi-icon"
            aria-hidden="true"
          >
            <path d="M8 2 L13 4 V8 C13 11.5 8 14 8 14 C8 14 3 11.5 3 8 V4 Z" />
            <path d="M6 8 L7.5 9.5 L10.5 6.5" />
          </svg>
          What the graph can prove
        </span>
        <span className="fig-caption-note" style={NUM}>
          {status.verified} of {status.total} proved
          {status.total > 0 ? ` · ${Math.round((status.verified / status.total) * 100)}%` : ''}
        </span>
      </figcaption>
      <StackedBar segments={segments} />
    </figure>
  );
}

/**
 * The three fragilities the payload already carried and no surface drew.
 *
 * `degraded`, `spofs` and `deficits` arrive on every `/api/loop` response and
 * were read by nothing. A machine could be one revoked token away from losing a
 * capability, and the page would say only how many checks had passed. They are
 * graph facts, so they answer on a machine whose ledger is still empty, which
 * makes them the only figures that can be drawn on day one.
 */
function Fragility({ status }: { status: LoopSnapshot['status'] }) {
  // Deficits used to be a third row here. They are demand, not fragility, and
  // head the queue of what to reach instead.
  const rows = [
    { key: 'degraded', names: status.degraded, label: 'configured, not working' },
    { key: 'spofs', names: status.spofs, label: 'one provider away from lost' },
  ].filter(r => r.names?.length);

  if (!rows.length) return null;

  return (
    <figure className="fig fig--assurance">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">
          <svg
            width="13"
            height="13"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            className="fig-kpi-icon"
            aria-hidden="true"
          >
            <path d="M8 2 L14 13 H2 Z" />
            <line x1="8" y1="6" x2="8" y2="9" />
            <circle cx="8" cy="11.5" r="0.75" fill="currentColor" />
          </svg>
          What could break
        </span>
        <span className="fig-caption-note">from the graph, not the ledger</span>
      </figcaption>
      <ul className="fig-key">
        {rows.map(r => (
          <li key={r.key} className="fig-key-item" title={r.names.join(', ')}>
            <span className={`fig-key-swatch fig-key-swatch--${r.key}`} aria-hidden="true" />
            <span className="fig-key-n" style={NUM}>
              {r.names.length}
            </span>
            <span className="fig-key-label">
              {r.label}
              {': '}
              {r.names.slice(0, 3).join(', ')}
              {r.names.length > 3 ? ` and ${r.names.length - 3} more` : ''}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** A dumbbell: where the hours are now, where they would be, on a shared axis. */
function HoursDumbbell({ now, after, max }: { now: number; after: number; max: number }) {
  const w = 168;
  // Room at both ends for the two values: the mark is a difference and both
  // sides of it get a number.
  const x = (v: number) => 20 + (v / max) * (w - 48);
  return (
    <svg
      className="fig-row-svg"
      viewBox={`0 0 ${w} 20`}
      role="img"
      aria-label={`${now} hours now, ${after} hours after`}
    >
      <title>{`${now}h a month now → ${after}h after`}</title>
      <line className="fig-dumbbell-span" x1={x(after)} y1={10} x2={x(now)} y2={10} />
      <circle className="fig-dot-hollow" cx={x(after)} cy={10} r={3.5} />
      <circle className="fig-dot" cx={x(now)} cy={10} r={4} />
      <text
        className="fig-inline-label fig-inline-label--soft"
        x={x(after) - 6}
        y={13.5}
        textAnchor="end"
        style={NUM}
      >
        {after}
      </text>
      <text className="fig-inline-label" x={x(now) + 7} y={13.5} style={NUM}>
        {now}h
      </text>
    </svg>
  );
}

/** Money recovered each month, as length on one scale. */
function SavingsBar({ saved, max }: { saved: number; max: number }) {
  const w = 130;
  const len = Math.max((saved / max) * (w - 46), 2);
  return (
    <svg
      className="fig-row-svg"
      viewBox={`0 0 ${w} 20`}
      role="img"
      aria-label={`${money(saved)} recovered a month`}
    >
      <title>{`${money(saved)} a month`}</title>
      <rect className="fig-bar" x={0} y={6} width={len} height={8} rx={4} />
      <text className="fig-inline-label" x={len + 6} y={13.5} style={NUM}>
        {money(saved)}
      </text>
    </svg>
  );
}

/** Payback against the month it has to beat. */
function PaybackMark({ months }: { months: number | null }) {
  // Nothing saved means the setup never pays for itself. A bar drawn at the
  // axis end would say "just over a month".
  if (months == null) return <span className="fig-row-none">never</span>;
  const w = 116;
  const scale = 1; // one month, which is the comparison worth making
  const x = (v: number) => 2 + Math.min(v / scale, 1) * (w - 44);
  return (
    <svg
      className="fig-row-svg"
      viewBox={`0 0 ${w} 20`}
      role="img"
      aria-label={`Pays back in ${months} months`}
    >
      <title>{`${months} months to pay back`}</title>
      <line className="fig-axis-line" x1={2} y1={10} x2={x(scale)} y2={10} />
      {/* The month it has to beat, marked once. The value rides its own dot:
          at the axis end it read as though the maximum were the measurement. */}
      <line className="fig-axis-tick" x1={x(scale)} y1={4} x2={x(scale)} y2={16} />
      <circle className="fig-dot" cx={x(months)} cy={10} r={4} />
      <text className="fig-inline-label" x={x(months) + 7} y={13.5} style={NUM}>
        {months}
        <tspan className="fig-inline-unit"> mo</tspan>
      </text>
    </svg>
  );
}

/**
 * Interruptions, as one comparison rather than two lists.
 *
 * The reducible ones and the ones worth keeping were in separate columns, so
 * the question the section exists to answer — how much of this is the human
 * being a duct, and how much is the human deciding — needed the reader to
 * compare across a gap. One scale, one sort, and the keeper drawn in the
 * recessive grey with a hatch, because it is the context and not the point.
 */
function InterruptionChart({ attention }: { attention: LoopSnapshot['attention'] }) {
  const rows = [
    ...attention.reducible.map(r => ({
      capability: r.capability,
      hours: r.hours,
      times: r.times,
      note: r.suggested_fix,
      kept: false,
    })),
    ...attention.keepers.map(k => ({
      capability: k.capability,
      hours: k.hours,
      times: k.times,
      note: `${k.kind} — never proposed for removal, however often it recurs`,
      kept: true,
    })),
  ].sort((a, b) => b.hours - a.hours);

  const max = Math.max(...rows.map(r => r.hours));
  const ticks = [0, 1, 2, 3].filter(t => t <= max * 1.1);

  return (
    <figure className="fig">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">Where the interruptions are</span>
        <span className="fig-caption-note">
          hours a month · {attention.interventions} interventions in the window
        </span>
      </figcaption>

      <ul className="fig-bars">
        {rows.map(r => (
          <li key={r.capability} className={`fig-bar-row ${r.kept ? 'is-kept' : ''}`}>
            <span className="fig-bar-name">
              {r.capability}
              {r.kept && <span className="fig-tag">kept</span>}
            </span>
            <span className="fig-bar-track">
              <span
                className={`fig-bar-fill ${r.kept ? 'fig-bar-fill--kept' : ''}`}
                style={{ width: `${(r.hours / max) * 100}%` }}
                title={`${r.hours}h a month over ${r.times} interruptions`}
              />
              <span className="fig-bar-value" style={NUM}>
                {r.hours}h
              </span>
            </span>
            <span className="fig-bar-count" style={NUM}>
              {r.times}×
            </span>
            <span className="fig-bar-note">{r.note}</span>
          </li>
        ))}
      </ul>

      <div className="fig-axis" aria-hidden="true">
        <span className="fig-axis-spacer" />
        <span className="fig-axis-scale">
          {ticks.map(t => (
            <span
              key={t}
              className="fig-axis-tick-label"
              style={{ left: `${(t / max) * 100}%`, ...NUM }}
            >
              {t}h
            </span>
          ))}
        </span>
      </div>
    </figure>
  );
}

/**
 * What may act without asking, what could, and what is spent.
 *
 * The governance half of the product had no web surface at all: whether a
 * capability runs unattended, needs confirmation or is forbidden was terminal
 * only, and so was the engine's own suggestion that a grant confirmed by hand
 * twenty times with nothing failing has earned a threshold. That suggestion is
 * the most decision-shaped thing the engine knows, and it sits here beside the
 * interruptions it would end. Promotion still needs a person, so the figure
 * hands over the command and never runs it.
 */
function AuthorityFigure({
  authority,
  onShow,
}: {
  authority: LoopAuthority;
  onShow?: (id: string) => void;
}) {
  const items = useAmbitStore(s => s.items);
  const [copied, copy] = useCopied();
  const total = authority.autonomous + authority.confirm + authority.forbidden;
  const segments = [
    { key: 'autonomous', n: authority.autonomous, label: 'run unattended' },
    { key: 'confirm', n: authority.confirm, label: 'ask first' },
    { key: 'forbidden', n: authority.forbidden, label: 'forbidden' },
  ];
  const onMap = (id: string) => items.some(i => i.id === id);

  return (
    <figure className="fig fig--authority">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">What may act without asking</span>
        <span className="fig-caption-note" style={NUM}>
          {total
            ? `${authority.autonomous} of ${total} reached capabilities run unattended`
            : 'no authority declared yet'}
        </span>
      </figcaption>
      {total > 0 && <StackedBar segments={segments} />}

      {authority.promotable.length > 0 && (
        <div className="fig-block">
          <h4 className="fig-subtitle">Earned a threshold nobody set</h4>
          <ul className="fig-promote">
            {authority.promotable.map(p => (
              <li key={`${p.id}/${p.action}`} className="fig-promote-item">
                <span className="fig-promote-what">
                  {onShow && onMap(p.id) ? (
                    <button type="button" className="fig-link" onClick={() => onShow(p.id)}>
                      {p.capability}
                    </button>
                  ) : (
                    p.capability
                  )}
                  <span className="fig-tag">{p.action}</span>
                </span>
                <span className="fig-promote-why" style={NUM}>
                  asked {p.asked}× in 30 days · {p.evidence}
                </span>
                <button
                  type="button"
                  className="tp-btn-sm"
                  title={p.command}
                  onClick={() => copy(`${p.id}/${p.action}`, p.command)}
                >
                  {copied === `${p.id}/${p.action}` ? 'Copied' : 'Copy the command that sets one'}
                </button>
              </li>
            ))}
          </ul>
          <p className="fig-note">
            A threshold is a person saying "stop asking me once this has proved itself". The grant
            widens when the evidence holds and narrows again on one failing check.
          </p>
        </div>
      )}

      {authority.budgets.length > 0 && (
        <div className="fig-block">
          <h4 className="fig-subtitle">Spend delegated in advance</h4>
          <ul className="fig-bars">
            {authority.budgets.map(b => (
              <li key={`${b.capability}/${b.action}`} className="fig-bar-row">
                <span className="fig-bar-name">
                  {b.capability}
                  <span className="fig-tag">{b.action}</span>
                </span>
                <span className="fig-bar-track">
                  <span
                    className="fig-bar-fill"
                    style={{
                      width: `${Math.min(100, (b.spent_dollars / b.ceiling_dollars) * 100)}%`,
                    }}
                    title={`${money(b.spent_dollars)} spent of ${money(b.ceiling_dollars)}`}
                  />
                  <span className="fig-bar-value" style={NUM}>
                    {money(b.spent_dollars)} of {money(b.ceiling_dollars)}
                  </span>
                </span>
                <span className="fig-bar-count">a {b.period}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {authority.sandboxes.length > 0 && (
        <p className="fig-note">
          Unattended inside {authority.sandboxes.join(', ')}. A sandbox relaxes confirmation there
          and never a refusal.
        </p>
      )}
    </figure>
  );
}

/**
 * The three capabilities worth reaching next, each with its reason and price.
 *
 * The frontier was a set of outlined circles with a setup cost. `ambit next`
 * ranks them by what has actually blocked work, then by leverage per hour of
 * setup, and says which basis it used; this is that list, with the map one
 * click away.
 */
function NextFigure({
  next,
  demand = [],
  onShowOnMap,
}: {
  next: LoopNext[];
  demand?: LoopDemand[];
  onShowOnMap?: (id: string) => void;
}) {
  const items = useAmbitStore(s => s.items);
  if (!next.length && !demand.length) return null;
  const observed = next[0]?.basis === 'observed';
  // What was asked for and never there heads the queue: a thing that stopped
  // work four times this week outranks a thing that would be neat to have.
  const ranked = new Set(next.map(n => n.id));
  const demanded = demand.filter(d => !ranked.has(d.id));
  return (
    <figure className="fig">
      <figcaption className="fig-caption">
        <span className="fig-caption-title">What to reach next</span>
        <span className="fig-caption-note">
          {observed || demanded.length
            ? 'ranked by what has blocked work, then by leverage'
            : 'ranked by what each unblocks per hour of setup; nothing has blocked work yet'}
        </span>
      </figcaption>
      {demanded.length > 0 && (
        <ul className="fig-demand" aria-label="Asked for and never there">
          {demanded.map(d => (
            <li key={d.id} className="fig-demand-item">
              <span className="fig-demand-name">
                {d.name}
                <span className="fig-tag">
                  {d.failing ? 'failing its check' : d.structural ? 'structural' : 'asked for'}
                </span>
              </span>
              <span className="fig-demand-why" style={NUM}>
                stopped work {d.times}× ·{' '}
                {d.failing
                  ? 'configured and failing: re-verify it, do not re-add it'
                  : d.structural
                    ? 'the same cause every time: this is an acquisition'
                    : 'not yet recurring'}
              </span>
              {onShowOnMap && items.some(i => i.id === d.id) && (
                <button
                  type="button"
                  className="fig-row-btn"
                  onClick={() => onShowOnMap(d.id)}
                  title={`Show ${d.name} on the map and simulate unlocking it`}
                >
                  Map
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <ol className="fig-next">
        {next.map((n, i) => (
          <li key={n.id} className="fig-next-item">
            <span className="fig-next-rank" aria-hidden="true">
              {i + 1}
            </span>
            <span className="fig-next-body">
              <span className="fig-next-name">
                {n.capability}
                {n.cost && (
                  <span className="fig-next-cost" style={NUM}>
                    {n.cost}
                  </span>
                )}
              </span>
              <span className="fig-next-why">
                {n.why}
                {n.missing?.length ? ` Needs ${n.missing.join(' and ')} first.` : ''}
              </span>
            </span>
            {onShowOnMap && items.some(i => i.id === n.id) && (
              <button
                type="button"
                className="fig-row-btn"
                onClick={() => onShowOnMap(n.id)}
                title={`Show ${n.capability} on the map and simulate unlocking it`}
              >
                Map
              </button>
            )}
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * How the frontier moved this week. The entry worth the strip is emergent: a
 * capability reached without anything new providing it, which no changelog
 * of components can show, since no single change explains one.
 */
function SinceStrip({ since }: { since: LoopSince | null }) {
  if (!since) return null;
  const parts = [
    { key: 'gained', names: since.gained, tone: 'good' },
    { key: 'emergent', names: since.emergent, tone: 'data' },
    { key: 'lost', names: since.lost, tone: 'bad' },
    { key: 'diminished', names: since.diminished, tone: 'bad' },
  ].filter(p => p.names.length);
  const from = since.from.slice(0, 10);
  return (
    <p className="loop-since">
      <span className="loop-since-from">Since {from}:</span>
      {parts.length === 0 && <span className="loop-since-part">nothing moved</span>}
      {parts.map(p => (
        <span key={p.key} className={`loop-since-part is-${p.tone}`}>
          <span className="loop-since-n" style={NUM}>
            {p.names.length}
          </span>{' '}
          {p.key} · {p.names.slice(0, 3).join(', ')}
          {p.names.length > 3 ? ` and ${p.names.length - 3} more` : ''}
        </span>
      ))}
      {since.emergent.length > 0 && (
        <span className="loop-since-note">emergent: reached without anything new providing it</span>
      )}
    </p>
  );
}

/**
 * The ways to acquire one capability, as a comparison rather than a list.
 *
 * Cost is drawn as length on one scale across the options, cheapest first,
 * so the trade is visible before the numbers are read; privacy is a tag,
 * since it is the other axis a person tends to decide on; and the option the
 * record of their own decisions favours is marked, which is the same choice
 * `ambit propose` would draft.
 */
function OptionCompare({
  options,
}: {
  options: NonNullable<LoopOpportunity['acquisition_options']>;
}) {
  const priced = options.filter(o => o.total_first_year_dollars != null);
  const max = Math.max(...priced.map(o => o.total_first_year_dollars as number), 1);
  const sorted = [...options].sort(
    (a, b) => (a.total_first_year_dollars ?? Infinity) - (b.total_first_year_dollars ?? Infinity)
  );
  return (
    <ul className="fig-options" aria-label="Ways to acquire it">
      {sorted.map(a => (
        <li
          key={`${a.provider}/${a.kind}`}
          className={`fig-option ${a.favoured ? 'is-favoured' : ''}`}
        >
          <span className="fig-option-cost" style={NUM}>
            {a.total_first_year_dollars != null ? `${money(a.total_first_year_dollars)}/yr` : '—'}
          </span>
          <span className="fig-option-track">
            {a.total_first_year_dollars != null && (
              <span
                className="fig-option-bar"
                style={{ width: `${Math.max((a.total_first_year_dollars / max) * 100, 2)}%` }}
              />
            )}
          </span>
          <span className="fig-option-what">
            {a.kind} · {a.provider}
            <span className={`fig-tag ${a.privacy === 'local' ? 'fig-tag--local' : ''}`}>
              {a.privacy}
            </span>
            {a.favoured && <span className="fig-option-favoured">your record favours this</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function OpportunityRows({
  list,
  onShowOnMap,
}: {
  list: LoopOpportunity[];
  onShowOnMap?: (capabilityId: string) => void;
}) {
  const items = useAmbitStore(s => s.items);

  // One scale per column, taken from the whole set rather than per row, so a
  // longer mark means more wherever the eye lands.
  const maxHours = Math.max(...list.map(o => o.burden.human_hours_month)) * 1.05;
  const maxSaved = Math.max(...list.map(o => o.expected.savings_dollars_month));

  // Every row names the capability it prices, so "Map" selects that node and
  // runs the unlock simulation on it. It used to match the row's *id* against
  // three hardcoded strings, and all three rows fell through to the same
  // fallback node: whichever opportunity you asked about, the map showed
  // Wrangler.
  const nodeFor = (o: LoopOpportunity) =>
    o.capability_id && items.some(i => i.id === o.capability_id) ? o.capability_id : null;

  return (
    <div className="fig-table-wrap">
      <table className="fig-table">
        <thead>
          <tr>
            <th scope="col">What to set up</th>
            <th scope="col" className="is-num">
              Interruptions
              <span className="fig-th-unit">a month</span>
            </th>
            <th scope="col">
              Your hours a month
              <span className="fig-th-scale">
                <span>0</span>
                <span>{Math.round(maxHours)}h</span>
              </span>
            </th>
            <th scope="col">
              Recovered a month
              <span className="fig-th-scale">
                <span>0</span>
                <span>{money(maxSaved)}</span>
              </span>
            </th>
            <th scope="col">
              Pays back
              <span className="fig-th-scale">
                <span>0</span>
                <span>1 month</span>
              </span>
            </th>
            <th scope="col">
              <span className="sr-only">Show on the map</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map(o => (
            <tr key={o.id}>
              <th scope="row">
                <span className="fig-row-title">{o.title}</span>
                <span className={`fig-conf fig-conf--${o.confidence}`}>
                  {o.confidence} confidence
                </span>
                {o.acquisition_options && <OptionCompare options={o.acquisition_options} />}
              </th>
              <td className="is-num" style={NUM}>
                {o.burden.interventions_month}×
              </td>
              <td>
                <HoursDumbbell
                  now={o.burden.human_hours_month}
                  after={o.expected.human_hours_month_after}
                  max={maxHours}
                />
              </td>
              <td>
                <SavingsBar saved={o.expected.savings_dollars_month} max={maxSaved} />
              </td>
              <td>
                <PaybackMark months={o.payback_months} />
              </td>
              <td>
                {onShowOnMap && nodeFor(o) && (
                  <button
                    type="button"
                    className="fig-row-btn"
                    onClick={() => onShowOnMap(nodeFor(o) as string)}
                    title={`Show ${o.capability} on the map and simulate unlocking it`}
                  >
                    Map
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fig-legend">
        <span className="fig-legend-item">
          <svg width="34" height="10" aria-hidden="true">
            <line className="fig-dumbbell-span" x1="4" y1="5" x2="30" y2="5" />
            <circle className="fig-dot-hollow" cx="4" cy="5" r="3.5" />
            <circle className="fig-dot" cx="30" cy="5" r="4" />
          </svg>
          hollow is where the hours would land · solid is where they are now
        </span>
      </p>
    </div>
  );
}

/**
 * What the page says when the ledger is real and empty.
 *
 * A new machine has a graph but no recorded work, and the figures would all be
 * zero — which reads as "nothing costs you anything" rather than "nothing has
 * been recorded". The two bridges are the only way to fill it, so they are the
 * page.
 */
function EmptyLedger({
  loop,
  onShow,
  onShowOnMap,
}: {
  loop?: LoopSnapshot;
  onShow?: (id: string) => void;
  onShowOnMap?: (id: string) => void;
}) {
  const status = loop?.status;
  return (
    <div className="loop-dashboard">
      <div className="loop-inner">
        <h2 className="loop-title">Nothing recorded yet</h2>
        <p className="loop-subtitle">
          This page prices the time a person spends inside the loop. The graph knows what you can
          do; the ledger is what says how often you had to step in, and nothing has written to it on
          this machine.
        </p>
        {loop && <SinceStrip since={loop.since ?? null} />}

        {/*
          The half that does not wait for a week of sessions. Assurance,
          fragility, authority and what to reach next are read off the graph,
          so they are true on the machine's first day, and the page used to
          withhold them until the other half arrived.
        */}
        {status && status.total > 0 && (
          <div className="fig-kpis">
            <AssuranceBar status={status} />
            <Fragility status={status} />
          </div>
        )}
        {loop && <AuthorityFigure authority={loop.authority ?? NO_AUTHORITY} onShow={onShow} />}
        {loop && (
          <NextFigure next={loop.next ?? []} demand={loop.demand ?? []} onShowOnMap={onShowOnMap} />
        )}

        <p className="loop-subtitle">Two bridges fill the rest.</p>
        <ol className="loop-empty-steps">
          <li>
            <strong>Record the work.</strong> Copy <code>plugins/ambit-telemetry.js</code> into{' '}
            <code>~/.config/opencode/plugins/</code> — it writes each tool run and permission prompt
            to the ledger.
          </li>
          <li>
            <strong>Record the tending.</strong> Copy <code>plugins/ambit-tracker.js</code> beside
            it for the configuration changes you make, which is what the attention lens colours.
          </li>
          <li>
            <strong>Come back after a week of sessions.</strong> The same numbers are in the
            terminal meanwhile: <code>ambit attention</code>, <code>ambit opportunities</code>,{' '}
            <code>ambit roi</code>.
          </li>
        </ol>
      </div>
    </div>
  );
}

export default function LoopDashboard({ onShowOnMap, onShow }: LoopDashboardProps) {
  const loop = useAmbitStore(s => s.loop);
  const loopSource = useAmbitStore(s => s.loopSource);
  const loopEmpty = useAmbitStore(s => s.loopEmpty);
  const [confidenceFilter, setConfidenceFilter] = React.useState<'all' | 'high' | 'medium'>('all');

  // No snapshot at all means the same thing as an empty one: nothing has been
  // recorded here. A blank page would read as a broken tab. An empty snapshot
  // still carries the graph half, so it is handed over.
  if (!loop) return <EmptyLedger />;
  if (loopEmpty) return <EmptyLedger loop={loop} onShow={onShow} onShowOnMap={onShowOnMap} />;

  const { status, attention, opportunities, roi } = loop;
  const authority = loop.authority ?? NO_AUTHORITY;
  const next = loop.next ?? [];
  const since = loop.since ?? null;
  const sample = loopSource === 'sample';
  const filtered = opportunities.filter(
    o => confidenceFilter === 'all' || o.confidence === confidenceFilter
  );
  const filters: [typeof confidenceFilter, string][] = [
    ['all', 'All'],
    ['high', 'High confidence'],
    ['medium', 'Medium confidence'],
  ];

  return (
    <div className="loop-dashboard">
      <div className="loop-inner">
        <div className="loop-hero">
          <div>
            <h2 className="loop-title">Where the time goes</h2>
            <p className="loop-subtitle">
              Every time a person had to step in, recorded against the capability that needed them.
              Priced, and ranked by what would pay back fastest.
              {sample ? ' Sample data.' : ' Read from this machine\u2019s ledger.'}
            </p>
            <SinceStrip since={since} />
          </div>
        </div>

        <div className="fig-kpis">
          <figure className="fig fig--kpi">
            <figcaption className="fig-caption">
              <span className="fig-caption-title">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  className="fig-kpi-icon"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 4.5 V8 L10.5 9.5" />
                </svg>
                Hours a person spent in the loop
              </span>
              <span className="fig-caption-note">the shaded band is the saving</span>
            </figcaption>
            {/* A ledger with runs and no interventions drew "0h saved, $0 a
                year", which reads as a measurement of a machine that costs
                nothing. A saving is a difference between months; until an
                intervention or a second month exists there is no figure. */}
            {attention.interventions === 0 && roi.monthly_hours.length < 2 ? (
              <p className="fig-note">
                No interventions recorded in the window yet, so there is nothing to price. The
                figure appears with the first one.
              </p>
            ) : (
              <>
                <div className="fig-kpi-value" style={NUM}>
                  {roi.hours_per_year}h<span className="fig-kpi-unit"> saved</span>{' '}
                  <span className="fig-kpi-second">{money(roi.dollars_per_year)} a year</span>
                </div>
                {roi.monthly_hours.length > 1 ? (
                  <HoursSparkline series={roi.monthly_hours} width={280} height={92} annotate />
                ) : (
                  <p className="fig-note">
                    A month-by-month line appears once there are two months.
                  </p>
                )}
              </>
            )}
          </figure>

          <figure className="fig fig--kpi">
            <figcaption className="fig-caption">
              <span className="fig-caption-title">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  className="fig-kpi-icon"
                  aria-hidden="true"
                >
                  <circle cx="8" cy="8" r="6" strokeDasharray="3 2" />
                  <circle cx="8" cy="8" r="2" fill="currentColor" />
                </svg>
                Forecast against what happened
              </span>
              <span className="fig-caption-note">{roi.verdict}</span>
            </figcaption>
            {roi.forecast ? (
              <>
                <div className="fig-kpi-value" style={NUM}>
                  {roi.accuracy ?? '—'}×<span className="fig-kpi-unit"> of forecast</span>
                </div>
                <ForecastPair
                  predicted={roi.forecast.predicted_hours}
                  observed={roi.forecast.observed_hours}
                />
              </>
            ) : (
              <p className="fig-note">
                Nothing to compare yet. A proposal that is applied and then measured puts its
                forecast beside what happened.
              </p>
            )}
          </figure>

          <AssuranceBar status={status} />
          <Fragility status={status} />
        </div>

        <AuthorityFigure authority={authority} onShow={onShow} />

        <NextFigure next={next} demand={loop.demand ?? []} onShowOnMap={onShowOnMap} />

        <section>
          <div className="loop-section-head">
            <h3 className="loop-section-title">What would pay back</h3>
            <div className="loop-filter-tabs" role="tablist" aria-label="Filter by confidence">
              {filters.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  className={`loop-filter-tab ${confidenceFilter === key ? 'loop-filter-tab--active' : ''}`}
                  aria-selected={confidenceFilter === key}
                  onClick={() => setConfidenceFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {filtered.length ? (
            <OpportunityRows list={filtered} onShowOnMap={onShowOnMap} />
          ) : (
            <p className="fig-note">
              Nothing ranked at this confidence. An act has to recur before it can be priced.
            </p>
          )}
        </section>

        {attention.reducible.length + attention.keepers.length > 0 && (
          <InterruptionChart attention={attention} />
        )}

        <p className="loop-foot">
          {sample
            ? 'On your own machine this comes from the work ledger, and starts empty: '
            : 'The same figures in the terminal: '}
          <code>ambit attention</code>, <code>ambit opportunities</code> and <code>ambit roi</code>.
        </p>
      </div>
    </div>
  );
}
