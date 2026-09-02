# Support

Ambit is a personal project. Questions get answered, but in days rather than hours.

## Before opening anything

- [The FAQ](./docs/faq.md) covers the questions that come up most: what needs to be installed, what leaves the machine, why the attention commands are empty on day one.
- `ambit help <term>` explains a concept from the terminal; `ambit help --all` is the full command surface.
- The [hosted demo](https://zz-plant.github.io/ambit/?demo=1) runs on example data, so you can check whether something is a bug or a property of your own graph before filing.

## Where to ask

| I want to… | Go to |
| :--- | :--- |
| Report something Ambit does that it shouldn't | [Bug report](https://github.com/zz-plant/ambit/issues/new?template=bug.md) |
| Argue that a capability, era, or prerequisite is modelled wrong | [Capability model issue](https://github.com/zz-plant/ambit/issues/new?template=capability-model.md) |
| Ask for a command, MCP tool, or runtime reader that doesn't exist | [Feature request](https://github.com/zz-plant/ambit/issues/new?template=feature_request.md) |
| Report a vulnerability | [Private security advisory](https://github.com/zz-plant/ambit/security/advisories/new) — never a public issue; see [SECURITY.md](./SECURITY.md) |

## What to include

`ambit status --json` and `ambit graph` describe your machine: which servers, models, and credential-adjacent tooling you run. Redact before pasting. `ambit share --redact` produces a snapshot that replaces every non-curated name with its category, which is usually enough to reproduce a layout or cascade bug without naming anything.
