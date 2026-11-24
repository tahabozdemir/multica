// Parser for `git diff` output. Pure: no Electron, no filesystem, so it is
// tested on fixtures alone.

import type { LocalGitDiffFile, LocalGitDiffHunk } from "../shared/local-git";


export interface ParseLimits {
  /** Lines kept per file across all of its hunks. */
  maxLinesPerFile: number;
}

export const DEFAULT_PARSE_LIMITS: ParseLimits = { maxLinesPerFile: 3000 };

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Splits `git diff` output into files. Expects the default `a/` and `b/`
 * prefixes (the caller forces them, so a user's `diff.noprefix` cannot change
 * how paths read here).
 */
export function parseGitDiff(
  text: string,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
): LocalGitDiffFile[] {
  const files: LocalGitDiffFile[] = [];
  let file: LocalGitDiffFile | null = null;
  let hunk: LocalGitDiffHunk | null = null;
  let kept = 0;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of text.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      file = {
        path: pathFromDiffGitHeader(raw.slice("diff --git ".length)),
        status: "modified",
        binary: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        truncated: false,
      };
      files.push(file);
      hunk = null;
      kept = 0;
      continue;
    }
    if (!file) continue;

    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: raw, lines: [] };
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      readFileHeaderLine(file, raw);
      continue;
    }

    const marker = raw[0];
    if (marker === "+") {
      file.additions += 1;
      if (keep()) hunk.lines.push({ kind: "add", text: raw.slice(1), new_line: newLine });
      newLine += 1;
    } else if (marker === "-") {
      file.deletions += 1;
      if (keep()) hunk.lines.push({ kind: "remove", text: raw.slice(1), old_line: oldLine });
      oldLine += 1;
    } else if (marker === " ") {
      if (keep()) {
        hunk.lines.push({ kind: "context", text: raw.slice(1), old_line: oldLine, new_line: newLine });
      }
      oldLine += 1;
      newLine += 1;
    }
    // "\ No newline at end of file" and the empty string after the final
    // newline carry no line of their own.
  }

  // A hunk kept nothing once the limit was reached; showing its bare header
  // would read as an empty change.
  for (const f of files) f.hunks = f.hunks.filter((h) => h.lines.length > 0);
  return files;

  function keep(): boolean {
    if (kept >= limits.maxLinesPerFile) {
      if (file) file.truncated = true;
      return false;
    }
    kept += 1;
    return true;
  }
}

function readFileHeaderLine(file: LocalGitDiffFile, raw: string): void {
  if (raw.startsWith("new file mode")) {
    file.status = "added";
  } else if (raw.startsWith("deleted file mode")) {
    file.status = "deleted";
  } else if (raw.startsWith("rename from ")) {
    file.status = "renamed";
    file.old_path = unquotePath(raw.slice("rename from ".length));
  } else if (raw.startsWith("rename to ")) {
    file.path = unquotePath(raw.slice("rename to ".length));
  } else if (raw.startsWith("copy from ")) {
    file.status = "copied";
    file.old_path = unquotePath(raw.slice("copy from ".length));
  } else if (raw.startsWith("copy to ")) {
    file.path = unquotePath(raw.slice("copy to ".length));
  } else if (raw.startsWith("+++ ")) {
    const path = stripSidePrefix(raw.slice(4), "b/");
    if (path !== null) file.path = path;
  } else if (raw.startsWith("--- ")) {
    // A deletion has no `+++ b/` path, so its old path is the file's path.
    const path = stripSidePrefix(raw.slice(4), "a/");
    if (path !== null && file.status === "deleted") file.path = path;
  } else if (raw.startsWith("Binary files ") || raw === "GIT binary patch") {
    file.binary = true;
  }
}

/** `a/foo` -> `foo`; `/dev/null` -> null. Git appends a tab to names with spaces. */
function stripSidePrefix(value: string, prefix: "a/" | "b/"): string | null {
  const name = unquotePath(value.endsWith("\t") ? value.slice(0, -1) : value);
  if (name === "/dev/null") return null;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Best-effort path from `a/<path> b/<path>`. Only a fallback: the `+++`,
 * `rename to` and `copy to` lines override it, and they are unambiguous. A
 * header alone (mode change, pure rename) has the same path on both sides.
 */
function pathFromDiffGitHeader(rest: string): string {
  if (rest.startsWith('"')) {
    const end = closingQuote(rest, 0);
    if (end > 0) {
      const second = rest.slice(end + 2);
      const name = unquotePath(second.startsWith('"') ? second : `"${second}"`);
      return name.startsWith("b/") ? name.slice(2) : name;
    }
  }
  const length = (rest.length - 5) / 2;
  if (Number.isInteger(length) && length > 0) {
    const path = rest.slice(2, 2 + length);
    if (rest === `a/${path} b/${path}`) return path;
  }
  const split = rest.indexOf(" b/");
  return split >= 0 ? rest.slice(split + 3) : rest;
}

function closingQuote(value: string, open: number): number {
  for (let i = open + 1; i < value.length; i++) {
    if (value[i] === "\\") {
      i += 1;
      continue;
    }
    if (value[i] === '"') return i;
  }
  return -1;
}

const SIMPLE_ESCAPES: Record<string, number> = {
  a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92,
};

/** Reverses git's C-style quoting of unusual paths; bytes decode as UTF-8. */
export function unquotePath(value: string): string {
  if (!(value.length >= 2 && value.startsWith('"') && value.endsWith('"'))) return value;
  const body = value.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      bytes.push(...Buffer.from(ch, "utf8"));
      continue;
    }
    const next = body[i + 1] ?? "";
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      i += 3;
    } else if (next in SIMPLE_ESCAPES) {
      bytes.push(SIMPLE_ESCAPES[next] as number);
      i += 1;
    } else {
      bytes.push(92);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/** A whole new file as an all-added diff, for untracked files git does not diff. */
export function untrackedFileDiff(
  path: string,
  content: string,
  limits: ParseLimits = DEFAULT_PARSE_LIMITS,
): LocalGitDiffFile {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const kept = lines.slice(0, limits.maxLinesPerFile);
  return {
    path,
    status: "untracked",
    binary: false,
    additions: lines.length,
    deletions: 0,
    hunks:
      kept.length === 0
        ? []
        : [
            {
              header: `@@ -0,0 +1,${lines.length} @@`,
              lines: kept.map((text, index) => ({ kind: "add" as const, text, new_line: index + 1 })),
            },
          ],
    truncated: lines.length > kept.length,
  };
}
