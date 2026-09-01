/**
 * Speaking JSON-RPC over stdio: how a result or an error leaves this process.
 *
 * Framing, and nothing about what the tools do. Every write goes through here,
 * so a change to how results are shaped — `structuredContent` was one — is a
 * change to one file rather than to forty-eight call sites.
 */

/**
 * A tool result an agent can use without parsing a string.
 *
 * Every tool returned its answer only as `content[0].text` — a JSON document
 * stringified into a text block, which the caller then had to `JSON.parse`
 * itself, with no declared shape and nothing to check it against. For a
 * project whose product is a machine-readable model of an environment, the
 * machine-facing side was the least specified surface it had.
 *
 * MCP's `structuredContent` is the typed sibling of `content`: the same answer
 * as data. `content` stays, because a client that predates structured output
 * still reads it, and because a person tailing the transcript can read JSON.
 */
function toolResult(value: unknown) {
  const text = JSON.stringify(value, null, 2);
  // structuredContent must be an object; a bare array or scalar is wrapped so
  // the field is always present and always the same shape of thing.
  const structured =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  return { content: [{ type: 'text', text }], structuredContent: structured };
}

function respond(id: unknown, r: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: r }) + '\n');
}
function err(id: unknown, c: number, m: string) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code: c, message: m } }) + '\n'
  );
}

export { toolResult, respond, err };
