import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useAmbitStore } from '../store/ambitStore';
import { COLD_OPEN_OUTAGE, COLD_OPEN_PLAIN, coldOpen } from '../store/demo';
import type { TourStep } from '../linkState';
import type { Item } from '../utils/configImporter';
import { costOf, isEntry, mapFindings, unlockCascade } from './civ/layout';
import { VIEW_ID } from './AppDeck';
import ConfigIntake from './ConfigIntake';

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
  /** Ask which agent the visitor uses, and take their config, under the text. */
  intake?: boolean;
}

/**
 * The demo, narrated, and the way to the visitor's own setup on its first card.
 *
 * The map acts first: the opening card plays the sample's best next step, and
 * what it would open lights before a word is read. Under it, the card asks
 * which agent the visitor uses and takes their config, so what one more step
 * would open for them is three presses away. It used to be the fifth card,
 * after four about a stranger's setup, and a visitor who stopped reading
 * before it never saw their own.
 *
 * The rest of the tour is the sample's other half, for whoever asks for it:
 * what stops if a piece goes, what is broken without anyone noticing, and that
 * nothing changes without a person. Reach comes first because widening it is
 * what the product is for; the rest is what makes widening safe. Its last card
 * leads back to the first, where the visitor's own setup goes in.
 *
 * It runs on the demo only. A machine's own graph opens on the readout of
 * that setup instead (YourAmbit.tsx).
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

    // Each body is a sentence or two: the map is doing the showing, and on a
    // phone a seventy-word card covered half of what it was describing.
    const list: Step[] = [];
    if (best) {
      list.push({
        key: 'next',
        intake: true,
        title: `One step would open ${best.reaches} more`,
        body:
          `This is a sample developer's agent setup. Setting up ${best.item.name}` +
          `${cost ? ` (about ${cost})` : ''} would ` +
          (opened.length
            ? `unlock the ones ringed in blue: ${named(opened)}.`
            : `open ${best.reaches} more things their agents could do.`),
        enter: () => {
          select(null);
          startAcquisition(best.item.id);
        },
      });
    }
    // Only what was working counts as stopped, and only that is filled red.
    // What was never set up is drawn as a red outline and named for what it
    // is: drawn alike, the title said 4 over sixteen red circles. A check
    // that was already failing is the next card's subject, not this one's.
    if (outage?.stopped.length) {
      const { stopped, cutOff } = outage;
      list.push({
        key: 'outage',
        title: `And if ${COLD_OPEN_PLAIN} went down? ${stopped.length} things stop.`,
        body:
          `They would lose ${named(stopped)}.` +
          (cutOff.length ? ' The red outlines were never set up.' : ''),
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
        body: `${broken.name} is set up, but its check fails. Ambit won't count it until it passes.`,
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
        'Agents propose changes, each with its cost and how to undo it. ' +
        'Only you can approve one, and every approval is signed.',
      proposal: true,
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

  // A step's buttons are not the last step's, and the one that was pressed
  // can be gone from the next: the keyboard fell to the page, eighty stops
  // from the card. It lands on the step's title instead, which says where it is.
  const title = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(step.key);
  useEffect(() => {
    if (shownStep.current === step.key) return;
    shownStep.current = step.key;
    if (!document.activeElement || document.activeElement === document.body) title.current?.focus();
  }, [step.key]);

  const finish = () => {
    clearSimulation();
    onDone();
    // The card is going, and the focus with it: on to the view it was about.
    document.getElementById(VIEW_ID)?.focus({ preventScroll: true });
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
      <h2 className="app-tour-title" ref={title} tabIndex={-1}>
        {step.title}
      </h2>
      <p className="app-tour-body">{step.body}</p>

      {step.proposal && (
        <button type="button" className="app-tour-aside" onClick={onShowProposals}>
          See a proposal waiting for approval →
        </button>
      )}

      {step.intake && (
        <div className="app-tour-yours">
          <ConfigIntake onMapped={onMapped} rows={3} ask="What would one step open for you?" />
        </div>
      )}

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
        {/* The first card's own action is the intake, so the way on through
            the sample is the quieter button beside it. The last card leads
            back to the first, where the visitor's setup goes in. */}
        {step.intake ? (
          <button type="button" className="app-tour-back" onClick={() => go(index + 1)}>
            What else it shows
          </button>
        ) : last ? (
          <>
            <button type="button" className="app-tour-back" onClick={finish}>
              Keep exploring
            </button>
            <button type="button" className="app-tour-next" onClick={() => go(0)}>
              Map yours
            </button>
          </>
        ) : (
          <button type="button" className="app-tour-next" onClick={() => go(index + 1)}>
            Next
          </button>
        )}
      </div>
    </section>
  );
}
