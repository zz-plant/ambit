# Building alone

A one-person company still has a CTO's questions, and nobody to ask them: what to set up before real users arrive, what an agent may do to production without asking you, and how you hear about a failure before a customer does. Ambit answers each one from the agent configs on your machine. Your *ambit* is what you, your agents and your machines can do together, and this page is about widening it from "an agent that writes code" to "an agent that helps run a product".

It does not choose your stack, review your code, or hold your secrets. Those limits are at the end.

## What stands between you and launch

```bash
npx ambit-cli goal "launch my saas"
```

The sentence is routed to **Launch Ready**, a capstone reached when six things are in place, and the answer is a checklist in order: each step's setup time, what to do, and the usual ways to do it. A step you have half done says so. Sentry configured before any host is listed as configured and waiting on Hosting, instead of as something to set up again.

| Step | What it gives the agent |
| :--- | :--- |
| Hosting | Deploys and logs in one place, so "ship it" and "why is it slow" are one step each |
| Production Database | The data your users create, in a managed database the agent can inspect |
| Backups | A restore point, and the habit of having tried one |
| Continuous Delivery | Agent commits go through the same CI gate as yours |
| Error Tracking | The stack trace a user hit, before they write in |
| Uptime Monitoring | Something outside your laptop that notices when the site is down |

Payments, user accounts, transactional email and product analytics are on the map beside them, in the same two eras (**Product** and **Operations**), and not required for launch, since not every product takes money on day one. Ask for any of them the same way: `ambit goal "take payments"`, `ambit goal "add login"`.

After each step, `ambit seed` reads the configs again and the list moves.

## What an agent may do without you

Every capability in those two eras carries defaults a careful CTO would set. The agent may read freely, must ask before anything a customer would notice, and may not do the few things that cannot be undone.

| Capability | Runs on its own | Asks first | Refused |
| :--- | :--- | :--- | :--- |
| Hosting | read logs, deploy a preview | deploy to production, change the domain | delete the project |
| Production Database | read the schema | read rows, run a migration, write a row | drop a table, delete the database |
| Backups | list and create backups | restore one | delete one |
| Payments | | list payments, create a payment link, change a price | issue a refund, delete a customer |
| User Accounts | | read or invite a user | delete a user, impersonate one |
| Transactional Email | send a test | email one user | send a broadcast |

`ambit can act:payments/issue_refund` answers before an agent tries, and an agent connected over MCP asks the same question with `ambit_can`. In Claude Code, the `ambit-gate` plugin puts the decision in front of every tool call. It decides per server, so every call to your Stripe server asks first. It only narrows what Claude Code's own settings allow, and never widens it.

Budgets and approvals name the person deciding, so declare yourself once: `ambit people add you`. It grants nothing; it gives the trail a name to carry.

An ask-first default can be widened where a mistake is cheap. `ambit authority grant hosting autonomous --scope=staging --by=you` lets an agent deploy to staging without asking, while production, and any call that does not say where it is going, still asks. No grant widens a refusal, at any scope; that is what makes it one.

A ceiling on spend is one line: `ambit budget set hosted-inference --amount=$50 --period=month --by=you`. Past it, any caller that states what it is about to spend is refused until the month turns over, whether that is `ambit can --spend` or an agent's `ambit_can`.

## When something breaks

- `ambit impact mcp:stripe` names everything that stops if your Stripe server goes, before you find out by trying.
- `ambit credentials` lists what each token is holding up, so rotating one is a decision and not a surprise.
- `ambit verify` runs every declared check, and a capability whose check fails drops out of every plan and every grant until it passes again.
- `ambit audit` is the trail of what was approved, what ran, and whether it held. Read it after a day of letting an agent work.

## What it will not do

- **Choose your stack.** The ways to close a step are a short list of common options, not a recommendation drawn from your situation.
- **Review your code.** A passing check means a tool answers. It says nothing about whether your app is correct.
- **Hold your secrets.** It reads which servers you have, never their keys, and sends nothing anywhere.
- **Stand in for a security review** before you take money or store personal data.
- **Run on Windows**, where it does not read the agent configs yet.

[The guide](../README.md) covers installing and every command; [your loadout, from A to B](./loadout.md) is the longer walk through what Ambit makes possible.
