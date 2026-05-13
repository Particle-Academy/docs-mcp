import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, sep, relative } from "node:path";

/**
 * One markdown file discovered inside a package's `docs/` directory.
 * `path` is the docs-relative path (e.g. `guides/sheets.md`) — that's
 * what `docs_read` accepts as the `path` argument.
 */
export type DocFile = {
  packageName: string;
  packageVersion: string;
  /** `node_modules` for installed packages, `workspace` for the monorepo's
   *  in-tree packages (when scanned from a monorepo root). */
  source: "node_modules" | "workspace";
  path: string;
  absolutePath: string;
  bytes: number;
};

export type PackageDocs = {
  name: string;
  version: string;
  source: "node_modules" | "workspace";
  docsRoot: string;
  files: DocFile[];
};

export type ScanOptions = {
  /** Project root. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * npm scopes to scan. Defaults to `["@particle-academy"]`. Pass an empty
   * array to scan every scope. Unscoped packages are scanned only if
   * `includeUnscoped` is true (off by default).
   */
  scopes?: string[];
  /**
   * Specific package names (overrides scope filtering). When set, only
   * these packages are scanned. Useful for tight test fixtures.
   */
  packages?: string[];
  /** Include unscoped (non-`@scope/`) packages. Default false. */
  includeUnscoped?: boolean;
  /** Also scan `<cwd>/packages/&#42;/docs` when a `packages/` dir exists. Default true. */
  includeWorkspace?: boolean;
};

const DEFAULT_SCOPES = ["@particle-academy"];

export function scan(opts: ScanOptions = {}): PackageDocs[] {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const scopes = opts.scopes ?? DEFAULT_SCOPES;
  const allowName = (name: string) => {
    if (opts.packages && opts.packages.length > 0) {
      return opts.packages.includes(name);
    }
    if (scopes.length === 0) {
      return opts.includeUnscoped || name.startsWith("@");
    }
    if (name.startsWith("@")) {
      const scope = name.split("/")[0];
      return scopes.includes(scope);
    }
    return Boolean(opts.includeUnscoped);
  };

  const found = new Map<string, PackageDocs>();

  // Installed packages (node_modules)
  const nm = join(cwd, "node_modules");
  if (existsSync(nm)) {
    for (const dir of listPackageDirs(nm)) {
      if (!allowName(dir.name)) continue;
      const pkg = readPackage(dir.absolutePath, "node_modules");
      if (pkg) found.set(pkg.name, pkg);
    }
  }

  // Workspace packages (monorepo) — these win over node_modules with the
  // same name because in-tree docs are the source of truth during dev.
  if (opts.includeWorkspace !== false) {
    const pkgsRoot = join(cwd, "packages");
    if (existsSync(pkgsRoot)) {
      for (const entry of readdirSafe(pkgsRoot)) {
        const abs = join(pkgsRoot, entry);
        if (!isDir(abs)) continue;
        const pkgJsonPath = join(abs, "package.json");
        if (!existsSync(pkgJsonPath)) continue;
        const meta = readPackageJson(pkgJsonPath);
        if (!meta || !allowName(meta.name)) continue;
        const pkg = collectDocs(abs, meta.name, meta.version, "workspace");
        if (pkg) found.set(pkg.name, pkg);
      }
    }
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

type Dir = { name: string; absolutePath: string };

function listPackageDirs(root: string): Dir[] {
  const out: Dir[] = [];
  for (const entry of readdirSafe(root)) {
    const abs = join(root, entry);
    if (!isDir(abs)) continue;
    if (entry.startsWith("@")) {
      // scope dir — descend
      for (const sub of readdirSafe(abs)) {
        const subAbs = join(abs, sub);
        if (isDir(subAbs)) out.push({ name: `${entry}/${sub}`, absolutePath: subAbs });
      }
    } else if (!entry.startsWith(".")) {
      out.push({ name: entry, absolutePath: abs });
    }
  }
  return out;
}

function readPackage(absolutePath: string, source: "node_modules" | "workspace"): PackageDocs | null {
  const pkgJsonPath = join(absolutePath, "package.json");
  if (!existsSync(pkgJsonPath)) return null;
  const meta = readPackageJson(pkgJsonPath);
  if (!meta) return null;
  return collectDocs(absolutePath, meta.name, meta.version, source);
}

function collectDocs(
  packageRoot: string,
  name: string,
  version: string,
  source: "node_modules" | "workspace",
): PackageDocs | null {
  const docsRoot = join(packageRoot, "docs");
  const files: DocFile[] = [];
  // Also include a top-level README.md if present — it's the most common
  // first-touch doc.
  const readme = join(packageRoot, "README.md");
  if (existsSync(readme) && isFile(readme)) {
    files.push({
      packageName: name,
      packageVersion: version,
      source,
      path: "README.md",
      absolutePath: readme,
      bytes: statSync(readme).size,
    });
  }
  if (existsSync(docsRoot) && isDir(docsRoot)) {
    walkMd(docsRoot, (abs) => {
      const rel = relative(packageRoot, abs).split(sep).join("/");
      files.push({
        packageName: name,
        packageVersion: version,
        source,
        path: rel,
        absolutePath: abs,
        bytes: statSync(abs).size,
      });
    });
  }
  if (files.length === 0) return null;
  return { name, version, source, docsRoot, files };
}

function walkMd(dir: string, onFile: (absolutePath: string) => void): void {
  for (const entry of readdirSafe(dir)) {
    if (entry.startsWith(".")) continue;
    const abs = join(dir, entry);
    if (isDir(abs)) {
      walkMd(abs, onFile);
    } else if (entry.toLowerCase().endsWith(".md") || entry.toLowerCase().endsWith(".mdx")) {
      onFile(abs);
    }
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readPackageJson(p: string): { name: string; version: string } | null {
  try {
    const json = JSON.parse(readFileSync(p, "utf8")) as { name?: unknown; version?: unknown };
    if (typeof json.name !== "string" || json.name.length === 0) return null;
    const version = typeof json.version === "string" ? json.version : "0.0.0";
    return { name: json.name, version };
  } catch {
    return null;
  }
}

/** Read a doc's markdown by `(packageName, path)`. Returns null if not found
 *  in the most recent scan results (pass in the cached scan output). */
export function readDoc(scan: PackageDocs[], packageName: string, path: string): string | null {
  const pkg = scan.find((p) => p.name === packageName);
  if (!pkg) return null;
  const file = pkg.files.find((f) => f.path === path);
  if (!file) return null;
  try {
    return readFileSync(file.absolutePath, "utf8");
  } catch {
    return null;
  }
}
