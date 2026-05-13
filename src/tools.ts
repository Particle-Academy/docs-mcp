import {
  type JsonObject,
  type McpServer,
  textResult,
  errorResult,
} from "./mcp.js";
import { scan, readDoc, type PackageDocs, type ScanOptions } from "./scanner.js";
import { search } from "./search.js";

/**
 * Register the four docs tools (`docs_list_packages`, `docs_list`,
 * `docs_read`, `docs_search`) against an MCP server. Scan results are
 * cached in-memory and refreshed when `docs_refresh` is called.
 */
export function registerDocsTools(server: McpServer, options: ScanOptions = {}): void {
  let cache: PackageDocs[] = scan(options);

  const refresh = () => {
    cache = scan(options);
    return cache;
  };

  server.registerTool(
    {
      name: "docs_list_packages",
      description:
        "List every @particle-academy/* (and other scanned) package that has docs available, with name, version, source (node_modules vs workspace), and file count.",
      inputSchema: { type: "object", properties: {} },
    },
    () => {
      const rows = cache.map((p) => ({
        name: p.name,
        version: p.version,
        source: p.source,
        fileCount: p.files.length,
      }));
      if (rows.length === 0) {
        return textResult(
          "No packages with docs found. Scan options: " + JSON.stringify(options),
          rows as unknown as JsonObject[],
        );
      }
      const lines = rows.map(
        (r) => `${r.name}@${r.version} (${r.source}) — ${r.fileCount} file${r.fileCount === 1 ? "" : "s"}`,
      );
      return textResult(lines.join("\n"), rows as unknown as JsonObject[]);
    },
  );

  server.registerTool(
    {
      name: "docs_list",
      description:
        "List doc file paths. Each entry is the path you pass to docs_read. Optionally filter to one package.",
      inputSchema: {
        type: "object",
        properties: {
          package: {
            type: "string",
            description: "Package name (e.g. '@particle-academy/react-fancy'). Omit to list all.",
          },
        },
      },
    },
    (args) => {
      const pkgFilter = typeof args.package === "string" ? args.package : undefined;
      const filtered = pkgFilter ? cache.filter((p) => p.name === pkgFilter) : cache;
      if (filtered.length === 0) {
        return errorResult(
          pkgFilter
            ? `No docs found for package '${pkgFilter}'. Call docs_list_packages to see available packages.`
            : "No docs found.",
        );
      }
      const rows = filtered.flatMap((p) =>
        p.files.map((f) => ({
          package: p.name,
          version: p.version,
          path: f.path,
          bytes: f.bytes,
        })),
      );
      const lines = rows.map((r) => `${r.package}@${r.version}  ${r.path}  (${r.bytes}B)`);
      return textResult(lines.join("\n"), rows as unknown as JsonObject[]);
    },
  );

  server.registerTool(
    {
      name: "docs_read",
      description:
        "Read the full markdown content of one doc file. Pass the package name and the path from docs_list.",
      inputSchema: {
        type: "object",
        properties: {
          package: { type: "string", description: "Package name, e.g. '@particle-academy/react-fancy'." },
          path: { type: "string", description: "Doc path, e.g. 'README.md' or 'docs/guides/sheets.md'." },
        },
        required: ["package", "path"],
      },
    },
    (args) => {
      const pkg = typeof args.package === "string" ? args.package : "";
      const path = typeof args.path === "string" ? args.path : "";
      if (!pkg || !path) {
        return errorResult("Both `package` and `path` are required.");
      }
      const content = readDoc(cache, pkg, path);
      if (content === null) {
        return errorResult(
          `Not found: ${pkg} :: ${path}. Call docs_list to see available paths.`,
        );
      }
      return textResult(content, { package: pkg, path, bytes: content.length });
    },
  );

  server.registerTool(
    {
      name: "docs_search",
      description:
        "Search docs for a substring. Returns hits with package, path, line number, preview, and the section heading the hit lives under.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring to look for." },
          package: { type: "string", description: "Restrict to one package (optional)." },
          limit: { type: "number", description: "Max hits returned. Default 50." },
          caseSensitive: { type: "boolean", description: "Case-sensitive match. Default false." },
        },
        required: ["query"],
      },
    },
    (args) => {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query.trim()) return errorResult("`query` must be a non-empty string.");
      const hits = search(cache, query, {
        packageName: typeof args.package === "string" ? args.package : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
        caseSensitive: typeof args.caseSensitive === "boolean" ? args.caseSensitive : undefined,
      });
      if (hits.length === 0) return textResult(`No hits for "${query}".`, []);
      const lines = hits.map(
        (h) =>
          `${h.packageName}  ${h.path}:${h.line}` +
          (h.heading ? `  [${h.heading}]` : "") +
          `\n    ${h.preview}`,
      );
      return textResult(lines.join("\n\n"), hits as unknown as JsonObject[]);
    },
  );

  server.registerTool(
    {
      name: "docs_refresh",
      description:
        "Re-scan the filesystem for docs. Call this after installing or updating a @particle-academy/* package mid-session.",
      inputSchema: { type: "object", properties: {} },
    },
    () => {
      const next = refresh();
      return textResult(
        `Re-scanned. Found ${next.length} package(s) with docs.`,
        { packageCount: next.length },
      );
    },
  );
}
