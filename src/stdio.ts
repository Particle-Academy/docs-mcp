import { stdin, stdout, stderr } from "node:process";
import { createInterface } from "node:readline";
import type { JsonRpcMessage, McpServer, Transport } from "./mcp.js";

/**
 * Newline-delimited JSON-RPC over stdin/stdout — the standard transport
 * MCP clients (Claude Code, Cursor, Claude Desktop) use when they launch
 * a server as a subprocess. One JSON frame per line.
 */
export function attachStdio(server: McpServer): Transport {
  const transport: Transport = {
    send(message: JsonRpcMessage) {
      stdout.write(JSON.stringify(message) + "\n");
    },
    close() {
      // stdin closing is the signal to exit — handled below
    },
  };

  const rl = createInterface({ input: stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage;
    } catch (e) {
      stderr.write(`[docs-mcp] failed to parse line: ${e instanceof Error ? e.message : String(e)}\n`);
      return;
    }
    server.receive(transport, msg).catch((e) => {
      stderr.write(`[docs-mcp] dispatch failed: ${e instanceof Error ? e.message : String(e)}\n`);
    });
  });
  rl.on("close", () => {
    process.exit(0);
  });

  return transport;
}
