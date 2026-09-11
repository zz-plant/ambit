---
name: Capability model
about: A capability, dependency, or era the model gets wrong or is missing
labels: capability-model
---

### The capability

What the system should be able to *do*, phrased as an action, not a tool name.

### What Ambit says today

Missing entirely, wrong era, wrong dependencies, detected when it shouldn't be, or not detected when it should. Paste what it says: `ambit goal "<the action>"` for something it should reach and does not, `ambit impact <id>` for something whose dependents look wrong.

### What it should say

The era it belongs in, and the prerequisites without which the action genuinely cannot be performed. Required prerequisites only; things that merely help are optional and belong in the description.

### How it would be detected

The config key, binary, endpoint, or file that is evidence the capability exists. If detection would be a guess, say so: a capability that cannot be verified is worth modeling differently from one that can.
