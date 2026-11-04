# Launch kit

## Positioning

One line, the brand, used in `package.json`, the formula and the directory description:

> What you, your agents, and your machines can jointly do — and where your own time is going.

The product's purpose is to widen that reach. What breaks, and what is configured but failing, is the half that makes widening safe to lean on; a hook that leads with it sells the guardrail as the product. Lead with what is one step away and what to set up next, and let blast radius follow.

Most readers do not know the word *ambit* yet, and the product is named after it. Define it wherever a reader first meets it. A headline that has to stand alone, such as the About line, a card or the README's first line, says what the tool does in plain words and leaves the word to the sentence under it: the README's second sentence carries the definition ("What you, your agents and your machines can jointly do is your *ambit*").

The searchable hook is *meta-MCP server*: Ambit is the MCP server that maps, audits, and plans across your other MCP servers, agents, credentials, skills, and machines. Keep it in keywords and second sentences, not headlines.

Directory description, for a submission form with room:

> What you, your agents, and your machines can jointly do — and where your own time is going. Ambit reads your agent configs into one capability map: what is worth setting up next and what it would open, what works, what emerges from combining tools, and what breaks downstream if a piece goes.

Three descriptions exist and they are not interchangeable. The paragraph above is the one to paste into a form. The MCP registry reads `server.json`, whose `description` is the short form and is already written; change it there, not here. `package.json`'s `description` is the one-line tagline.

## Show HN draft

Not posted as of 2026-11-04. Before posting:

1. Publish the release first, so `npx ambit-cli` gives what the post describes. `ambit weigh` and the shared readout are not in 0.6.0.
2. Re-check the counts. Tools are `TOOLS` in `src/mcp/tools.ts`. Runtimes are OpenCode, Claude Code and the `CLIENTS` array in `src/engine/mcp-clients.ts`. Capabilities with a check are the tree's nodes carrying `verify`. No test pins any of the three.
3. Run `npx ambit-cli` on a clean home, and open the demo on a phone.
4. Post on a weekday morning, US time, when you can answer comments for the next few hours. Ask no one for votes.

The last paragraph of limits is there on purpose. The first reply will raise them otherwise, and a reader who sees them stated trusts the rest more. Read the sentence about Claude Code and make sure it says what you would say.

**Title:** Show HN: Ambit – A Civilization-style tech tree of what your AI agents can do

My agent setup grew into a pile of MCP servers, scripts, skills, credentials and runtimes. I could read each config file, but none of them said what the whole thing could do, what one missing piece was holding back, or which configured tools had stopped working.

Ambit reads those configs (Claude Code, Cursor, OpenCode and 13 others) into a local SQLite graph and places your setup on a curated tree of 46 capabilities. It tells you:

- What is one step away and what that step would open. On the demo's sample setup, adding embeddings takes about 10 minutes and opens two more capabilities.
- Which configured tools fail their checks.
- What each tool server's tool list costs in context every session.
- What stops if a server or a shared credential goes.

Your agents can ask the same questions over MCP, 61 tools of them, and can draft a config change. Approving and applying it stay outside MCP, with you.

Demo, nothing to install: https://zz-plant.github.io/ambit/?demo=1. Paste a config and it is read in the tab, or tick the servers you run.

On your machine: `npx ambit-cli`, with Node 22.18 or newer, on macOS or Linux. It writes only its own local file, and there is no telemetry. MIT licensed.

Where it falls short: the tree is my opinion of what a capability is and what it needs, so it will be wrong in places. About half the capabilities have a declared check, and the rest can only be shown as configured. The time and cost reports need a few weeks of recorded sessions before they say much. Most of the code was written with Claude Code, under my direction.

Repository: https://github.com/zz-plant/ambit

What would you want this to tell you about your setup that it does not?

## Repository metadata

The repository page is where a visitor decides whether the project is worth remembering, and three of its fields are set by hand in **Settings**, not by any file. These are the values to put there; change them here first, then there.

**About → Description.** The sidebar is the one line a visitor reads before the README loads, and GitHub search indexes it. The tagline is the brand; this is the answer to "what is it", naming the tools a reader already uses:

> See what you and your AI agents can do, and what one more step would unlock. Ambit maps Claude Code, Cursor, OpenCode and 13 more agent configs into one local graph: what works, what to set up next, and what breaks if a piece goes.

Applied 2026-11-04, with Website and Topics below applied 2026-09-30. It was written first as "What breaks if one MCP server goes down?", which is the guardrail half; see Positioning.

**About → Website.** The demo, not the docs: `https://zz-plant.github.io/ambit/?demo=1`. It is the thing that needs nothing installed, and the link under the description is the most clicked one on the page.

**About → Topics.** The `keywords` array in `package.json`, which is the one list. GitHub takes at most twenty, lowercase with hyphens, and the list is written to that limit: the protocol, the runtimes a reader searches for by name, and what the tool is. npm takes more, which is how the two lists once parted, so a new keyword replaces an old one. Seven of the sixteen runtimes are named, the seven whose topics are largest: Windsurf, the smallest of them, has more repositories than Zed, Cline, Roo Code or Continue. Set the topics from the file:

```bash
node -p 'JSON.stringify({names: require("./package.json").keywords})' | gh api -X PUT repos/zz-plant/ambit/topics --input -
```

**About → Include in the home page.** Keep Releases, since the notes explain each change. Untick Packages, which is empty until the npm package ships, and an empty section reads as abandoned.

**Social preview.** Upload [`docs/assets/social-preview.png`](../docs/assets/social-preview.png) in **Settings → General → Social preview**. The repository had a custom card on 2026-11-04; compare it with this file, since the API does not say which image it is. Its headline is decided: "What could your agents do with one more step?", over one node added and the six it opens. Blast radius is drawn only on the outage page's own card. GitHub does not read it from the repository, so the upload has to be repeated whenever the card changes. The asset is 1280×640 and is regenerated by `npm run assets:generate`.

**Features.** Turn on Discussions, with a Q&A category and a Show and tell category. A question about someone's own stack is not a bug, and the issue templates are the wrong door for it; a shared `ambit share --redact` map is exactly what Show and tell is for.

## Posts

**Your agents are Evas, not Gundams.** Now used as framing in prose, as the closing aside of [docs/loadout.md](../docs/loadout.md), which maps sync, the umbilical, the restraints, MAGI and the dummy plug onto the loadout. Interface labels keep the glossary's plain words. Still worth one essay for the trust half of the product: an Eva runs on an umbilical cable with minutes of battery once it is cut (the outage cascade), its restraint bolts are the authority modes and berserk is what the gate exists to stop (a forbidden grant wins at any specificity), MAGI decides before NERV acts (approval as a separate, checkable step, though Ambit has no 2-of-3 quorum), sync ratio is measured and never assumed (how much of the loadout is proven; restraints coming off on evidence is Ambit's own rule, which the show does not have), and the dummy plug, a machine acting with the pilot removed, is the warning behind promotion needing a person while demotion needs nobody. Gundam fits less well: spec sheets and model upgrades, which the Civ tree already covers.

It stays out of the interface, and in prose it is a frame, never a vocabulary. The map is Civ, and a second metaphor on labels is a second name for each concept, which the one-glossary rule exists to stop; mecha stories are about a pilot in a crisis, while Ambit's value is in a ledger, evidence and a person approving a hash they were shown; and it lands only with readers who know the shows, which is why the loadout page says what each part means for a reader who does not. Inside the team it works as a review question for anything that widens autonomy: what is the umbilical here, and is this a dummy plug?

## Directory submissions

Use the directory description from Positioning for the directories that accept one; the registry takes its own. Before submitting, confirm each directory's current category names and submission rules. A useful category is **Control Plane / Meta Tools** where the directory supports one; otherwise use developer tools or monitoring.

Where to submit, in the order the traffic justifies. Status is one of Not submitted, Submitted *date*, or Listed *url*, and Last checked is when someone last opened the directory and confirmed the row still holds.

| Directory | How | Status | Last checked |
| :--- | :--- | :--- | :--- |
| [Official MCP registry](https://registry.modelcontextprotocol.io) | `server.json` at the repo root is written against the 2025-09-29 schema and `package.json` carries the matching `mcpName`. Publishing needs `ambit-cli` on npm first: the registry verifies the package exists and that its `mcpName` matches. Then `mcp-publisher login github` and `mcp-publisher publish` from the repo root. | Listed | 2026-10-01: `io.github.zz-plant/ambit` 0.5.0, found by a search for it. A new version republishes with `mcp-publisher publish` after the version in `server.json` is bumped; the login expires, so `mcp-publisher login github` first |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Pull request adding one line under the developer-tools category, using the directory description. | Submitted 2026-10-09: [#16084](https://github.com/punkpeye/awesome-mcp-servers/pull/16084), still open | 2026-11-04 |
| [Glama](https://glama.ai/mcp/servers) | Claim the server from the GitHub repo; it reads the README and the MCP tool list. | Listed, by the README's score badge | 2026-11-04: the badge answers; the listing page not opened |
| [PulseMCP](https://www.pulsemcp.com/servers) | Submission form; link the hosted demo as the homepage. | Not submitted | Not checked |
| [mcp.so](https://mcp.so) | Submission form. | Not submitted | Not checked |
| [MCP Market](https://mcpmarket.com/server/ambit) | Listed without a submission, from the repository. Claim it to edit the description and link the hosted demo. | Listed [mcpmarket.com/server/ambit](https://mcpmarket.com/server/ambit), unclaimed | 2026-10-01 |

The awesome-mcp-servers line, in the list's own format, for the developer-tools category:

> - [zz-plant/ambit](https://github.com/zz-plant/ambit) 📇 🏠 🍎 🐧 - Maps every agent runtime's MCP config on the machine into one local capability graph: what works, what is failing, what breaks if a server or token goes, and what to set up next. Agents ask it before acting, and a Claude Code hook can make its decisions binding.

Its CONTRIBUTING.md asks automated agents to mark their pull requests in the title. An agent opening this one for a person should say so in the description instead and leave the decision to that person.

Keep the table current: an entry that says "submitted" is the one thing that stops the same directory being submitted twice.

## After the first release on npm

`ambit-cli` 0.5.0 was published on 2026-10-01. Done in the same change: the README's Get started table and the welcome screen lead with `npx ambit-cli`; CI's "Check adoption copy" step, which failed any README that named the npm route, is gone; and the Claude Code plugin's MCP server and briefing run through `npx -y ambit-cli`, so installing the plugin needs nothing else first. The gate plugin keeps calling an installed `ambit`, because it runs on every tool call and `npx` resolution would add to each one.

The registry listing went up the same day: `io.github.zz-plant/ambit` 0.5.0, with the 87-character description in `server.json` (the registry refuses one over 100).

Left, and each needs a person:

1. Add an `NPM_TOKEN` automation token to the repository's secrets, so the release workflow publishes the next version itself, with provenance. 0.5.0 was published from a laptop without it.
2. Post the Show HN draft, whose install line is now `npx ambit-cli`.
3. Done for 0.6.0 (2026-10-05): published to npm by hand, the GitHub release made the tag, the MCP registry lists 0.6.0 as latest, and the formula, written by the tap job from the npm tarball, was committed to `zz-plant/homebrew-tap` by hand. The next release is the same four steps until `NPM_TOKEN` and `TAP_TOKEN` are set.
