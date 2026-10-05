import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useCopied } from '../hooks/useCopied';
import { useAmbitStore } from '../store/ambitStore';
import { COLD_OPEN_OUTAGE, COLD_OPEN_PLAIN, coldOpen } from '../store/demo';
import { INSTALL } from '../utils/copy';
import type { Item } from '../utils/configImporter';
import { costOf, mapFindings } from './civ/layout';
import ConfigIntake from './ConfigIntake';

interface TourProps {
  /** Undefined on narrow screens, where the card is not inset by the panels. */
  style?: CSSProperties;
  /** The tour is over, finished or skipped; it counts as the first-run card seen. */
  onDone: () => void;
  onShowProposals: () => void;
  /** A config of the visitor's own was read; the view that shows it is the caller's. */
  onMapped: () => void;
}

/** "A, B and C", the way the step reads a list of capabilities out. */
const named = (list: Item[]) =>
  list.length <= 1
    ? (list[0]?.name ?? '')
    : `${list
        .slice(0, -1)
        .map(i => i.name)
        .join(', ')} and ${list[list.length - 1].name}`;

interface Step {
  title: string;
  body: string;
  /** What the map does when the step is entered. */
  enter: () => void;
  /** Offer the proposal panel beside the text. */
  proposal?: boolean;
}

/**
 * The demo, narrated. A visitor who lands on the map used to get sixty
 * circles, a red banner and a card of instructions, and nothing happened
 * until they read the card and clicked. Now the map acts first: the opening
 * step plays the best next step, and what it would open lights before a word
 * is read. Each later step makes the map show one more thing the product does,
 * in the order the claim is built: what one more step opens, what stops if a
 * piece goes, what is broken without anyone noticing, and that nothing changes
 * without a person. Reach comes first because widening it is what the product
 * is for; the outage follows as the half that makes widening safe. The last
 * step is the visitor's own setup.
 *
 * It replaces the first-run card on the demo only. A real graph gets the card,
 * because a person looking at their own machine needs the controls, not the
 * pitch.
 */
export default function Tour({ style, onDone, onShowProposals, onMapped }: TourProps) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const selectItem = useAmbitStore(s => s.selectItem);
  const startOutage = useAmbitStore(s => s.startOutageSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);
  const [index, setIndex] = useState(0);
  const [copied, copy] = useCopied();

  const steps = useMemo<Step[]>(() => {
    const select = (id: string | null) => {
      const current = useAmbitStore.getState().selectedItem;
      if (id === null ? current !== null : current !== id) selectItem(id);
    };
    const outage = coldOpen(items, connections);
    const { failing, best } = mapFindings(items, connections);
    const broken = failing[0];
    const cost = best ? costOf(best.item) : '';

    const list: Step[] = [];
    if (best) {
      list.push({
        title: `One step would open ${best.reaches} more`,
        body:
          `This is a sample developer's agent setup, drawn from their config files. ` +
          `What it can do is their ambit. Adding ${best.item.name}` +
          `${cost ? `, about ${cost} of setup,` : ''} would open ${best.reaches} more things their agents could do. ` +
          `Every next step is ranked by what it opens up, and agents can ask for the same ranking over MCP.`,
        enter: () => {
          select(null);
          startAcquisition(best.item.id);
        },
      });
    }
    // Only what was working counts as stopped. The rest of the red is named
    // for what it is, because the map draws it in the same colour.
    if (outage?.stopped.length) {
      const { stopped, broken, cutOff } = outage;
      list.push({
        title: `And if ${COLD_OPEN_PLAIN} went down? ${stopped.length} things stop.`,
        body:
          `The same map says what a reach rests on. ` +
          `With no MCP server answering, these agents would lose ${named(stopped)}.` +
          (broken.length
            ? ` ${named(broken)} ${broken.length === 1 ? 'was' : 'were'} already failing ${broken.length === 1 ? 'its check' : 'their checks'}.`
            : '') +
          (cutOff.length
            ? ` ${cutOff.length} more in red ${cutOff.length === 1 ? 'was' : 'were'} not set up yet.`
            : ''),
        enter: () => {
          select(null);
          startOutage(COLD_OPEN_OUTAGE);
        },
      });
    }
    if (broken) {
      list.push({
        title: 'Configured is not the same as working',
        body:
          `${broken.name} is set up, and its check is failing. Ambit runs each ` +
          `capability's check, so a broken tool never counts as a working one.`,
        enter: () => {
          clearSimulation();
          select(broken.id);
        },
      });
    }
    list.push({
      title: 'Nothing changes without you',
      body:
        'Ambit writes a change as a proposal, with what it costs and whether it can be undone. ' +
        'It is applied only after a person approves it, and the approval is a signed receipt.',
      proposal: true,
      enter: () => {
        clearSimulation();
        select(null);
      },
    });
    list.push({
      title: 'Now map yours',
      body: 'Paste the config of the agent you use and see what it adds up to.',
      enter: () => {
        clearSimulation();
        select(null);
      },
    });
    return list;
  }, [items, connections, selectItem, startOutage, startAcquisition, clearSimulation]);

  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  // biome-ignore lint/correctness/useExhaustiveDependencies: entering a step runs once per step; `steps` is rebuilt when the graph changes, and replaying the step then would restart the animation under the reader.
  useEffect(() => {
    step.enter();
  }, [index]);

  const finish = () => {
    clearSimulation();
    onDone();
  };

  return (
    <section
      className="app-guide app-tour"
      style={style}
      aria-label="A tour of the demo"
      data-occludes-map
    >
      <div className="app-guide-head">
        <span className="app-tour-count">
          {index + 1} of {steps.length}
        </span>
        <button type="button" className="app-guide-close" onClick={finish}>
          Skip tour
        </button>
      </div>
      <h2 className="app-tour-title">{step.title}</h2>
      <p className="app-tour-body">{step.body}</p>

      {step.proposal && (
        <button type="button" className="app-tour-aside" onClick={onShowProposals}>
          See a proposal waiting for approval →
        </button>
      )}

      {last && (
        <div className="app-tour-yours">
          <ConfigIntake onMapped={onMapped} rows={3} />
          <div className="app-tour-install">
            <code>{INSTALL}</code>
            <button type="button" onClick={() => copy('install', INSTALL)}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="app-tour-note">
            The install reads every runtime on the machine and places it on the full map.
          </p>
        </div>
      )}

      <div className="app-tour-nav">
        <div className="app-tour-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.title} className={i === index ? 'is-on' : undefined} />
          ))}
        </div>
        {index > 0 && (
          <button type="button" className="app-tour-back" onClick={() => setIndex(i => i - 1)}>
            Back
          </button>
        )}
        {last ? (
          <button type="button" className="app-tour-next" onClick={finish}>
            Explore the sample
          </button>
        ) : (
          <button type="button" className="app-tour-next" onClick={() => setIndex(i => i + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}
