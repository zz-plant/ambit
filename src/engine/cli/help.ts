/**
 * What `ambit help` prints.
 *
 * Two lists on purpose: forty verbs on first contact taught nothing, so the
 * short one covers a first session and names the five groups, and `--all` is
 * the full surface.
 */

// Six commands cover most first sessions. Everything else is `help --all` —
// forty verbs on first contact taught nothing; depth should be discovered.
const HELP_SHORT = `ambit - what your system can do, what it costs, what to change

  seed              seed from the agent config
  briefing          what an agent should know before its first tool call
  status            health · degraded · spofs · deficits · pending approvals
  next              the three capabilities worth reaching next, and why
  graph [surface|combos|affordances]   the graph, or a runtime-owned view of it
  goal <cap-or-sentence> [--paths|--simulate|--prefs]   route a goal, plan the
                    delta, compare acquisition paths, or check preferences
  opportunities [--by=attention|cash|roi|reliability|frontier] [--budget=N]
                    ranked investments — observed burden, priced, compared
  verify [cap] [--history]   run the declared check, or show past verification
  impact <id>       what actually breaks if a capability goes away

  Grouped: graph · plan · check · govern · report — try \`ambit plan\`
  help --all        every command
  help [term]       one concept explained`;

const HELP = `ambit - what your system can do, what it costs, what to change

Five groups. Every verb also works on its own — \`ambit impact x\` and
\`ambit graph impact x\` are the same command.

  seed              seed from the agent config
  briefing [--json] [--peek]   what an agent should know before its first tool
                    call — broken, waiting, blocked, next. --peek does not
                    move the "since last briefing" mark
  status            health · degraded · spofs · deficits · pending approvals

graph — the structure, and what it would cost to lose a piece
  graph [surface|combos|affordances]   the graph, or a runtime-owned view of it
  graph impact <id>       what actually breaks if a capability goes away
  graph catalog <cap>     the ways to acquire a capability, compared by cost
  graph share [--redact] [--out=path]   a self-contained HTML snapshot of the
                          map — names, states, edges only; nothing leaves the machine
  graph where             where the graph is stored
  graph skills            what the agent registered that it built itself
  graph sync export [path] / graph sync import <path>   the graph and ledger as
                          one file, so a rebuilt container keeps its history —
                          no commands, no grants, no credentials
  graph objects [target]  what may be done to a thing, and what is proved there

plan — what to acquire next, and whether it paid
  plan next [n]           the capabilities worth reaching next, each with why,
                          what it costs, and the command that proposes it
  plan goal <cap-or-sentence> [--paths|--simulate|--prefs]   route a goal, plan
                          the delta, compare acquisition paths, check preferences
  plan opportunities [--by=attention|cash|roi|reliability|frontier] [--budget=N]
                          ranked investments — observed burden, priced, compared;
                          --budget allocates the best combination within $N
  plan opportunity <id>   one ranked case in full
  plan propose <cap> [option]   draft a reviewable acquisition, with its simulation
  plan roi [proposal-id]  cumulative savings and forecast accuracy, or one
                          proposal's before/after verdict
  plan portfolio [--budget=N]   across imported environments — shared burden,
                          spofs, where capex would produce the most
  plan reversible         which unreached capabilities could be acquired without
                          a person, and which need hands

check — what is proven, what is permitted, what is currently broken
  check verify [cap] [--history] [--target=<object>]   run the declared check,
                          or past verification; --target files the evidence
                          against that object rather than the verb in general
  check authority [cap] [scope <target>]   what may run unattended, what each
                          action may touch, whether a scope covers a target
  check authority promote [<cap> <action> --after=N --window=30d --scope=<target>
                          --by=<person>]   widen a grant once the evidence
                          supports it; --scope buys it for one target only. One
                          failing check puts it back, with nobody asked
  check authority sandbox [<target> --by=<person>]   declare somewhere acting
                          does not matter; confirmation is relaxed inside it and
                          a refusal never is
  check budget [set <cap> [action] --amount=$20 [--period=month] --by=<person>]
                          standing spend that does not need a person; a spent
                          budget refuses rather than overspends
  check can <cap> [--target X] [--spend N]   the decision API: ALLOW/CONFIRM/DENY
  check credentials       what revoking each credential would end
  check incidents         probe the manifest, open incident runs for offline services
  check incident resolve <svc> <outcome>   close an incident; MTTR from the ledger

govern — the reviewable path from proposal to applied change
  govern proposals [--pending] / govern proposal <id>
  govern approve <id> [<id>…] <person>   several in one sitting
  govern reject <id> <person> ["why"]    a no, recorded — it teaches the next draft
  govern apply <id> / govern rollback <id>
  govern history [since <when>]   how the frontier moved
  govern audit [run|prop|human|days]   the trail — who approved what, what ran,
                          and whether it held

report — what the system cost to operate
  report work [limit]     recent runs, each with what it cost
  report usage [days]     where capability effort actually went
  report economics        declared costs and goal values
  report attention [days] how much work still runs through the human
  report notify <topic>   push the attention digest to ntfy — nothing is sent
                          without a topic
  report notify-approvals <topic>   push the approved-waiting count to ntfy
  report record <cap> [class] [note]   record that a task was blocked
  report record skill:<name> --provides=<cap> --verify="<command>"   put a skill
                          the agent wrote on the map, with the check that proves it
  report signals [days]   failures observed without anyone recording them
  report preferences [--observed] [who]   what someone declared, or what they
                          have actually approved and refused
  report federation export|import   the signed summary a portfolio layer reads

  help [term]       this list, or one concept explained`;

export { HELP, HELP_SHORT };
