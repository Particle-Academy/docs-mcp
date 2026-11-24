# Changelog

Notable changes to `@particle-academy/docs-mcp`.

**BREAKING** marks anything that can stop working on upgrade. This package is
pre-1.0, so breaking changes land in MINOR releases — read those entries before
upgrading.

> Entries below **1.0** were reconstructed from git history when this file was
> introduced, so they summarise commit subjects rather than consumer impact.
> Everything from the next release onward is written by hand, in the same commit
> as the change.

---

## [Unreleased]

### Changed

- **Speaks MCP `2025-11-25`, and actually negotiates.** The server answered
  `2024-11-05` to every `initialize`, whatever the client asked for. It now
  answers the revision the client requests when it supports it (`2025-11-25`,
  `2025-06-18`, `2025-03-26`, `2024-11-05`) and `2025-11-25` otherwise, as the
  lifecycle spec requires. Older clients keep working on their own revision.
  This is a stdio server, so the HTTP-only rules of those revisions
  (`MCP-Protocol-Version` header, Origin checks, sessions) do not apply.
- **BREAKING: `structuredContent` is always a JSON object.** From 2025-06-18 the
  schema types it as an object, and `docs_list_packages`, `docs_list` and
  `docs_search` returned bare arrays there, which a client that validates
  results rejects. They now return `{ packages: [...] }`, `{ files: [...] }` and
  `{ hits: [...] }`. If your code reads `structuredContent` from those three
  tools, read the named key instead; the rows are unchanged. The text content is
  unchanged, so an agent reading the text needs nothing.
- **An unknown tool is error `-32602`**, the code the spec gives for it. Every
  protocol error was sent as `-32603` before, whatever its intended code.
- **A tool that throws returns a result with `isError: true`** instead of a
  protocol error, so the client passes it to the model (2025-11-25 error
  handling).

### Added

- **JSON-RPC batches under `2025-03-26` only.** That revision requires
  receivers to accept batches and the next one removed them. A batch is answered
  with an array of responses when `2025-03-26` was negotiated, and rejected with
  `-32600` under any other revision or before `initialize`. Before this, a batch
  was silently dropped.

- **CI: the lab-certificate gate verifies against the lab's rotated key list.**
  The lab's first signing key is retired: certificates it already issued still
  verify, and nothing new it signs ever can. Consumers do nothing.

- **Releases need a lab-run certificate.** `publish.yml` gains a read-only
  `lab-certificate` job that every publishing job needs: a tag is published only
  when the fancy-labs lab has certified that exact version and commit. Consumers
  do nothing; this changes how releases are cut, not what the package does.
- Rebranded the display name to Fancy Dev Kit (README and package description). Package names, the npm scope, URLs and the `fancy-ui` MCP id are unchanged.
- **Docs:** `AGENTS.md` added: the guide to using this package (install, its entries on the Fancy MCP catalog server, API essentials, traps), and it ships in the package. `CONTRIBUTING.md` added for the contributor notes, with `CLAUDE.md` as a symlink to it. The README points to the MCP server and to `AGENTS.md`. No code changed; nothing to do.
- CI: re-pin org third-party allowlist to 2614224

### Fixed
- **`CHANGELOG.md` is now in the published tarball.** `files` did not whitelist it, so npm never shipped it — and this package puts breaking changes in MINOR releases and tells you in the README to read the entry before taking one. The instruction existed for the author, who has the file, and not for the consumer, who is the only one being instructed. Nothing for you to do; the file simply arrives from this release on.

- **The MCP server advertised 0.1.0 while the package shipped as 0.2.0.** `serverInfo.version` goes out in every `initialize` response, so every connecting agent was told a version three months out of date. The comment beside the literal read "for now keep static and bump in package.json" — a description of the failure rather than a mitigation. It now reads `package.json` at runtime; `version.test.ts` fails if a literal returns.

### Security

- `source-map-js` is pinned forward to `^1.2.2` via `overrides`. Versions up to
  1.2.1 allow an event-loop denial of service through indexed source-map section
  offsets, and it arrives here transitively through the build toolchain.
  **Nothing for a consumer to do, and no runtime change**: an npm package does
  not ship a lockfile, so this governs builds OF this repo, not anything
  installed FROM it. Recorded rather than left silent because the override it
  sits beside — `shell-quote` `^1.9.0`, added for an earlier advisory — was
  carried with no note of why, and had drifted back inside the vulnerable range
  before anyone looked.
- **Dev toolchain only — no runtime change, nothing for consumers to do.** The
  lockfile now resolves `vite` 8.3.5 (was 8.2.2), whose bundled
  `launch-editor` fixes GHSA-587h-7wmj-h5pm (HIGH, `fs.existsSync()` check
  bypassable on Windows), GHSA-698v-4r3x-3vcv (`escapeCmdArgs()` omits `%`
  escaping on Windows) and GHSA-r825-w8mm-5pxw (editor CLI flag
  misinterpretation). `vite` is only reached through the test/dev toolchain
  and the published package does not ship our lockfile, so the exposure was
  this repo's own dev server.

- Dev-only lockfile update: `vitest` 4.1.11 to 4.1.12 (brings `@vitest/mocker` 4.1.12, GHSA-qxg6-89mg-rqv8 / GHSA-xp26-3454-mjgp) and `undici` 7.30.0 to 7.30.1 via jsdom (GHSA-2m5v-pch6-74hx, GHSA-4w7w-5xrc-9h26, GHSA-qrxm-fqhp-jwvm, GHSA-xjj6-f33q-929c, GHSA-9fm3-97px-rjf6). Neither ships in the package. Consumer action: none.

## 0.2.0 — 2026-08-07

### Changed

- **BREAKING — Node 22 is no longer supported.** `engines.node` moves from `>=22` to `>=22`.

  **What you must do:** on Node 22 or newer, nothing. Note npm only *warns* on an `engines` mismatch while **pnpm fails the install**, so this surfaces differently depending on your package manager. Node 18 is end-of-life and 20 is maintenance-only.

### Why

These are the kit 0.5 platform floors, applied across every package at once so a consumer never has to resolve a mix. **No API changed, nothing was removed, nothing was renamed** — only what the package requires.

## 0.1.1 — 2026-05-12

### Fixed

- drop ./ prefix from bin paths so npm doesn't strip them on publish

## 0.1.0 — 2026-05-12

### Added

- initial @particle-academy/docs-mcp@0.1.0
