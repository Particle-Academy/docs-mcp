# @particle-academy/docs-mcp

> Local MCP server that exposes the docs shipped inside every installed
> `@particle-academy/*` package. Configure it once in your editor and any
> agent (Claude Code, Cursor, Claude Desktop, …) can list, read, and
> search the docs for whatever fancy-* packages your project actually
> has installed.

Zero runtime dependencies. Speaks MCP over stdin/stdout. Scans
`node_modules/@particle-academy/*/docs/**` and `node_modules/@particle-academy/*/README.md`.
When run from a monorepo root that has `packages/*/`, in-tree packages
win over their installed counterparts so docs match the code you're
editing.

## Install + configure

### Claude Code / Cursor (`.mcp.json` in project root)

```jsonc
{
  "mcpServers": {
    "particle-docs": {
      "command": "npx",
      "args": ["-y", "@particle-academy/docs-mcp"]
    }
  }
}
```

### Claude Desktop (`~/.../claude_desktop_config.json`)

```jsonc
{
  "mcpServers": {
    "particle-docs": {
      "command": "npx",
      "args": ["-y", "@particle-academy/docs-mcp"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

Restart your editor. The server is launched on demand and dies when
your editor closes.

## Tools

| Tool                  | What it does                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `docs_list_packages`  | List every scanned package with name, version, file count, source.           |
| `docs_list`           | List doc paths. Optional `package` filter.                                   |
| `docs_read`           | Read one doc's markdown by `(package, path)`.                                |
| `docs_search`         | Substring search across every doc with line numbers + section headings.      |
| `docs_refresh`        | Re-scan the filesystem (call after installing/updating a fancy-* package).   |

Tools return text content plus a `structuredContent` payload so agents
can either read the formatted text or destructure the rows.

## CLI flags

```
docs-mcp [options]

  --cwd <dir>           Project root to scan from (default: process.cwd())
  --scope <name>        Restrict to scope(s). Repeatable. Default: @particle-academy
  --scope-any           Scan every npm scope
  --package <name>      Scan only these packages. Repeatable.
  --include-unscoped    Include unscoped packages
  --no-workspace        Don't scan <cwd>/packages/*/docs even if present
  --list                Print discovered packages and exit (debug)
  -h, --help            Show this help
```

### Smoke-test the scan without MCP

```bash
npx @particle-academy/docs-mcp --list
```

Prints every package + doc path it found. Useful when configuring or
debugging.

## How the scan works

For each candidate package, the server looks for:

1. `<package>/README.md` (if present, included as path `README.md`)
2. Every `.md` / `.mdx` file under `<package>/docs/**`

Paths are stable docs-relative strings — `README.md`, `docs/guides/sheets.md`,
`docs/api/components.md` — that's what `docs_read` accepts as the `path`
argument.

By default the scan looks at:

- `<cwd>/node_modules/@particle-academy/*/` — installed packages
- `<cwd>/packages/*/` — monorepo workspace packages (if `packages/`
  exists). In-tree wins over `node_modules` for the same package name.

## License

MIT
