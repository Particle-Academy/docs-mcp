import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    McpServer,
    MCP_PROTOCOL_VERSION,
    SUPPORTED_PROTOCOL_VERSIONS,
    type JsonRpcMessage,
    type JsonRpcResponse,
} from "../src/mcp";
import { registerDocsTools } from "../src/tools";

/**
 * The MCP wire contract, against the 2025-11-25 revision.
 *
 * The server used to answer `2024-11-05` to every `initialize`, whatever the
 * client asked for. That is two things wrong at once: three revisions behind,
 * and not negotiation at all. The lifecycle rule is "If the server supports the
 * requested protocol version, it MUST respond with the same version. Otherwise,
 * the server MUST respond with another protocol version it supports", and that
 * SHOULD be the latest.
 *
 * The rest of this file is what moving revisions requires on a stdio server:
 * structuredContent is a JSON object (2025-06-18 schema), an unknown tool is
 * -32602 and a handler failure is a tool result with isError (2025-11-25 tools
 * page), and JSON-RPC batches exist ONLY in 2025-03-26 — added there as a MUST
 * for receivers, removed again in 2025-06-18.
 */

/** Drive the server and capture everything it sends back. */
function harness(server: McpServer) {
    const sent: unknown[] = [];
    const transport = { send: (m: unknown) => void sent.push(m) };
    const send = async (message: unknown) => {
        await server.receive(transport as never, message as JsonRpcMessage);
        return sent.at(-1);
    };
    const initialize = (protocolVersion?: unknown) =>
        send({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                ...(protocolVersion === undefined ? {} : { protocolVersion }),
                capabilities: {},
                clientInfo: { name: "test", version: "1" },
            },
        }) as Promise<JsonRpcResponse>;
    return { sent, send, initialize };
}

const versionOf = (res: JsonRpcResponse) => (res.result as { protocolVersion: string }).protocolVersion;

describe("protocol version negotiation", () => {
    it("speaks the current revision, 2025-11-25", () => {
        expect(MCP_PROTOCOL_VERSION).toBe("2025-11-25");
        expect(SUPPORTED_PROTOCOL_VERSIONS[0]).toBe("2025-11-25");
    });

    it("answers 2025-11-25 to a client that asks for it", async () => {
        const { initialize } = harness(new McpServer({ name: "t", version: "0" }));

        expect(versionOf(await initialize("2025-11-25"))).toBe("2025-11-25");
    });

    it.each(["2025-06-18", "2025-03-26", "2024-11-05"])(
        "echoes an older revision it still supports (%s)",
        async (requested) => {
            const { initialize } = harness(new McpServer({ name: "t", version: "0" }));

            expect(versionOf(await initialize(requested))).toBe(requested);
        },
    );

    it.each(["2099-01-01", "1.0", 42])("answers its latest revision to one it does not know (%s)", async (requested) => {
        const { initialize } = harness(new McpServer({ name: "t", version: "0" }));

        expect(versionOf(await initialize(requested))).toBe("2025-11-25");
    });

    it("answers its latest revision when the client omits protocolVersion", async () => {
        const { initialize } = harness(new McpServer({ name: "t", version: "0" }));

        expect(versionOf(await initialize())).toBe("2025-11-25");
    });
});

describe("tools/call errors", () => {
    it("reports an unknown tool as -32602, the code the spec gives for it", async () => {
        const { initialize, send } = harness(new McpServer({ name: "t", version: "0" }));
        await initialize("2025-11-25");

        const res = (await send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "nope", arguments: {} },
        })) as JsonRpcResponse;

        expect(res.error?.code).toBe(-32602);
    });

    it("returns a throwing handler as a tool result with isError, not a protocol error", async () => {
        const server = new McpServer({ name: "t", version: "0" });
        server.registerTool({ name: "boom", inputSchema: { type: "object" } }, () => {
            throw new Error("disk on fire");
        });
        const { initialize, send } = harness(server);
        await initialize("2025-11-25");

        const res = (await send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: "boom", arguments: {} },
        })) as JsonRpcResponse;

        expect(res.error).toBeUndefined();
        const result = res.result as { isError?: boolean; content: Array<{ text: string }> };
        expect(result.isError).toBe(true);
        expect(result.content[0]!.text).toContain("disk on fire");
    });
});

describe("JSON-RPC batches", () => {
    const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });

    it("answers a batch under 2025-03-26, which requires receivers to accept them", async () => {
        const { initialize, send } = harness(new McpServer({ name: "t", version: "0" }));
        await initialize("2025-03-26");

        const res = await send([ping(2), { jsonrpc: "2.0", method: "notifications/initialized" }, ping(3)]);

        expect(res).toEqual([
            { jsonrpc: "2.0", id: 2, result: {} },
            { jsonrpc: "2.0", id: 3, result: {} },
        ]);
    });

    it.each(["2025-11-25", "2025-06-18"])("rejects a batch under %s, which removed batching", async (v) => {
        const { initialize, send } = harness(new McpServer({ name: "t", version: "0" }));
        await initialize(v);

        const res = (await send([ping(2)])) as JsonRpcResponse;

        expect(res).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32600 } });
    });

    it("rejects a batch before initialize (initialize MUST NOT be batched)", async () => {
        const { send } = harness(new McpServer({ name: "t", version: "0" }));

        const res = (await send([ping(2)])) as JsonRpcResponse;

        expect(res).toMatchObject({ id: null, error: { code: -32600 } });
    });
});

describe("structuredContent is a JSON object", () => {
    // CallToolResult.structuredContent is `{ [key: string]: unknown }` from
    // 2025-06-18 on. Three tools returned bare ARRAYS there, which a client
    // that validates results against the schema rejects outright.
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "docs-mcp-proto-"));
        const root = join(dir, "node_modules", "@particle-academy", "alpha");
        mkdirSync(join(root, "docs"), { recursive: true });
        writeFileSync(join(root, "package.json"), JSON.stringify({ name: "@particle-academy/alpha", version: "1.0.0" }));
        writeFileSync(join(root, "README.md"), "# Alpha\n\nThe grid paints cells.\n");
        writeFileSync(join(root, "docs", "guide.md"), "# Guide\n\nPaint a cell.\n");
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    const calls: Array<[string, Record<string, unknown>]> = [
        ["docs_list_packages", {}],
        ["docs_list", {}],
        ["docs_read", { package: "@particle-academy/alpha", path: "README.md" }],
        ["docs_search", { query: "paint" }],
        ["docs_search", { query: "no-such-text" }],
        ["docs_refresh", {}],
    ];

    it.each(calls)("%s %j", async (name, args) => {
        const server = new McpServer({ name: "t", version: "0" });
        registerDocsTools(server, { cwd: dir, includeWorkspace: false });
        const { initialize, send } = harness(server);
        await initialize("2025-11-25");

        const res = (await send({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name, arguments: args },
        })) as JsonRpcResponse;

        const result = res.result as { isError?: boolean; structuredContent?: unknown };
        expect(result.isError, JSON.stringify(res)).toBeFalsy();
        const sc = result.structuredContent;
        expect(sc !== null && typeof sc === "object" && !Array.isArray(sc), JSON.stringify(sc)).toBe(true);
    });
});
