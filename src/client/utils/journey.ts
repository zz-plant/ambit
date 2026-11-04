/**
 * A loadout, read as a journey: seven legs from "a pile of configs" to "a
 * setup that does a class of work without you", each with where this one
 * stands, read from the graph and the ledger and nothing else.
 *
 * A leg with nothing recorded says so and is never drawn as zero: a ledger
 * that has not run is not a ledger that measured nothing (rule 16). Pure, so
 * the readout is tested without a page.
 */
import type { LoopSnapshot, ProposalRow } from '../../shared/api';
import { shellQuote } from '../../shared/shell';

export type LegState = 'done' | 'open' | 'unrecorded';

export interface Leg {
  key: string;
  title: string;
  state: LegState;
  /** What the graph says about this leg, in one sentence. */
  said: string;
  /** The command that moves it, where one does. Never run by the page. */
  command?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function journeyLegs(
  loop: LoopSnapshot | null,
  proposals: ProposalRow[],
  fallback: { reached: number; total: number; verified: number }
): Leg[] {
  const status = loop?.status ?? { ...fallback, failing: 0, degraded: [], spofs: [] };
  const legs: Leg[] = [];

  legs.push({
    key: 'stand',
    title: 'See where it stands',
    state: status.reached > 0 ? 'done' : 'open',
    said:
      status.reached > 0
        ? `${status.reached} of ${status.total} reached, ${status.verified} verified by a passing check${
            status.failing ? `, ${status.failing} failing` : ''
          }.`
        : 'Nothing mapped yet.',
    command: status.reached > 0 ? 'ambit verify' : 'ambit seed',
  });

  const next = loop?.next[0];
  legs.push({
    key: 'next',
    title: 'Pick the next step',
    state: next ? 'open' : loop ? 'done' : 'unrecorded',
    said: next
      ? `${next.capability} is next${next.cost ? `, ${next.cost} of setup` : ''}. ${next.why}`
      : loop
        ? 'Nothing is ranked next.'
        : 'Not ranked yet. The CLI ranks next steps once it has read this machine.',
    command: next ? `ambit propose ${shellQuote(next.id)}` : undefined,
  });

  const decided = proposals.filter(p => p.status === 'approved' || p.status === 'applied');
  const waiting = proposals.filter(p => p.status === 'draft');
  legs.push({
    key: 'add',
    title: 'Add it safely',
    state: decided.length ? 'done' : 'open',
    said:
      decided.length || waiting.length
        ? `${plural(decided.length, 'change')} approved, ${waiting.length} waiting for you. Each is a proposal you sign before it applies, and can be rolled back.`
        : 'No change proposed yet. A proposal says what it costs and what undoes it before you sign.',
  });

  const authority = loop?.authority;
  const promotable = authority?.promotable[0];
  legs.push({
    key: 'trust',
    title: 'Hand over trust gradually',
    state: !authority ? 'unrecorded' : promotable ? 'open' : authority.autonomous ? 'done' : 'open',
    said: !authority
      ? 'Not read yet. The CLI reads which capabilities run without asking.'
      : `${authority.autonomous} run without asking, ${authority.confirm} ask first, ${authority.forbidden} forbidden.${
          promotable
            ? ` ${promotable.capability} has passed often enough to stop asking first. Set the number of passes you want and it stops asking, and asks again after one failing check.`
            : ''
        }`,
    command: promotable?.command,
  });

  const broken = status.degraded.length;
  const sole = status.spofs.length;
  // Two zeros are not a reading: on a healthy machine this said "0 capabilities
  // configured but failing, 0 pieces the setup rests on alone." Each half is
  // said only when it is true, and neither being true is its own sentence.
  const standing = [
    broken ? `${plural(broken, 'capability', 'capabilities')} configured but failing` : '',
    sole ? `${plural(sole, 'piece')} the setup rests on alone` : '',
  ]
    .filter(Boolean)
    .join(', ');
  legs.push({
    key: 'stand-up',
    title: 'Keep it standing',
    // A single point of failure is not a failure, but it is something to
    // attend to, so the leg is open on either.
    state: broken || sole ? 'open' : 'done',
    said: standing
      ? `${standing}.`
      : 'Nothing is configured and failing, and nothing rests on a single piece.',
    // The list holds names, and impact takes an id; status names each one.
    command: sole || broken ? 'ambit status' : undefined,
  });

  const attention = loop?.attention;
  // A saving of zero on three interventions is not a measurement, and printing
  // it says the plugin failed rather than that a month has not passed.
  const savedHours = loop?.roi.hours_per_year ?? 0;
  legs.push({
    key: 'paid',
    title: 'Know whether it paid',
    state: attention && attention.interventions > 0 ? 'done' : 'unrecorded',
    said:
      attention && attention.interventions > 0
        ? `You stepped in ${plural(attention.interventions, 'time')}; ${
            savedHours ? `${savedHours} hours a year saved so far` : 'no saving measured yet'
          }.`
        : "Nothing recorded yet. Ambit's Claude Code or OpenCode plugin records each time you step in, and the saving appears once there is a month to compare.",
  });

  const demand = loop?.demand ?? [];
  legs.push({
    key: 'ask',
    title: 'Let the agent ask for what it lacks',
    state: demand.length ? 'done' : 'unrecorded',
    said: demand.length
      ? `Agents have asked for ${plural(demand.length, 'missing capability', 'missing capabilities')}, ${demand[0].name} most.`
      : 'No agent has asked for anything yet. Run ambit connect and your agents check with Ambit before using a tool for the first time.',
  });

  return legs;
}
