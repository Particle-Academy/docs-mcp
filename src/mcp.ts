/**
 * Minimal MCP server (JSON-RPC 2.0 over a transport). Implements only the
 * surface a docs server needs: `initialize`, `tools/list`, `tools/call`,
 * plus `notifications/initialized` ack. Lifted concept (and frame shapes)
 * from `@particle-academy/agent-integrations`'s MicroMcpServer but inlined
 * so this CLI ships with zero runtime dependencies.
 *
 * Spec: https://modelcontextprotocol.io/specification (2024-11-05).
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };
export type JsonRpcId = number | string | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  method: string;
  params?: JsonObject;
};
export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: JsonObject;
};
export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: JsonValue;
  error?: { code: number; message: string; data?: JsonValue };
};
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: JsonObject; // JSON Schema fragment
};
export type CallToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };
export type CallToolResult = {
  content: CallToolContent[];
  isError?: boolean;
  structuredContent?: JsonValue;
};
export type ToolHandler = (args: JsonObject) => Promise<CallToolResult> | CallToolResult;

export type ServerInfo = { name: string; version: string };

export function textResult(text: string, structuredContent?: JsonValue): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent };
}
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export type Transport = {
  send: (message: JsonRpcMessage) => void;
  close?: () => void;
};

export class McpServer {
  private tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();
  constructor(
    public readonly info: ServerInfo,
    public readonly instructions?: string,
  ) {}

  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  async receive(transport: Transport, message: JsonRpcMessage): Promise<void> {
    if (!("method" in message)) return; // responses ignored
    if (!("id" in message) || message.id === undefined) {
      // notification — accept and drop
      return;
    }
    const req = message as JsonRpcRequest;
    try {
      const result = await this.dispatch(req);
      transport.send({ jsonrpc: "2.0", id: req.id, result });
    } catch (err) {
      transport.send({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  private async dispatch(req: JsonRpcRequest): Promise<JsonValue> {
    switch (req.method) {
      case "initialize": {
        return {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: this.info,
          ...(this.instructions ? { instructions: this.instructions } : {}),
        };
      }
      case "ping":
        return {};
      case "tools/list": {
        return {
          tools: [...this.tools.values()].map((t) => t.definition as unknown as JsonValue),
        };
      }
      case "tools/call": {
        const params = req.params ?? {};
        const name = params.name;
        const args = (params.arguments ?? {}) as JsonObject;
        if (typeof name !== "string") {
          throw new RpcError(-32602, "tools/call requires string `name` param");
        }
        const entry = this.tools.get(name);
        if (!entry) throw new RpcError(-32601, `Unknown tool: ${name}`);
        const result = await entry.handler(args);
        return result as unknown as JsonValue;
      }
      default:
        throw new RpcError(-32601, `Method not found: ${req.method}`);
    }
  }
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}
