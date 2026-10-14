# Ambit and Jev

TypeSafe's [Jev](https://en.wikipedia.org/wiki/Jev_(AI_model)) is a model that answers typed questions with calibrated probabilities instead of text: pick one of these options, place this on a scale, yes or no. It is fast and cheap enough to ask on every tool call, and agent harnesses now use it to decide what to try and whether a call looks safe. Ambit answers a different question, about what this setup can do and what an agent may do with it, so the two fit together.

## Jev on the map

Ambit models Jev as **Typed Judgment**, in the Model Access era of the curated tree. An era is one of the map's columns, ordered by what depends on what. Typed Judgment is reached however Jev arrives in your config:

- one of the community Jev MCP servers, seen as `mcp:jev` or similar;
- TypeSafe listed as a provider;
- an open clone that serves the same `/v1/systemone` API, such as Kev, LitJev or OpenJev;
- Cloudflare's Clef models (Clef, Clef-flash and Clef-omni), which answer the same typed questions in the same request and answer shape, on Workers AI or from their open weights.

A clone running on your own hardware also reaches **Local Typed Judgment**, which sits beside Local Embeddings in the Sovereignty era. That era holds what runs without a hosted service. The difference matters. The hosted API may keep requests for a while unless your account has a zero-retention agreement, and a local clone keeps the state it judges on your machine.

Every node of the curated tree is a combo, a capability composed from others, so its id starts with `combo:`. `ambit impact combo:typed-judgment` shows what depends on it, and `ambit goal typed-judgment` shows what it would take to reach it.

## Proving a local model answers

`ambit verify combo:local-typed-judgment` asks a local clone one trivial question and records whether judgments came back. It tries the ports Kev and OpenJev use by default, 8009 and 8080 on 127.0.0.1, and `TYPESAFE_BASE_URL` or `JEV_BASE_URL` when either names this machine.

It never contacts another host. A base URL that is not loopback is skipped, and one carrying credentials is refused, because `http://127.0.0.1:1@host` is a request to `host`. Typed Judgment itself has no check: proving the hosted API answers would spend your key on a call you did not type.

## Routing a goal through it

`ambit goal` routes a sentence by the words the curated tree authors for each capability. A goal that names none of them had no route in. With a clone running locally, `--judge` closes that gap:

```bash
ambit goal "triage incoming bug reports" --judge
```

When the vocabulary cannot recommend anything, the sentence goes to the local model as one Choice question over every node in the tree, plus one option saying none of them fits, and the likeliest node comes back with its probability. Below even odds, nothing is suggested and the three likeliest are listed; when "none of these" is the likeliest answer, nothing is suggested at all. Without that option a Choice has to pick a node, and does so with confidence: Clef-flash put *juggle flaming torches* in Skill Library at 0.69. With it, Clef-flash running on an M1 Max placed 44 of 48 sentences written for the tree first and all 48 in its top three, answered "none of these" for 13 of 16 that meant nothing in the tree, and kept the other three under even odds. Each answer took about six and a half seconds there. It writes nothing to the graph, and a goal the tree's words already cover opens no socket at all.

The judge must run on this machine. `--judge=<url>` or `AMBIT_JUDGE_URL` can point it elsewhere on loopback, and it defaults to Kev on `http://127.0.0.1:8009`. Any other host is refused before anything is sent. A server for the open Clef weights is a judge like any clone once it answers on `/v1/systemone`; Clef on Workers AI is a hosted API, and is refused for the same reason the hosted Jev is.

When no judge answers at all, the sentence goes to an embedding model on this machine instead: Ollama's `/api/embed` on `http://127.0.0.1:11434`, or `AMBIT_EMBED_URL`, held to the same loopback rule. A server that answers Ollama's path with a 404 is asked in the OpenAI shape, `/v1/embeddings`, which is what llama-server and LM Studio serve; a new embedding model often reaches llama.cpp before Ollama can run it. It picks EmbeddingGemma 2 if the server lists one, then any model whose name says it embeds, or the one `AMBIT_EMBED_MODEL` names. What comes back is the three nodes nearest the sentence in meaning, each with a cosine similarity. A similarity is not a probability, so the answer says which kind it is. The nearest node is suggested only above a floor measured for that model on sentences written for the tree, and only EmbeddingGemma 2 has one so far: on 48 such sentences its nearest node was right for 34, and every sentence meaning nothing in the tree scored below the floor. Any other model lists the nearest and suggests nothing. A judge that answered with an error is reported as one and never passed over.

## Serving Clef on your own machine

Cloudflare publishes Clef-flash's weights (9B, Apache 2.0) with the code that reads them, `joint_schema_model.py`, and its `systemone()` function takes a `/v1/systemone` request body and returns the answer body. A local judge is that function behind a loopback HTTP server:

```python
import json, sys, torch
from http.server import BaseHTTPRequestHandler, HTTPServer
from huggingface_hub import snapshot_download

path = snapshot_download("Cloudflare/clef-flash")
sys.path.insert(0, path)
from joint_schema_model import load_release_model, systemone

device = "mps" if torch.backends.mps.is_available() else "cuda"
model, processor = load_release_model(path, device=device)

class Judge(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        body.setdefault("model", "clef-flash")  # Ambit names none unless AMBIT_JUDGE_MODEL is set
        raw = json.dumps(systemone(model, processor, body)).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.end_headers()
        self.wfile.write(raw)

HTTPServer(("127.0.0.1", 8009), Judge).serve_forever()
```

It needs `torch`, `transformers` 5.10 or later, `safetensors`, `accelerate` and `pillow`, and about 19 GB of memory in bf16. On an M1 Max it loaded in under half a minute and answered Ambit's question in about six and a half seconds: the fast kernels for its linear-attention layers are CUDA-only, so Apple silicon runs the plain-torch path. `ambit verify combo:local-typed-judgment` then finds it on 8009.

## Measuring a model

The figures on this page come from `scripts/judge-eval.json`: 48 sentences written for the tree, none of them a goal phrase, each with the node a person would mean, and 16 that mean nothing in it. `npm run judge:eval` puts them through the same `judgeGoal` that `--judge` calls, so it measures the question, the "none of these" option and the floors as they ship. `--judge=<url>` names another judge and `--embed` measures the embedding fallback. A new model, a reworded node or a changed question is measured again the same way, and a new embedding model gets a floor only from that run: the highest score any off-tree sentence reached, with a margin above it.

## Where Jev stops

Use Jev to decide what to try, and `ambit_can` to decide whether it may run.

Jev returns a probability, and text inside the state it reads can move that probability. In one published test, injected text dropped its probability of blocking `rm -rf ~/.ssh` from 0.76 to 0.48. A runtime may consult Jev before it asks Ambit, and that is a sensible use. What Jev never does is stand in for a grant. Ambit's answer to whether an action may run comes from a grant a person set in advance, and nothing an agent reads can widen it. [The deep dive](./deep-dive.md#capability-and-authority-are-different-things) states the rule, and [the FAQ](./faq.md#i-use-jev-where-does-it-fit) has the short version.
