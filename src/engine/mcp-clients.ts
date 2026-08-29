import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface McpClientSeed {
  runtime: "cursor" | "windsurf";
  label: string;
  path: string;
  config: { mcp: Record<string, unknown> };
  mapping: Record<string, unknown>;
}

const CLIENTS = [
  {
    runtime: "cursor" as const,
    label: "Cursor",
    env: "CURSOR_MCP_CONFIG",
    path: (home: string) => join(home, ".cursor", "mcp.json"),
  },
  {
    runtime: "windsurf" as const,
    label: "Windsurf",
    env: "WINDSURF_MCP_CONFIG",
    path: (home: string) => join(home, ".codeium", "windsurf", "mcp_config.json"),
  },
];

/** Read MCP-only clients into the same config shape used by the engine seeder. */
export function discoverMcpClients(home = process.env.HOME || "/"): McpClientSeed[] {
  const found: McpClientSeed[] = [];
  for (const client of CLIENTS) {
    const path = process.env[client.env] || client.path(home);
    if (!existsSync(path)) continue;
    let raw: any;
    try { raw = JSON.parse(readFileSync(path, "utf8")); } catch { continue; }
    if (!raw?.mcpServers || typeof raw.mcpServers !== "object") continue;

    const mcp: Record<string, unknown> = {};
    for (const [name, server] of Object.entries<any>(raw.mcpServers)) {
      const remote = Boolean(server?.url || server?.serverUrl || server?.type === "http" || server?.type === "sse");
      mcp[name] = { ...server, type: remote ? "remote" : "local" };
    }
    if (Object.keys(mcp).length === 0) continue;

    found.push({
      runtime: client.runtime,
      label: client.label,
      path,
      config: { mcp },
      mapping: {
        config_keys: {
          mcp: {
            type: "mcp",
            domain_field: "type",
            domain_map: { remote: "backend", local: "infra" },
            desc_template: `${client.runtime} {type} server`,
          },
        },
        skill_dirs: [],
      },
    });
  }
  return found;
}
