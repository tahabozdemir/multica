// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseGitDiff, unquotePath, untrackedFileDiff } from "./local-git-diff";

describe("parseGitDiff", () => {
  it("numbers lines on both sides and counts changes per file", () => {
    const files = parseGitDiff(
      [
        "diff --git a/src/app.ts b/src/app.ts",
        "index 1111111..2222222 100644",
        "--- a/src/app.ts",
        "+++ b/src/app.ts",
        "@@ -10,3 +10,4 @@ export function main() {",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        "+const c = 4;",
        " return a;",
        "",
      ].join("\n"),
    );
    expect(files).toHaveLength(1);
    const [file] = files;
    expect(file).toMatchObject({ path: "src/app.ts", status: "modified", additions: 2, deletions: 1, binary: false });
    expect(file?.hunks[0]?.lines).toEqual([
      { kind: "context", text: "const a = 1;", old_line: 10, new_line: 10 },
      { kind: "remove", text: "const b = 2;", old_line: 11 },
      { kind: "add", text: "const b = 3;", new_line: 11 },
      { kind: "add", text: "const c = 4;", new_line: 12 },
      { kind: "context", text: "return a;", old_line: 12, new_line: 13 },
    ]);
  });

  it("splits several files and reads added, deleted, renamed and binary headers", () => {
    const files = parseGitDiff(
      [
        "diff --git a/new.md b/new.md",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/new.md",
        "@@ -0,0 +1 @@",
        "+hello",
        "diff --git a/old.md b/old.md",
        "deleted file mode 100644",
        "--- a/old.md",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-bye",
        "diff --git a/a dir/x.txt b/b dir/x.txt",
        "similarity index 100%",
        "rename from a dir/x.txt",
        "rename to b dir/x.txt",
        "diff --git a/logo.png b/logo.png",
        "index 1111111..2222222 100644",
        "Binary files a/logo.png and b/logo.png differ",
        "",
      ].join("\n"),
    );
    expect(files.map((f) => [f.path, f.status, f.old_path, f.binary])).toEqual([
      ["new.md", "added", undefined, false],
      ["old.md", "deleted", undefined, false],
      ["b dir/x.txt", "renamed", "a dir/x.txt", false],
      ["logo.png", "modified", undefined, true],
    ]);
  });

  it("does not take a second file's headers as diff lines", () => {
    const files = parseGitDiff(
      [
        "diff --git a/one b/one",
        "--- a/one",
        "+++ b/one",
        "@@ -1 +1 @@",
        "-a",
        "+b",
        "diff --git a/two b/two",
        "--- a/two",
        "+++ b/two",
        "@@ -1 +1 @@",
        "-c",
        "+d",
      ].join("\n"),
    );
    expect(files.map((f) => [f.path, f.additions, f.deletions])).toEqual([
      ["one", 1, 1],
      ["two", 1, 1],
    ]);
  });

  it("keeps exact counts but stops storing lines past the per-file limit", () => {
    const body = Array.from({ length: 5 }, (_, i) => `+line ${i}`);
    const [file] = parseGitDiff(
      ["diff --git a/f b/f", "--- a/f", "+++ b/f", "@@ -0,0 +1,5 @@", ...body].join("\n"),
      { maxLinesPerFile: 2 },
    );
    expect(file?.additions).toBe(5);
    expect(file?.hunks[0]?.lines).toHaveLength(2);
    expect(file?.truncated).toBe(true);
  });

  it("reads quoted paths and the tab git appends to names with spaces", () => {
    const [quoted] = parseGitDiff(
      ['diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"', '--- "a/caf\\303\\251.txt"', '+++ "b/caf\\303\\251.txt"'].join("\n"),
    );
    expect(quoted?.path).toBe("café.txt");
    const [spaced] = parseGitDiff(["diff --git a/my file b/my file", "--- a/my file\t", "+++ b/my file\t"].join("\n"));
    expect(spaced?.path).toBe("my file");
  });
});

describe("unquotePath", () => {
  it("leaves unquoted names alone and decodes escapes", () => {
    expect(unquotePath("plain.txt")).toBe("plain.txt");
    expect(unquotePath('"tab\\there"')).toBe("tab\there");
    expect(unquotePath('"say \\"hi\\""')).toBe('say "hi"');
  });
});

describe("untrackedFileDiff", () => {
  it("shows every line as added and ignores the final newline", () => {
    const file = untrackedFileDiff("notes.txt", "a\nb\n");
    expect(file).toMatchObject({ path: "notes.txt", status: "untracked", additions: 2, truncated: false });
    expect(file.hunks[0]?.lines).toEqual([
      { kind: "add", text: "a", new_line: 1 },
      { kind: "add", text: "b", new_line: 2 },
    ]);
  });

  it("has no hunk for an empty file", () => {
    expect(untrackedFileDiff("empty", "").hunks).toEqual([]);
  });
});
