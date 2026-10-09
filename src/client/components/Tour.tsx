import { type CSSProperties, useEffect, useMemo, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import { COLD_OPEN_OUTAGE, COLD_OPEN_PLAIN, coldOpen } from '../store/demo';
import type { TourStep } from '../linkState';
import type { Item } from '../utils/configImporter';
import { costOf, isEntry, mapFindings, unlockCascade } from './civ/layout';
import { YourSetup } from './MapYours';

interface TourProps {
  /** Undefined on narrow screens, where the card is not inset by the panels. */
  style?: CSSProperties;
  /** The tour is over, finished or skipped; it counts as the first-run card seen. */
  onDone: () => void;
  onShowProposals: () => void;
  /** A config of the visitor's own was read; the view that shows it is the caller's. */
  onMapped: () => void;
  /** The step a link asked to open on; the first when it names none, or one this sample lacks. */
  start?: TourStep | null;
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
  /** The name a link opens this step by (`?tour=`). */
  key: TourStep;
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
export default function Tour({ style, onDone, onShowProposals, onMapped, start }: TourProps) {
  const items = useAmbitStore(s => s.items);
  const connections = useAmbitStore(s => s.connections);
  const ranked = useAmbitStore(s => s.loop?.next);
  const selectItem = useAmbitStore(s => s.selectItem);
  const startOutage = useAmbitStore(s => s.startOutageSimulation);
  const startAcquisition = useAmbitStore(s => s.startAcquisitionSimulation);
  const clearSimulation = useAmbitStore(s => s.clearSimulation);

  const steps = useMemo<Step[]>(() => {
    const select = (id: string | null) => {
      const current = useAmbitStore.getState().selectedItem;
      if (id === null ? current !== null : current !== id) selectItem(id);
    };
    const outage = coldOpen(items, connections);
    const { failing, best } = mapFindings(
      items,
      connections,
      ranked?.map(n => n.id)
    );
    const broken = failing[0];
    const cost = best ? costOf(best.item) : '';
    // What lights, by name: "4 more" over four green circles left the reader
    // to find and read them before the sentence meant anything.
    const byId = new Map(items.map(i => [i.id, i]));
    const opened = best
      ? [...unlockCascade(items, connections, best.item.id)]
          .flatMap(id => byId.get(id) ?? [])
          .filter(i => !isEntry(i))
      : [];

    const list: Step[] = [];
    if (best) {
      list.push({
        key: 'next',
        title: `One step would open ${best.reaches} more`,
        body:
          `This is a sample developer's agent setup, drawn from their config files. ` +
          `What it can do is their ambit. Adding ${best.item.name}` +
          `${cost ? `, about ${cost} of setup,` : ''} would open ${best.reaches} more things their agents could do` +
          `${opened.length ? `: ${named(opened)}` : ''}. ` +
          `Every next step is ranked by what it opens up, and agents can ask for the same ranking over MCP.`,
        enter: () => {
          select(null);
          startAcquisition(best.item.id);
        },
      });
    }
    // Only what was working counts as stopped, and only that is filled red.
    // What was never set up is drawn as a red outline and named for what it
    // is: drawn alike, the title said 4 over sixteen red circles.
    if (outage?.stopped.length) {
      const { stopped, broken, cutOff } = outage;
      list.push({
        key: 'outage',
        title: `And if ${COLD_OPEN_PLAIN} went down? ${stopped.length} things stop.`,
        body:
          `The same map says what a reach rests on. ` +
          `With no MCP server answering, these agents would lose ${named(stopped)}.` +
          (broken.length
            ? ` ${named(broken)} ${broken.length === 1 ? 'was' : 'were'} already failing ${broken.length === 1 ? 'its check' : 'their checks'}.`
            : '') +
          (cutOff.length
            ? ` The ${cutOff.length} outlined in red ${cutOff.length === 1 ? 'was' : 'were'} never set up.`
            : ''),
        enter: () => {
          select(null);
          startOutage(COLD_OPEN_OUTAGE);
        },
      });
    }
    if (broken) {
      list.push({
        key: 'failing',
        title: 'Configured is not the same as working',
        body:
          `${broken.name} is set up, and its check is failing. Ambit runs each ` +
          `capability's check and leaves a failing one out of everything it counts.`,
        enter: () => {
          clearSimulation();
          select(broken.id);
        },
      });
    }
    list.push({
      key: 'approval',
      title: 'Nothing changes without you',
      body:
        'Ambit writes a change as a proposal, with what it costs and whether it can be undone. ' +
        'It is applied only after an approval, a separate local operation outside the MCP surface, and the approval is a signed receipt.',
      proposal: true,
      enter: () => {
        clearSimulation();
        select(null);
      },
    });
    list.push({
      key: 'yours',
      title: 'Now map yours',
      body:
        "Paste your agent's config, or pick what you use, and the map places your setup the same way: " +
        'what it reaches now, and what one more step would open.',
      enter: () => {
        clearSimulation();
        select(null);
      },
    });
    return list;
  }, [items, connections, ranked, selectItem, startOutage, startAcquisition, clearSimulation]);

  // The step on screen, by name. The list is rebuilt as the sample's ranking
  // arrives, and the next step is put first when it does, so a position held
  // across that rebuild named a different card: a link asking for the outage
  // opened on the next step. Null is the first step, whichever that is.
  const [current, setCurrent] = useState<TourStep | null>(start ?? null);
  const index = Math.max(
    0,
    steps.findIndex(s => s.key === current)
  );
  const step = steps[index];
  const last = index >= steps.length - 1;
  const go = (to: number) => setCurrent(steps[to]?.key ?? null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: entering a step runs once per step; `steps` is rebuilt when the graph changes, and replaying the step then would restart the animation under the reader.
  useEffect(() => {
    step.enter();
  }, [step.key]);

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

      {last && <YourSetup onMapped={onMapped} />}

      <div className="app-tour-nav">
        <div className="app-tour-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <span key={s.key} className={i === index ? 'is-on' : undefined} />
          ))}
        </div>
        {index > 0 && (
          <button type="button" className="app-tour-back" onClick={() => go(index - 1)}>
            Back
          </button>
        )}
        {/* The last card's main action is the paste box's Map it. Leaving for
            the sample is the quieter choice: it was the one filled button on
            the card, so the step titled "Now map yours" pointed away from it. */}
        {last ? (
          <button type="button" className="app-tour-back" onClick={finish}>
            Keep exploring
          </button>
        ) : (
          <button type="button" className="app-tour-next" onClick={() => go(index + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}
