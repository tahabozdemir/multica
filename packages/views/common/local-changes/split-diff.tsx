"use client";

import { cn } from "@multica/ui/lib/utils";
import type { LocalGitDiffFile, LocalGitDiffLine } from "../../platform/local-git";

type SplitRow =
  | { kind: "hunk"; header: string }
  | { kind: "pair"; left: LocalGitDiffLine | null; right: LocalGitDiffLine | null };

/**
 * Side-by-side rows from unified hunks. A run of removed lines is paired with
 * the run of added lines that follows it, line for line, so an edited line
 * sits next to what replaced it; context lines appear on both sides.
 */
export function splitRows(file: LocalGitDiffFile): SplitRow[] {
  const rows: SplitRow[] = [];
  for (const hunk of file.hunks) {
    rows.push({ kind: "hunk", header: hunk.header });
    let removed: LocalGitDiffLine[] = [];
    let added: LocalGitDiffLine[] = [];
    const flush = () => {
      for (let i = 0; i < Math.max(removed.length, added.length); i++) {
        rows.push({ kind: "pair", left: removed[i] ?? null, right: added[i] ?? null });
      }
      removed = [];
      added = [];
    };
    for (const line of hunk.lines) {
      if (line.kind === "remove") removed.push(line);
      else if (line.kind === "add") added.push(line);
      else {
        flush();
        rows.push({ kind: "pair", left: line, right: line });
      }
    }
    flush();
  }
  return rows;
}

export function SplitDiffBody({
  file,
  highlighted,
}: {
  file: LocalGitDiffFile;
  highlighted: Map<LocalGitDiffLine, string>;
}) {
  return (
    <div className="transcript-code overflow-x-auto py-1 font-mono text-micro">
      {splitRows(file).map((row, index) =>
        row.kind === "hunk" ? (
          <div key={index} className="select-none bg-muted/60 px-3 py-0.5 text-faint-foreground">
            {row.header}
          </div>
        ) : (
          <div key={index} className="grid grid-cols-2">
            <SplitCell line={row.left} side="old" html={row.left ? highlighted.get(row.left) : undefined} />
            <SplitCell line={row.right} side="new" html={row.right ? highlighted.get(row.right) : undefined} />
          </div>
        ),
      )}
    </div>
  );
}

function SplitCell({
  line,
  side,
  html,
}: {
  line: LocalGitDiffLine | null;
  side: "old" | "new";
  html: string | undefined;
}) {
  const changed = line && line.kind !== "context";
  return (
    <div
      className={cn(
        "flex min-w-0",
        side === "new" && "border-l",
        !line && "bg-muted/30",
        changed && side === "old" && "bg-destructive/10",
        changed && side === "new" && "bg-success/10",
      )}
    >
      <span aria-hidden className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-faint-foreground">
        {line ? (side === "old" ? line.old_line : line.new_line) ?? "" : ""}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-3">
        {!line ? null : html === undefined ? (
          line.text
        ) : (
          // lowlight output only: text is escaped by the hast serializer and
          // the sole elements are its own `hljs-*` spans.
          <span className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </span>
    </div>
  );
}
