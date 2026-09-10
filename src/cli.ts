#!/usr/bin/env node
import { McpServer } from "./mcp.js";
import { attachStdio } from "./stdio.js";
import { registerDocsTools } from "./tools.js";
import { scan, type ScanOptions } from "./scanner.js";
import { readFileSync } from "node:fs";

/**
 * docs-mcp — local MCP server that exposes the docs shipped inside every
 * installed @particle-academy/* package (and the monorepo's in-tree
 * packages when run from a sandbox root).
 *
 * Configure in your editor's MCP config (Claude Code, Cursor, Claude
 * Desktop, etc.):
 *
 *   {
 *     "mcpServers": {
 *       "particle-docs": {
 *         "command": "npx",
 *         "args": ["-y", "@particle-academy/docs-mcp"]
 *       }
 *     }
 *   }
 *
 * Flags:
 *   --cwd <dir>         Project root to scan from. Default: process.cwd()
 *   --scope <name>      Restrict to scope(s). Repeatable. Default: @particle-academy
 *   --scope-any         Scan every npm scope (and unscoped, with --include-unscoped)
 *   --package <name>    Scan only these packages. Repeatable.
 *   --include-unscoped  Include unscoped packages (off by default)
 *   --no-workspace      Don't scan <cwd>/packages/<name>/docs even if present
 *   --list              Print discovered packages and exit (debug mode)
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opts: ScanOptions = {};
  const scopes: string[] = [];
  const packages: string[] = [];
  let listOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--cwd":
        opts.cwd = argv[++i];
        break;
      case "--scope":
        scopes.push(argv[++i]);
        break;
      case "--scope-any":
        opts.scopes = [];
        break;
      case "--package":
        packages.push(argv[++i]);
        break;
      case "--include-unscoped":
        opts.includeUnscoped = true;
        break;
      case "--no-workspace":
        opts.includeWorkspace = false;
        break;
      case "--list":
        listOnly = true;
        break;
      case "--help":
      case "-h":
        process.stdout.write(HELP);
        process.exit(0);
      default:
        process.stderr.write(`[docs-mcp] unknown flag: ${a}\n`);
        process.exit(2);
    }
  }
  if (scopes.length > 0) opts.scopes = scopes;
  if (packages.length > 0) opts.packages = packages;

  if (listOnly) {
    const found = scan(opts);
    process.stdout.write(
      `Scanned from ${opts.cwd ?? process.cwd()}\nFound ${found.length} package(s):\n` +
        found
          .map(
            (p) =>
              `  ${p.name}@${p.version} (${p.source})  ${p.files.length} file(s)\n` +
              p.files.map((f) => `    - ${f.path}`).join("\n"),
          )
          .join("\n") +
        "\n",
    );
    process.exit(0);
  }

  const server = new McpServer(
    { name: "particle-docs-mcp", version: VERSION },
    "Docs for every installed @particle-academy/* package. Use docs_list_packages, docs_list, docs_search, docs_read.",
  );
  registerDocsTools(server, opts);
  attachStdio(server);
}

/**
 * This package's version, read from `package.json` rather than duplicated here.
 *
 * The literal it replaces said "0.1.0" while the package shipped as 0.2.0, and
 * the comment beside it asked a human to remember to bump both — which is the
 * failure, not the mitigation. Every version surface in this estate that was a
 * second copy had drifted, including one a user hit: `fancy-flow-py` reported
 * 0.1.0 from a 0.4.0 install for three releases.
 *
 * `../package.json` resolves from `src/` and from `dist/` alike (both are one
 * level below the package root), and npm always ships package.json regardless
 * of the `files` list.
 */
const VERSION: string = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

const HELP = `docs-mcp — local MCP server for @particle-academy/* package docs.

Usage: docs-mcp [options]

Options:
  --cwd <dir>           Project root to scan from (default: process.cwd())
  --scope <name>        Restrict to scope(s). Repeatable. Default: @particle-academy
  --scope-any           Scan every npm scope
  --package <name>      Scan only these packages. Repeatable.
  --include-unscoped    Include unscoped packages
  --no-workspace        Don't scan <cwd>/packages/*/docs even if present
  --list                Print discovered packages and exit (debug)
  -h, --help            Show this help

When invoked without --list, speaks MCP JSON-RPC 2.0 over stdin/stdout.
`;

main().catch((e) => {
  process.stderr.write(`[docs-mcp] fatal: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
});
