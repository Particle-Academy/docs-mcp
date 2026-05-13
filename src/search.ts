import { readFileSync } from "node:fs";
import type { PackageDocs } from "./scanner.js";

export type SearchHit = {
  packageName: string;
  packageVersion: string;
  path: string;
  line: number;
  preview: string;
  /** Section heading containing this hit (`## ...`), if any. */
  heading?: string;
};

export type SearchOptions = {
  /** Restrict to one package. */
  packageName?: string;
  /** Max hits returned. Default 50. */
  limit?: number;
  /** Case-sensitive match. Default false. */
  caseSensitive?: boolean;
};

/**
 * Plain substring/word search across every scanned doc. Returns at most
 * `limit` hits with a short preview line + the section heading the hit
 * lives under (for quick agent triage before calling `docs_read`).
 */
export function search(
  scan: PackageDocs[],
  query: string,
  options: SearchOptions = {},
): SearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const limit = options.limit ?? 50;
  const cs = options.caseSensitive ?? false;
  const needle = cs ? trimmed : trimmed.toLowerCase();

  const out: SearchHit[] = [];

  outer: for (const pkg of scan) {
    if (options.packageName && pkg.name !== options.packageName) continue;
    for (const file of pkg.files) {
      let content: string;
      try {
        content = readFileSync(file.absolutePath, "utf8");
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      let lastHeading: string | undefined;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
        if (headingMatch) lastHeading = headingMatch[1].trim();
        const haystack = cs ? line : line.toLowerCase();
        if (haystack.includes(needle)) {
          out.push({
            packageName: pkg.name,
            packageVersion: pkg.version,
            path: file.path,
            line: i + 1,
            preview: line.length > 200 ? line.slice(0, 200) + "…" : line,
            heading: lastHeading,
          });
          if (out.length >= limit) break outer;
        }
      }
    }
  }

  return out;
}
