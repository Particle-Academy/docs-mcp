# Contributing to @particle-academy/docs-mcp

Notes for anyone, human or agent, working ON this package's code. How to USE the
package is in [AGENTS.md](./AGENTS.md); what it is, is in [README.md](./README.md).
`CLAUDE.md` is a symlink to this file, so Claude Code reads these notes when it
works in this repo.

## Build and test

```bash
npm run build   # tsc -p .
npm run dev     # tsc -w -p .
npm test        # vitest run
```

Sources are in `src/` (`cli.ts`, `mcp.ts`, `stdio.ts`, `scanner.ts`,
`search.ts`, `tools.ts`); tests are in `tests/`.

## Running a local build in an editor

While developing this package itself (or before it's published to npm),
point the editor at the local build:

```jsonc
{
  "mcpServers": {
    "particle-docs": {
      "command": "node",
      "args": ["/absolute/path/to/packages/docs-mcp/dist/cli.js"]
    }
  }
}
```

Run `npm run build` once in `packages/docs-mcp/` before pointing the
editor at it.

## Changelog

Update `CHANGELOG.md` (Keep a Changelog, `[Unreleased]` at the top) in the same
commit as the change.
