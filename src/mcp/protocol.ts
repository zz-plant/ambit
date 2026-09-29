/**
 * Speaking JSON-RPC over stdio: how a result or an error leaves this process.
 *
 * Framing, and nothing about what the tools do. Every write goes through here,
 * so a change to how results are shaped, `structuredContent` was one, is a
 * change to one file rather than to forty-eight call sites.
 */

/**
 * Whether an answer says the call did not work.
 *
 * The engine reports a call it cannot answer as `{ error: '...' }`, and always
 * has: it is what the CLI prints, and what the tests assert. Over MCP that
 * arrived as an ordinary success whose text happened to contain the word, so a
 * client had no field to branch on and a model had to notice. The spec's field
 * for it is `isError`, and this is the one place that sets it, by the one rule
 * the CLI's exit code uses: a top-level string `error`. An `error` nested inside
 * a report, one failing check among many, is part of a real answer and does
 * not count.
 */
function isFailure(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

/**
 * A tool result an agent can use without parsing a string.
 *
 * Every tool returned its answer only as `content[0].text`, a JSON document
 * stringified into a text block, which the caller then had to `JSON.parse`
 * itself, with no declared shape and nothing to check it against. For a
 * project whose product is a machine-readable model of an environment, the
 * machine-facing side was the least specified surface it had.
 *
 * MCP's `structuredContent` is the typed sibling of `content`: the same answer
 * as data. `content` stays, because a client that predates structured output
 * still reads it. It is compact now. The indented form spent about a quarter
 * of a typical result on whitespace (16% to 42% across twenty tools), and a
 * client that forwards both fields to a model paid for the answer twice.
 */
function toolResult(value: unknown, notice?: string) {
  // A notice rides on the human-readable half only. It used to be merged into
  // the value itself, which moved every tool's actual answer under a `result`
  // key whenever the graph happened to be unseeded, so the typed surface
  // changed shape depending on the state of a database, and a client reading
  // `structuredContent.verdict` got undefined on a fresh machine.
  const body = JSON.stringify(value);
  const text = notice ? `${notice}\n\n${body}` : body;
  // structuredContent must be an object; a bare array or scalar is wrapped so
  // the field is always present and always the same shape of thing.
  const structured =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { result: value };
  const result: Record<string, unknown> = {
    content: [{ type: 'text', text }],
    structuredContent: structured,
  };
  if (isFailure(value)) result.isError = true;
  return result;
}

function respond(id: unknown, r: unknown) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: r }) + '\n');
}
function err(id: unknown, c: number, m: string) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code: c, message: m } }) + '\n'
  );
}

export { isFailure, toolResult, respond, err };
