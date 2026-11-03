/**
 * What `ambit help` prints.
 *
 * Two lists on purpose: forty verbs on first contact taught nothing, so the
 * short one covers a first session and names the five groups, and `--all` is
 * the full surface.
 */
import { GROUPS } from './groups.ts';

// Eight commands cover a first session: where you stand, what to reach next
// and how, whether an agent may act, whether it works, and the map. It listed
// eighteen with their flags, which was the full list again under a shorter
// name. Everything else is a group away, or `help --all`.
const HELP_SHORT = `ambit - what your setup can do, what it costs, what to change

  status            what is reached and verified, what fails, what to type next
  next              the capabilities worth reaching next, and why
  goal <cap-or-sentence>   the steps to a capability, in the order they close
  can <cap>         whether an agent may use it: yes, ask first, or no
  verify [cap]      run the declared checks, and record what passes
  doctor            setup health: what works, what fails, what rests on one piece
  connect [runtime] register Ambit's MCP server in each agent config it can write
  web               the map, in a browser on this machine

  Grouped: graph · plan · check · govern · report. \`ambit plan\` lists what
  plan owns, and so on for each.
  help --all        every command
  help <word>       one concept explained, or one command's usage
  <command> --help  that command's usage`;

const HELP = `ambit - what your setup can do, what it costs, what to change

Five groups. Every verb also works on its own — \`ambit impact x\` and
\`ambit graph impact x\` are the same command.

  seed              seed from the agent config
  briefing [--json] [--peek]   what an agent should know before its first tool
                    call — broken, waiting, blocked, next. --peek does not
                    move the "since last briefing" mark
  status            health · failing · sole providers · deficits · waiting approvals

graph — the structure, and what it would cost to lose a piece
  graph [surface|combos|affordances|unmapped|capacity]   a view of the graph
  graph export            the whole graph as JSON, the file the map takes dropped
  graph impact <id>       what actually breaks if a capability goes away
  graph catalog <cap>     the ways to acquire a capability, compared by cost
  graph share [--redact] [--out=path]   a self-contained HTML snapshot of the
                          map — names, states, edges only; nothing leaves the machine
  graph capacity          the machines on your tailnet and this machine's memory,
                          and which online ones no manifest names; local reads,
                          nothing sent, nothing written
  graph unmapped [--days=N]   what the agents used that no node on the map
                          accounts for, and an overlay to paste that adds it
  graph where             where the graph is stored
  graph skills            what the agent registered that it built itself
  graph sync export [path] / graph sync import <path>   the graph and ledger as
                          one file, so a rebuilt container keeps its history —
                          no commands, no grants, no credentials
  graph objects [target]  what may be done to a thing, and what is proved there

plan — what to acquire next, and whether it paid
  plan next [n]           the capabilities worth reaching next, each with why,
                          what it costs, and the command that proposes it
  plan council            the first of those read five ways: what it opens, what
                          it would rest on, what it costs, what it may do, and
                          whether its foundation works; each with its command
  plan goal <cap-or-sentence> [--paths|--simulate|--prefs|--judge[=url]]   route a
                          goal, plan the delta, compare acquisition paths, check
                          preferences; --judge asks a judgment model on this
                          machine (AMBIT_JUDGE_URL, or a default loopback
                          port) when no words match, then an embedding model
                          there (AMBIT_EMBED_URL, Ollama's port by default)
                          when no judge answers, and suggests without writing
  plan goal --spec <dir|tasks.md> [--judge[=url]]   a spec's tasks, each routed
                          as a sentence is: what they need, which is reached,
                          a next step, blocked or failing, the steps in order,
                          and the tasks nothing routed. Spec Kit and OpenSpec;
                          read as data, so no command, link or URL in it runs
  plan opportunities [id] [--rank=attention|cash|roi|reliability|frontier] [--budget=N]
                          ranked opportunities, observed attention priced and compared,
                          or one case in full; --budget allocates the best
                          combination within $N
  plan propose <cap> [option] [--by=<who>]   draft a reviewable acquisition, with
                          its simulation; --by records who drafted it
  plan roi [proposal-id]  cumulative savings and forecast accuracy, or one
                          proposal's before/after verdict
  plan portfolio [--budget=N]   across imported environments — shared attention,
                          single points of failure, where capex would produce the most
  plan reversible         which unreached capabilities could be acquired without
                          a person, and which need hands
  plan repo [dir]         inspect project stack and recommend tailored agent superpowers
  plan judge goal <sentence> [--multi] [--threshold=0.8] [--record]   which
                          capability a sentence means: the vocabulary first,
                          then a judgment model for what it could not route;
                          --multi scores each node apart. A suggestion with a
                          probability, kept as a receipt only with --record
  plan judge next <goal>  the next steps, reordered by how directly each one
                          advances the goal; costs and checks stay the graph's
  plan judge tools|failures|attention <file.json>   a model's reading of tool
                          descriptions, reported failures or recorded
                          interventions; none relabels the ledger or counts
                          as evidence. judge media <file.json> sends one raw
                          request, with its images or audio
  plan judge evaluate [cases.json] [--live]   score routing against expected
                          answers: the vocabulary alone, or the model with --live
  plan judge history [--limit=N] · review <id> accepted|rejected · plan <id>
                          the receipts kept, a person's one review of each, and
                          the plans an accepted one asks for, from the graph now
  plan judge … --provider=cloudflare [--model=<name>]
                          send the request to Workers AI, with
                          CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN. The
                          default is a model on this machine, loopback only,
                          at AMBIT_JUDGE_URL or a default port

check — what is verified, what is permitted, what is currently broken
  check verify [cap] [--history] [--target=<object>] [--exit-code]   run the
                          declared check, or past verification; --target files
                          the evidence against that object rather than the verb
                          in general; --exit-code also exits 1 unless every
                          check that ran passed
  check verify --failing  re-run only the checks that are failing or recovering
                          now, after fixing what broke them; one pass brings a
                          capability back
  check fix <cap>         what to type for a capability that is failing or not
                          yet reached: the re-check command and the ways to
                          acquire it, with each patch to paste. Prints only
  check authority [cap] [scope <target>]   what may run unattended, what each
                          action may touch, whether a scope covers a target
  check authority grant <cap> <mode> [--ttl=30m] [--scope=<target>] [--condition=branch!=main] [--by=<person>]
                          declare a grant, or elevate one for a window; once
                          the TTL runs out whatever stood before decides again.
                          --condition bounds the scope: "yes on this repo, not
                          on main". A condition the gate cannot parse is not a
                          narrowing
  check authority promote [<cap> <action> --after=N --window=30d --scope=<target>
                          --by=<person>]   widen a grant once the evidence
                          supports it; --scope buys it for one target only. One
                          failing check puts it back, with nobody asked
  check authority sandbox [<target> --by=<person>]   declare somewhere acting
                          does not matter; confirmation is relaxed inside it and
                          a refusal never is
  check budget [set <cap> [action] --amount=20 [--period=month] --by=<person>]
                          a ceiling on spend per period, in dollars; a spend
                          past it is refused, and within it the grant's own
                          mode decides
  check can <cap> [--target=X] [--spend=N] [--exit-code] [--record]   the
                          decision API: ALLOW/CONFIRM/DENY; --spend is in
                          dollars, as --amount is; --exit-code also exits
                          0/1/2. --record files a refusal as a deficit, for an
                          agent asking from a shell; a person's question files
                          nothing
  check gate              the Claude Code PreToolUse hook: denies what is forbidden,
                          asks about what asks first or has no grant, and never allows;
                          run it in a terminal for the settings entry to paste
  check credentials       what revoking each credential would end
  check weigh [server] [--timeout=30] [--recorded]   start each local tool server
                          your configs declare, ask for its tools, and record
                          what the list costs in context every session. It
                          reports per runtime, heaviest first, and names what
                          the ledger never saw called. Remote servers are not
                          contacted.
                          --recorded reads the last weighing and starts nothing
  check incidents [resolve <svc> <outcome>]   probe the manifest, record each
                          answer as a check and open incident runs for offline
                          services; or close one, with MTTR from the ledger
  check init <cap> [--command="<probe>"]   scaffold a declared check, and print
                          it. Refuses a command that would write (redirects,
                          rm, tee, curl -o, git push, installs); nothing is
                          registered, you paste the block and type ambit verify
  check doctor            setup health: what works, what fails, what rests on one piece
  check connect [runtime] register Ambit's MCP server in each runtime config it can
                          write; cursor --ledger also adds the hooks that record
                          each conversation's tool runs into the work ledger;
                          claude-code --statusline sets ambit statusline as the
                          status line where none is set, and never replaces one
  check port [server] [--to=<runtime|all>] [--from=<runtime>] [--dry-run]
                          port an MCP server between agent runtimes (Claude, Cursor, Codex, etc.)
  check toggle <server> [--off|--on] [--to=<runtime>] [--dry-run]
                          turn an MCP server off or on across agent runtimes
  check init-rules        inject pre-flight guidance into workspace agent rules
  check receipt [hours]   what the ledger recorded: capabilities used, calls
                          stopped before running, failures reported
  check ci [--strict]     verify capability invariants for CI/CD pipelines

govern — the reviewable path from proposal to applied change
  govern people [add <id> ["Name"]]   who may approve and set budgets; adding
                          one declares a name and grants nothing
  govern proposals [id] [--pending]   the drafts, what waits on a decision, or one
  govern approve <id> [<id>…] [--by=<person>]   several in one sitting
  govern reject <id> [--by=<person>] ["why"]    a no, recorded — it teaches the
                          next draft
  govern apply <id> [--to=<runtime>] [--print]   write an approved change into a
                          runtime's config: the one --to names (claude-code,
                          cursor, opencode, vscode…), else the one found here.
                          Where it cannot write, or with --print, it writes
                          nothing and gives each runtime's own command
  govern rollback <id>    undo it, in the file it was written to
  govern dispatch <id> [--to=<url>]   push a proposal to Slack, Discord,
                          Telegram, ntfy or any JSON endpoint. A draft goes
                          out for a decision, an approved one as its signed
                          artifact. AMBIT_APPROVAL_WEBHOOK is the standing
                          target; propose and approve take --dispatch to
                          push as they go
  govern history [since <when> [<until>]]   how the frontier moved, up to now
                          or up to a later observation
  govern audit [run-…|prop-…|human:name|days]   the trail of who approved
                          what, what ran, and whether it held
  govern delegation [verify] [--record] [--export] [--limit=N]   grants that
                          narrowed themselves because what they rest on stopped
                          passing, written in the STD-07 record shape
  govern delegation object <record> --by= --basis= [--requested=]   contest a
                          record. Recorded, answerable, and it does not widen
                          authority: fix the check or re-declare the grant
  govern delegation answer <objection> --by= --because= [--refuse]   the answer
                          an objection is owed, either way
  govern delegation objections   objections nobody has answered yet
  govern delegation ingest <file>   read another system's records. Foreign
                          discrepancies land as evidence attributed to the
                          sender; they never move a lifecycle here
  govern delegation source add <id> --system= --from= --by= [--instance=]
                          declare where a system's records arrive, so a full
                          ambit verify reads it instead of someone typing
                          ingest each time. An ambit source must name which
                          environment it is, and cannot be this one
  govern delegation sources / pull   what is declared and when each was last
                          read, or read them all now. A source that goes quiet
                          says so rather than looking like a quiet week

report — what the setup cost to operate
  report work [limit]     recent runs, each with what it cost
  report usage [days]     where capability effort actually went
  report usage --windows [days]
                          tokens per five-hour window, each runtime's apart,
                          the current one's time left, and the last 7 days;
                          the last 24 hours unless days are given. No plan's
                          limit is known, so none is shown
  report usage --refresh  read every Claude Code, Codex, OpenCode and Amp
                          session log again from the top, for token counts an
                          earlier read missed
  report economics        declared costs and goal values
  report economics price <model> --input=5 --cache-read=0.5 --output=25
                          declare a model's price, in dollars per million
                          tokens, so a session's tokens on it are a spend
                          against Hosted Inference's budget
  report attention [days] how much work still runs through the human
  report notify <topic> [--approvals]   push the week's attention digest to ntfy,
                          or with --approvals what waits on a decision; nothing
                          is sent without a topic
  report record <cap> [class] [note]   record that a task was blocked
  report record skill:<name> --provides=<cap> --verify="<command>"   put a skill
                          the agent wrote on the map, with the check that proves it
  report signals [days]   failures observed without anyone recording them
  report preferences [--observed] [who]   what someone declared, or what they
                          have actually approved and refused
  report federation export|import   the signed summary a portfolio layer reads
  report statusline [--json]   one line for Claude Code's status line: what fails
                          its check, the proposals to decide, the verified count.
                          Reads the graph and writes nothing

  help [word]       this list, or one concept explained, or one command's usage`;

/**
 * What one group owns, as `help --all` prints it.
 *
 * `ambit help` ends "try `ambit plan`", and a group named with no verb after it
 * was an unknown command, so the one piece of advice the short help gives led
 * to an error. Sections are separated by a blank line and none contains one,
 * so the group's is the chunk that opens with its name.
 */
function groupHelp(group: string): string {
  return HELP.split('\n\n').find(part => part.startsWith(`${group} — `)) ?? HELP_SHORT;
}

/**
 * One command's entries from the full list, as `<verb> --help` and
 * `ambit help <verb>` print them.
 *
 * `--help` after a verb ran the verb, or failed on the flag, and the usage was
 * only in the full list. It is read from that list and not written twice, so
 * the two cannot disagree. An entry opens on a line indented two spaces and
 * continues on the lines indented further; every entry that names the verb,
 * under its group or on its own, is the verb's.
 */
function usageOf(verb: string): string | undefined {
  const group = Object.entries(GROUPS).find(([, verbs]) => verbs.includes(verb))?.[0];
  const word = verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const opens = new RegExp(`^  (${group ? `${group} ` : ''})?${word}(\\s|$)`);
  const out: string[] = [];
  let taking = false;
  for (const line of HELP.split('\n')) {
    if (/^ {2}\S/.test(line)) taking = opens.test(line);
    else if (!/^ {3,}\S/.test(line)) taking = false;
    if (taking) out.push(line);
  }
  return out.length ? out.join('\n') : undefined;
}

/** What `<command> --help` prints: a group's section, or the command's entries. */
function commandHelp(cmd: string): string | undefined {
  if (cmd in GROUPS) return groupHelp(cmd);
  if (cmd === 'help') return HELP_SHORT;
  return usageOf(cmd);
}

export { HELP, HELP_SHORT, commandHelp, groupHelp, usageOf };
