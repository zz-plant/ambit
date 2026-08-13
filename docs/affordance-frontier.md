# The affordance frontier

> This document is theory. It describes the object Ambit is trying to model, not what the software currently does. For that, see the [README](../README.md); for what is planned, [ROADMAP.md](../ROADMAP.md).

## The object

Ambit models the **affordance frontier** of extended human-machine systems: the set of cognitive, digital, institutional, economic, and physical actions made reachable by the composition of humans, models, software, authority, bodies, and machines.

The shortest form: *Ambit makes the capability frontier of an agentic system legible.*

## Why "affordance" and not "capability"

A hammer does not contain hammering. Hammering emerges from a relation between an agent, the tool, the agent's motor ability, a suitable target, and an environment. Affordances are relational; capabilities sound like possessions.

The same is true of the digital case, which is easy to miss because software feels like a list of features. *Shell access* is not really a capability. It is a resource that participates in producing one. The actual affordance might be *modify the running service*, and it exists only when reasoning, shell, credentials, network, target machine, installed software, and authorisation all line up.

Robotics makes the relational character obvious, because physical affordances have always worked this way. A robot possesses a gripper; whether it can open a particular door depends on gripper geometry, force, perception, handle type, reach, locomotion, planning, door state, authorisation, and possibly a human holding something aside.

Ambit generalises that logic to digital and institutional action.

## Domains

```
A(S) = A_digital ∪ A_cognitive ∪ A_physical ∪ A_social ∪ A_institutional
```

These compose *across* boundaries, which is where the interesting cases live:

```
notice an opportunity      (cognitive)
→ research it              (digital)
→ obtain approval          (institutional)
→ transfer funds           (economic)
→ order hardware           (commercial)
→ a robot installs it      (physical)
→ new compute comes online (digital)
→ future capacity rises    (cognitive)
```

That chain is not well described as "an AI using a tool." It is a self-extending sociotechnical system.

## Robotics

Robotics adds physical actuation. The primitives change; the accounting problem does not.

```
Capability: deliver medication to patient
  cognition      planning model
  perception     cameras + localisation
  actuation      mobile base + gripper
  authority      authorised for this ward
  human          pharmacist loads the medication
  environment    elevator API reachable
  verification   delivery confirmed by recipient
```

The capability belongs to the assembled system, not to "the robot." A single warehouse robot cannot fulfil an order; inventory software plus a planner plus conveyors plus pickers plus payment authorisation plus human exception handling can. The meaningful unit is the fulfilment system.

This also lets embodiment be discussed without mysticism. A body supplies sensors, actuators, position, energy constraints, physical access, vulnerability, and feedback — it is one class of affordance-producing infrastructure, not a precondition for agency. A corporation has consequential physical agency through employees, trucks, factories, and bank accounts without possessing one body. An AI system may acquire physical agency the same way: cameras in several buildings, drones elsewhere, warehouse robots, contracted humans, automated purchasing. Its body would be distributed.

The operational question is therefore not *does this system have a body* but **which physical affordances can it reliably bring about, through which actuators?**

## Brain-computer interfaces

BCIs are harder, because they erode the boundary the model depends on.

A person forms an intention; a decoder reads it; a model interprets it; a planner acts; an arm moves; feedback returns. Where is *pick up the cup*? Not in the unaided nervous system, the decoder, the model, the planner, or the arm. It exists in the closed loop.

```
intention → neural signal → decoder → interpretation
   ↑                                        ↓
sensory feedback ← environment ← actuator ← plan
```

This forces a distinction Ambit should eventually make explicit:

| | |
|---|---|
| **Human-gated** | the machine acts only after approval |
| **Human-composed** | human cognition is necessary to produce the action |
| **Machine-composed human** | the machine extends what the human can perceive, remember, decide, communicate, or do |

"Human in the loop" implies two pre-existing entities passing control. A tight enough interface produces a coupled system whose relevant cognition spans both, and which has abilities neither participant has alone. Calling the human a supervisor misses what is happening.

BCIs also introduce **cognitive affordances** — remember, communicate intention, retrieve external knowledge, control a device, maintain attention — where the frontier of a person with a memory prosthesis differs from the same person without one.

## Intellectual genealogy

No existing field studies this frontier directly. Its concepts are distributed:

| Field | Asks | Contributes |
|---|---|---|
| **Cybernetics** | what can this system control? | understanding a system through its effective possibilities rather than its parts' intelligence |
| **Sociotechnical systems** | how do humans, technology and institutions interact? | the correct boundary: human + machine + institution |
| **Security / attack graphs** | what can this principal reach? | that innocuous permissions compose into reachable paths |
| **Capability approach** (Sen, Nussbaum, Robeyns) | what can a person actually achieve? | resources ≠ effective freedom to achieve an outcome |
| **Agent evaluation** | can the agent do task X? | empirical autonomy measurement |
| **Systems engineering / CMDB** | what depends on what? | dependency and failure-propagation machinery |

The security parallel is the closest structurally. Attack-graph analysis already asks *given this topology, what can this principal reach* — Ambit generalises the question from unauthorised attack paths to all productive capacity for action.

The capability-approach parallel is the closest conceptually. Where Sen distinguishes possessing resources from possessing the effective freedom to achieve an outcome, Ambit distinguishes *tool installed* from *capability actually reachable* — and tries to make the conversion function computationally explicit:

```
resources + permissions + skills + connectivity + persistence + authority
    → effective capabilities
```

What appears underdeveloped is the intersection: given an evolving assemblage of models, software, credentials, infrastructure, persistent processes, organisations and humans, **what set of outcomes is reachable, and how is that set changing?**

```
C(S_t) = { outcomes S can reliably and legitimately cause at time t }
ΔC     = C(S_t+1) − C(S_t)
```

Ambit's [ledger](../ROADMAP.md) is a first, narrow implementation of ΔC over one kind of system.

## The AGI thesis

The conventional framing plots *model capability over time* and asks how many intellectual tasks a model can perform. The systems framing plots **system capability frontier over time** and asks across how many domains an assembled system can perceive opportunities, form goals, marshal resources, act, observe consequences, adapt, and continue.

Those curves need not move together. A model release can move the first considerably and the second barely, for want of authority and infrastructure. Connecting an unchanged model to a persistent runtime, a bank account, a fleet of machines and broad organisational authority can barely move benchmarks while enormously expanding the second.

That discrepancy is the thing almost nobody has needed to measure, and it may become one of the more important quantities in an agentic world.

The key variable is **cross-domain composability**. A system that writes excellent essays and proves theorems but cannot connect those abilities to persistent action has broad cognition and narrow agency. A system with weaker models that combines reasoning, software, money, institutions, robots, humans, memory, communication and manufacturing may have far greater general agency.

Which suggests a criterion:

> General agency exists when an extended system possesses a sufficiently broad and composable affordance frontier that it can pursue consequential goals across domains without requiring a separately constructed human workflow for each one.

And a sharper historical line than "which model was first":

> AGI may turn out not to describe what a machine became, but what human-machine systems became capable of doing.

At that point, asking whether the intelligence resides in the person, the model, the robot, or the interface is probably the wrong level of analysis.

## What this implies for the software

The test of an abstraction is whether it survives cases it was not designed for. Two concrete consequences have already landed:

- The infrastructure manifest accepts devices of any kind. A robot arm and a neural decoder seed into the graph as first-class nodes with a `commands` edge between them, exactly as a Pi and a container do.
- The domain vocabulary was entirely software, so anything acting on the world collapsed into the `meta` column. `physical` is now a domain, and such resources render in their own column.

What has not landed, and is the honest boundary: capabilities are still separated from providers only informally; authority is not modelled; nothing verifies that a capability works; and no cognitive or institutional domain exists. Those are [roadmap](../ROADMAP.md) items, and the theory above runs well ahead of all of them.
