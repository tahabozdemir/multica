"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "@multica/ui/icons";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import { cn } from "@multica/ui/lib/utils";
import type { LocalGitDiffFile, LocalGitDiffLine } from "../../platform/local-git";
import { highlightToLines, languageForPath } from "../task-transcript/diff-highlight";
import { useT } from "../../i18n";
import "../../editor/styles/code.css";

/**
 * Highlights each side of a file as one block, so a construct that spans lines
 * keeps its grammar, then maps every line back. Context and added lines read
 * from the new side, removed lines from the old one. Lines a grammar could not
 * handle are absent and render as plain text.
 */
export function highlightDiffFile(file: LocalGitDiffFile): Map<LocalGitDiffLine, string> {
  const highlighted = new Map<LocalGitDiffLine, string>();
  const language = languageForPath(file.path);
  if (!language) return highlighted;

  const oldSide: LocalGitDiffLine[] = [];
  const newSide: LocalGitDiffLine[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "add") oldSide.push(line);
      if (line.kind !== "remove") newSide.push(line);
    }
  }
  const oldHtml = oldSide.length > 0 ? highlightToLines(oldSide.map((l) => l.text).join("\n"), language) : [];
  const newHtml = newSide.length > 0 ? highlightToLines(newSide.map((l) => l.text).join("\n"), language) : [];
  newSide.forEach((line, index) => {
    const html = newHtml?.[index];
    if (html !== undefined) highlighted.set(line, html);
  });
  oldSide.forEach((line, index) => {
    const html = oldHtml?.[index];
    if (line.kind === "remove" && html !== undefined) highlighted.set(line, html);
  });
  return highlighted;
}

export function DiffFileSection({
  file,
  defaultOpen,
}: {
  file: LocalGitDiffFile;
  defaultOpen: boolean;
}) {
  const { t } = useT("projects");
  const [open, setOpen] = useState(defaultOpen);
  const expandable = file.hunks.length > 0;

  return (
    <Collapsible open={open && expandable} onOpenChange={setOpen} className="rounded-md border">
      <CollapsibleTrigger
        disabled={!expandable}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-caption transition-colors hover:bg-accent/30 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            open && expandable && "rotate-90",
            !expandable && "invisible",
          )}
        />
        <span className="shrink-0 text-micro text-muted-foreground">
          {t(($) => $.local_changes.status[file.status])}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
          {file.old_path ? `${file.old_path} → ${file.path}` : file.path}
        </span>
        {file.binary ? (
          <span className="shrink-0 text-micro text-muted-foreground">
            {t(($) => $.local_changes.binary)}
          </span>
        ) : (
          <span className="shrink-0 font-mono text-micro tabular-nums">
            {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
            {file.additions > 0 && file.deletions > 0 && " "}
            {file.deletions > 0 && <span className="text-destructive">−{file.deletions}</span>}
          </span>
        )}
      </CollapsibleTrigger>
      {expandable && (
        <CollapsibleContent>
          <DiffFileBody file={file} />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

function DiffFileBody({ file }: { file: LocalGitDiffFile }) {
  const { t } = useT("projects");
  // Mounted only while the section is open, so closed files cost nothing.
  const highlighted = useMemo(() => highlightDiffFile(file), [file]);

  return (
    <div className="border-t">
      <pre className="transcript-code overflow-x-auto py-1 font-mono text-micro">
        {file.hunks.map((hunk, hunkIndex) => (
          <div key={hunkIndex}>
            <div className="select-none bg-muted/60 px-3 py-0.5 text-faint-foreground">
              {hunk.header}
            </div>
            {hunk.lines.map((line, lineIndex) => (
              <DiffRow key={lineIndex} line={line} html={highlighted.get(line)} />
            ))}
          </div>
        ))}
      </pre>
      {file.truncated && (
        <p className="border-t px-3 py-1.5 text-micro text-muted-foreground">
          {t(($) => $.local_changes.file_truncated)}
        </p>
      )}
    </div>
  );
}

function DiffRow({ line, html }: { line: LocalGitDiffLine; html: string | undefined }) {
  return (
    <div
      className={cn(
        "flex",
        line.kind === "add" && "bg-success/10",
        line.kind === "remove" && "bg-destructive/10",
      )}
    >
      <span aria-hidden className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-faint-foreground">
        {line.old_line ?? ""}
      </span>
      <span aria-hidden className="w-12 shrink-0 select-none pr-2 text-right tabular-nums text-faint-foreground">
        {line.new_line ?? ""}
      </span>
      <span
        aria-hidden
        className={cn(
          "w-4 shrink-0 select-none",
          line.kind === "add" && "text-success",
          line.kind === "remove" && "text-destructive",
        )}
      >
        {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pr-3">
        {html === undefined ? (
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
