# Launch kit

## Positioning

One line, used everywhere the product is named:

> What you, your agents, and your machines can jointly do — and where your own time is going.

The product's purpose is to widen that reach. What breaks, and what is configured but failing, is the half that makes widening safe to lean on; a hook that leads with it sells the guardrail as the product. Lead with what is one step away and what to set up next, and let blast radius follow.

Most readers do not know the word *ambit* yet, and the product is named after it. Define it wherever a reader first meets it: the README does so on the line after the tagline ("That is your *ambit*"), since the tagline is the definition. A headline that has to stand alone, such as the About line or a card, says what the tool does in plain words and leaves the word to the page.

The searchable hook is *meta-MCP server*: Ambit is the MCP server that maps, audits, and plans across your other MCP servers, agents, credentials, skills, and machines. Keep it in keywords and second sentences, not headlines.

Directory description, for a submission form with room:

> What you, your agents, and your machines can jointly do — and where your own time is going. Ambit reads your agent configs into one capability map: what works, what breaks downstream, what emerges from combining tools, and what is worth setting up next.

Three descriptions exist and they are not interchangeable. The paragraph above is the one to paste into a form. The MCP registry reads `server.json`, whose `description` is the short form and is already written; change it there, not here. `package.json`'s `description` is the one-line tagline, and it is the sentence the README opens with.

## Show HN draft

Re-check both counts against the code before posting. The tool count is `TOOLS` in `src/mcp/tools.ts`, which is what `tools/list` returns and what no test pins, so it drifts silently. The runtime list is assembled from `src/engine/cli/seed.ts` (OpenCode, Claude Code) and the `CLIENTS` array in `src/engine/mcp-clients.ts` (the other nine). `src/engine/seed-cli.test.ts` seeds all eleven end to end and fails when a client in that array has no fixture.

**Title:** Show HN: Ambit – A Civilization-style capability graph and meta-MCP server

I built Ambit after my agent setup grew from a few tools into a stack of MCP servers, local scripts, skills, credentials, and runtimes. I could see each config file, but not what the whole system could do, what would fail together, or what one missing dependency was blocking.

Ambit is MIT-licensed and local-first. Its Node 22 SQLite engine maps the stack into a capability DAG; the React SVG view renders it as a Civilization-style tech tree; and 60 MCP tools let an agent query the same model.

The parts I use most:

- Blast-radius and single-point-of-failure analysis for tools and credentials.
- Near-miss detection for capabilities that are one or two prerequisites away.
- An attention ledger for permission prompts and other human interventions.
- Reviewable config proposals with signed approval receipts. Agents may propose changes over MCP, but approval and apply stay outside the MCP surface.
- Automatic discovery for OpenCode, Claude Code, Cursor, Windsurf, Gemini CLI, Claude Desktop, Codex CLI, Cline, Roo Code, Continue, and Zed. A server two clients both list stays one capability with two providers.

Zero-install demo: https://zz-plant.github.io/ambit/?demo=1

Repository: https://github.com/zz-plant/ambit

I would especially value feedback on whether the capability model matches how larger agent stacks fail in practice.

## Repository metadata

The repository page is where a visitor decides whether the project is worth remembering, and three of its fields are set by hand in **Settings**, not by any file. These are the values to put there; change them here first, then there.

**About → Description.** The sidebar is the one line a visitor reads before the README loads, and GitHub search indexes it. The tagline is the brand; this is the answer to "what is it", naming the tools a reader already uses:

> See what you and your AI agents can do, and what one more step would unlock. Ambit maps Claude Code, Cursor, OpenCode and eight more agent configs into one local graph: what works, what to set up next, and what breaks if a piece goes.

Applied 2026-09-30, with Website and Topics below. It was written first as "What breaks if one MCP server goes down?", which is the guardrail half; see Positioning.

**About → Website.** The demo, not the docs: `https://zz-plant.github.io/ambit/?demo=1`. It is the thing that needs nothing installed, and the link under the description is the most clicked one on the page.

**About → Topics.** The `keywords` array in `package.json`, which is the one list. GitHub takes at most twenty, lowercase with hyphens, and the list is written to that limit: the protocol, the runtimes a reader searches for by name, and what the tool is. npm takes more, which is how the two lists once parted, so a new keyword replaces an old one. Seven of the eleven runtimes are named, the seven whose topics are largest: Windsurf, the smallest of them, has more repositories than Zed, Cline, Roo Code or Continue. Set the topics from the file:

```bash
node -p 'JSON.stringify({names: require("./package.json").keywords})' | gh api -X PUT repos/zz-plant/ambit/topics --input -
```

**About → Include in the home page.** Keep Releases, since the notes explain each change. Untick Packages, which is empty until the npm package ships, and an empty section reads as abandoned.

**Social preview.** Upload [`docs/assets/social-preview.png`](../docs/assets/social-preview.png) in **Settings → General → Social preview**. Not uploaded yet: the current card leads with "What breaks if one MCP server goes down?", the guardrail half, and wants its headline decided before it goes up. GitHub does not read it from the repository, so the upload has to be repeated whenever the card changes. The asset is 1280×640 and is regenerated by `npm run assets:generate`.

**Features.** Turn on Discussions, with a Q&A category and a Show and tell category. A question about someone's own stack is not a bug, and the issue templates are the wrong door for it; a shared `ambit share --redact` map is exactly what Show and tell is for.

## Posts

**Your agents are Evas, not Gundams.** One essay for the trust half of the product: an Eva runs on an umbilical cable with minutes of battery once it is cut (the outage cascade), its restraint bolts are the authority modes and berserk is what the gate exists to stop (a forbidden grant wins at any specificity), MAGI decides before NERV acts (approval as a separate, checkable step, though Ambit has no 2-of-3 quorum), sync ratio is measured and never assumed (promotion on evidence), and the dummy plug, a machine acting with the pilot removed, is the warning behind promotion needing a person while demotion needs nobody. Gundam fits less well: spec sheets and model upgrades, which the Civ tree already covers.

It stays a post. The map is Civ, and a second metaphor is a second name for each concept, which the one-glossary rule exists to stop; mecha stories are about a pilot in a crisis, while Ambit's value is in a ledger, evidence and a person approving a hash they were shown; and it lands only with readers who know the shows. Inside the team it works as a review question for anything that widens autonomy: what is the umbilical here, and is this a dummy plug?

## Directory submissions

Use the directory description from Positioning for the directories that accept one; the registry takes its own. Before submitting, confirm each directory's current category names and submission rules. A useful category is **Control Plane / Meta Tools** where the directory supports one; otherwise use developer tools or monitoring.

Where to submit, in the order the traffic justifies. Status is one of Not submitted, Submitted *date*, or Listed *url*, and Last checked is when someone last opened the directory and confirmed the row still holds.

| Directory | How | Status | Last checked |
| :--- | :--- | :--- | :--- |
| [Official MCP registry](https://registry.modelcontextprotocol.io) | `server.json` at the repo root is written against the 2025-09-29 schema and `package.json` carries the matching `mcpName`. Publishing needs `ambit-cli` on npm first: the registry verifies the package exists and that its `mcpName` matches. Then `mcp-publisher login github` and `mcp-publisher publish` from the repo root. | Not submitted | 2026-10-01: a search for `ambit` returns nothing |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Pull request adding one line under the developer-tools category, using the directory description. | Not submitted | Not checked |
| [Glama](https://glama.ai/mcp/servers) | Claim the server from the GitHub repo; it reads the README and the MCP tool list. | Not submitted | 2026-10-01: not listed |
| [PulseMCP](https://www.pulsemcp.com/servers) | Submission form; link the hosted demo as the homepage. | Not submitted | Not checked |
| [mcp.so](https://mcp.so) | Submission form. | Not submitted | Not checked |
| [MCP Market](https://mcpmarket.com/server/ambit) | Listed without a submission, from the repository. Claim it to edit the description and link the hosted demo. | Listed [mcpmarket.com/server/ambit](https://mcpmarket.com/server/ambit), unclaimed | 2026-10-01 |

Keep the table current: an entry that says "submitted" is the one thing that stops the same directory being submitted twice.

## After the first release on npm

1. Replace the npm note in the README's Get started section with an `npx ambit-cli` line beside the Homebrew block. Delete CI's "Check adoption copy" step in the same commit: it greps the README for that install line and never consults the registry, so it fails after the publish exactly as it does before.
2. Publish `server.json` to the MCP registry (above).
3. Re-run the Show HN draft with the one-line install in it.
