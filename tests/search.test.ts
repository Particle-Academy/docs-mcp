import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { search } from "../src/search";
import { readDoc } from "../src/scanner";
import { errorResult, textResult } from "../src/mcp";
import type { PackageDocs } from "../src/scanner";

let dir: string;

/** A scan result pointing at real files, since search reads from disk. */
function pkg(name: string, files: Record<string, string>): PackageDocs {
    const root = join(dir, name);
    mkdirSync(root, { recursive: true });
    return {
        name,
        version: "1.0.0",
        files: Object.entries(files).map(([path, content]) => {
            const absolutePath = join(root, path.replace(/\//g, "-"));
            writeFileSync(absolutePath, content, "utf8");
            return { path, absolutePath };
        }),
    } as PackageDocs;
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "docs-mcp-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("search", () => {
    it("finds a substring and reports which package and file it came from", () => {
        const scan = [pkg("alpha", { "README.md": "# Alpha\n\nThe grid paints cells.\n" })];

        const [hit] = search(scan, "paints");

        expect(hit!.packageName).toBe("alpha");
        expect(hit!.packageVersion).toBe("1.0.0");
    });

    it("is case-insensitive by default and exact when asked", () => {
        const scan = [pkg("alpha", { "README.md": "Paints cells\n" })];

        expect(search(scan, "paints")).toHaveLength(1);
        expect(search(scan, "paints", { caseSensitive: true })).toHaveLength(0);
        expect(search(scan, "Paints", { caseSensitive: true })).toHaveLength(1);
    });

    it("attributes a hit to the heading it lives under", () => {
        // This is what makes a hit triageable without a second read call — the
        // agent sees "Installation" rather than an anonymous line number.
        const scan = [
            pkg("alpha", {
                "README.md": "# Title\n\nintro\n\n## Installation\n\nrun npm install foo\n",
            }),
        ];

        const [hit] = search(scan, "npm install");

        expect(hit!.heading).toBe("Installation");
    });

    it("returns nothing for an empty or whitespace query rather than everything", () => {
        // A blank query matching every line would flood an agent's context with
        // the entire documentation set.
        const scan = [pkg("alpha", { "README.md": "anything\n" })];

        expect(search(scan, "")).toEqual([]);
        expect(search(scan, "   ")).toEqual([]);
    });

    it("honours the limit across packages, not per package", () => {
        const scan = [
            pkg("alpha", { "a.md": "match\nmatch\nmatch\n" }),
            pkg("beta", { "b.md": "match\nmatch\nmatch\n" }),
        ];

        expect(search(scan, "match", { limit: 4 })).toHaveLength(4);
    });

    it("scopes to one package when asked", () => {
        const scan = [
            pkg("alpha", { "a.md": "shared word\n" }),
            pkg("beta", { "b.md": "shared word\n" }),
        ];

        const hits = search(scan, "shared", { packageName: "beta" });

        expect(hits).toHaveLength(1);
        expect(hits[0]!.packageName).toBe("beta");
    });

    it("skips a file that has gone missing instead of throwing", () => {
        // A scan is a snapshot; by the time a search runs, a file may have been
        // deleted. One unreadable file must not fail the whole query.
        const scan = [pkg("alpha", { "gone.md": "x\n" })];
        rmSync(scan[0]!.files[0]!.absolutePath);

        expect(() => search(scan, "x")).not.toThrow();
        expect(search(scan, "x")).toEqual([]);
    });
});

describe("readDoc", () => {
    it("returns the file's content for a known package + path", () => {
        const scan = [pkg("alpha", { "README.md": "hello docs\n" })];

        expect(readDoc(scan, "alpha", "README.md")).toContain("hello docs");
    });

    it("returns null for an unknown package or path rather than throwing", () => {
        const scan = [pkg("alpha", { "README.md": "hi\n" })];

        expect(readDoc(scan, "nope", "README.md")).toBeNull();
        expect(readDoc(scan, "alpha", "nope.md")).toBeNull();
    });
});

describe("tool results", () => {
    it("wraps text in the MCP content shape", () => {
        expect(textResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }], structuredContent: undefined });
    });

    it("carries structured content alongside the text when given", () => {
        const r = textResult("hi", { count: 1 });

        expect(r.structuredContent).toEqual({ count: 1 });
    });

    it("marks an error result so a client can tell failure from prose", () => {
        // Without isError, a failure is just a string the model reads as an
        // answer.
        const r = errorResult("nope");

        expect(r.isError).toBe(true);
        expect(r.content[0]).toEqual({ type: "text", text: "nope" });
    });
});
