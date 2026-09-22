# Ambit and Jev

TypeSafe's [Jev](https://en.wikipedia.org/wiki/Jev_(AI_model)) is a model that answers typed questions with calibrated probabilities instead of text: pick one of these options, place this on a scale, yes or no. It is fast and cheap enough to ask on every tool call, and agent harnesses now use it to decide what to try and whether a call looks safe. Ambit answers a different question, what this setup can do and what an agent may do with it, so the two fit together. This page is how.

## Jev on the map

Ambit models Jev as **Typed Judgment**, in the Model Access era of the curated tree. It is reached however Jev arrives in your config:

- one of the community Jev MCP servers, seen as `mcp:jev` or similar;
- TypeSafe listed as a provider;
- an open clone that serves the same `/v1/systemone` API, such as Kev, LitJev or OpenJev.

A clone running on your own hardware also reaches **Local Typed Judgment**, in the Sovereignty era, beside Local Embeddings. The difference matters. The hosted API may keep requests for a while unless your account has a zero-retention agreement, and a local clone keeps the state it judges on your machine.

`ambit impact combo:typed-judgment` shows what depends on it, and `ambit goal typed-judgment` shows what it would take to reach it.

## Proving a local model answers

`ambit verify combo:local-typed-judgment` asks a local clone one trivial question and records whether judgments came back. It tries the ports Kev and OpenJev use by default, 8009 and 8080 on 127.0.0.1, and `TYPESAFE_BASE_URL` or `JEV_BASE_URL` when either names this machine.

It never contacts another host. A base URL that is not loopback is skipped, and one carrying credentials is refused, because `http://127.0.0.1:1@host` is a request to `host`. Typed Judgment itself has no check: proving the hosted API answers would spend your key on a call you did not type.

## Routing a goal through it

`ambit goal` routes a sentence by the words the curated tree authors for each capability. A goal that names none of them had no route in. With a clone running locally, `--judge` closes that gap:

```bash
ambit goal "triage incoming bug reports" --judge
```

When the vocabulary cannot recommend anything, the sentence goes to the local model as one Choice question over every node in the tree, and the likeliest node comes back with its probability. Below even odds, nothing is suggested and the three likeliest are listed. It writes nothing to the graph, and a goal the tree's words already cover opens no socket at all.

The judge must run on this machine. `--judge=<url>` or `AMBIT_JUDGE_URL` can point it elsewhere on loopback, and it defaults to Kev on `http://127.0.0.1:8009`. Any other host is refused before anything is sent.

## Where Jev stops

Use Jev to decide what to try, and `ambit_can` to decide whether it may run.

Jev returns a probability, and text inside the state it reads can move that probability. In one published test, injected text dropped its probability of blocking `rm -rf ~/.ssh` from 0.76 to 0.48. A runtime may consult Jev before it asks Ambit, and that is a sensible use. What Jev never does is stand in for a grant. Ambit's answer to whether an action may run comes from a grant a person set in advance, and nothing an agent reads can widen it. [The deep dive](./deep-dive.md#capability-and-authority-are-different-things) states the rule, and [the FAQ](./faq.md#i-use-jev-where-does-it-fit) has the short version.
