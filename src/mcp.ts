/**
 * Minimal MCP server (JSON-RPC 2.0 over a transport). Implements only the
 * surface a docs server needs: `initialize`, `tools/list`, `tools/call`,
 * plus `notifications/initialized` ack. Lifted concept (and frame shapes)
 * from `@particle-academy/agent-integrations`'s MicroMcpServer but inlined
 * so this CLI ships with zero runtime dependencies.
 *
 * Spec: https://modelcontextprotocol.io/specification (2025-11-25), negotiating
 * down to 2025-06-18, 2025-03-26 and 2024-11-05.
 */

/** The revision this server prefers: the latest it supports. */
export const MCP_PROTOCOL_VERSION = "2025-11-25";

/**
 * Every revision this server can speak, newest first. Lifecycle: "If the server
 * supports the requested protocol version, it MUST respond with the same
 * version. Otherwise, the server MUST respond with another protocol version it
 * supports" (SHOULD be the latest). Nothing this server does differs between
 * these revisions except JSON-RPC batching, which exists only in 2025-03-26.
 */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

/** The one revision whose receivers MUST accept JSON-RPC batches. */
const BATCHING_REVISION = "2025-03-26";

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
  structuredContent?: JsonObject;
};
export type ToolHandler = (args: JsonObject) => Promise<CallToolResult> | CallToolResult;

export type ServerInfo = { name: string; version: string };

/**
 * `structuredContent` is typed as an object on purpose: from 2025-06-18 the
 * schema says `{ [key: string]: unknown }`, and a client that validates results
 * rejects a bare array there.
 */
export function textResult(text: string, structuredContent?: JsonObject): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent };
}
export function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export type Transport = {
  /** One message, or an array of responses answering a 2025-03-26 batch. */
  send: (message: JsonRpcMessage | JsonRpcResponse[]) => void;
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

  /** The revision agreed in `initialize`; undefined until then. */
  protocolVersion: string | undefined;

  async receive(transport: Transport, message: JsonRpcMessage | JsonRpcMessage[]): Promise<void> {
    if (Array.isArray(message)) {
      // Batches exist only in 2025-03-26, which made receiving them a MUST;
      // 2025-06-18 removed them. `initialize` MUST NOT be batched, so a batch
      // before negotiation is never valid.
      if (this.protocolVersion !== BATCHING_REVISION || message.length === 0) {
        transport.send({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message:
              message.length === 0
                ? "Invalid Request: empty batch"
                : `Invalid Request: JSON-RPC batching is not supported in MCP ${this.protocolVersion ?? "before initialize"}`,
          },
        });
        return;
      }
      const responses: JsonRpcResponse[] = [];
      for (const item of message) {
        const res = await this.handle(item);
        if (res) responses.push(res);
      }
      if (responses.length > 0) transport.send(responses);
      return;
    }
    const res = await this.handle(message);
    if (res) transport.send(res);
  }

  /** Handle one message; returns the response to send, or null for none. */
  private async handle(message: JsonRpcMessage): Promise<JsonRpcResponse | null> {
    if (message === null || typeof message !== "object" || !("method" in message)) return null; // responses ignored
    if (!("id" in message) || message.id === undefined) {
      // notification — accept and drop
      return null;
    }
    const req = message as JsonRpcRequest;
    try {
      const result = await this.dispatch(req);
      return { jsonrpc: "2.0", id: req.id, result };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: err instanceof RpcError ? err.code : -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private negotiate(requested: unknown): string {
    return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : MCP_PROTOCOL_VERSION;
  }

  private async dispatch(req: JsonRpcRequest): Promise<JsonValue> {
    switch (req.method) {
      case "initialize": {
        this.protocolVersion = this.negotiate(req.params?.protocolVersion);
        return {
          protocolVersion: this.protocolVersion,
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
        // Unknown tool is a protocol error, -32602 per the spec's own example.
        const entry = this.tools.get(name);
        if (!entry) throw new RpcError(-32602, `Unknown tool: ${name}`);
        // A failure INSIDE the tool is a tool execution error: a result with
        // isError, which the client hands to the model so it can correct
        // itself, rather than a protocol error it may swallow.
        try {
          const result = await entry.handler(args);
          return result as unknown as JsonValue;
        } catch (err) {
          return errorResult(err instanceof Error ? err.message : String(err)) as unknown as JsonValue;
        }
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
