"use client";

import { forwardRef, useMemo } from "react";
import { ChevronRight, ExternalLink, Maximize2, Minimize2 } from "@multica/ui/icons";
import { IconButton } from "@multica/ui/components/common/icon-button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@multica/ui/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { cn } from "@multica/ui/lib/utils";
import type { DiffLayout } from "@multica/core/local-changes/review-store";
import type { LocalGitDiffFile, LocalGitDiffLine, LocalGitEditor } from "../../platform/local-git";
import { highlightToLines, languageForPath } from "../task-transcript/diff-highlight";
import { useT } from "../../i18n";
import { SplitDiffBody } from "./split-diff";
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

/** The first changed line on the new side, where an editor should open. */
export function firstChangedLine(file: LocalGitDiffFile): number | undefined {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind !== "context" && line.new_line !== undefined) return line.new_line;
      if (line.kind === "remove" && line.old_line !== undefined) return Math.max(1, line.old_line);
    }
  }
  return undefined;
}

export interface FullFileControl {
  shown: boolean;
  loading: boolean;
  toggle: () => void;
}

export interface DiffFileSectionProps {
  file: LocalGitDiffFile;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The file the keyboard is on. */
  active: boolean;
  viewed: boolean;
  onViewedChange: (viewed: boolean) => void;
  layout: DiffLayout;
  /** Offer the whole file as context; null where it cannot be read. */
  fullFile: FullFileControl | null;
  /** Apps the file can be opened in; empty when it is not on disk. */
  editors: LocalGitEditor[];
  onOpenIn: (app: LocalGitEditor, line?: number) => void;
}

export const DiffFileSection = forwardRef<HTMLDivElement, DiffFileSectionProps>(function DiffFileSection(
  { file, open, onOpenChange, active, viewed, onViewedChange, layout, fullFile, editors, onOpenIn },
  ref,
) {
  const { t } = useT("projects");
  const expandable = file.hunks.length > 0;

  return (
    <Collapsible
      ref={ref}
      open={open && expandable}
      onOpenChange={onOpenChange}
      className={cn("scroll-mt-2 rounded-md border", active && "border-ring")}
    >
      <div className="flex min-w-0 items-center gap-1 pr-2">
        <CollapsibleTrigger
          disabled={!expandable}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-caption transition-colors hover:bg-accent/30 disabled:cursor-default disabled:hover:bg-transparent"
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
          <span className={cn("min-w-0 flex-1 truncate font-mono", viewed && "text-muted-foreground")} title={file.path}>
            {file.old_path ? `${file.old_path} → ${file.path}` : file.path}
          </span>
          {file.binary ? (
            <span className="shrink-0 text-micro text-muted-foreground">{t(($) => $.local_changes.binary)}</span>
          ) : (
            <span className="shrink-0 font-mono text-micro tabular-nums">
              {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
              {file.additions > 0 && file.deletions > 0 && " "}
              {file.deletions > 0 && <span className="text-destructive">−{file.deletions}</span>}
            </span>
          )}
        </CollapsibleTrigger>
        {fullFile && expandable && (
          <IconButton
            size="icon-xs"
            variant="ghost"
            label={fullFile.shown ? t(($) => $.local_changes.show_changes_only) : t(($) => $.local_changes.show_full_file)}
            aria-pressed={fullFile.shown}
            aria-busy={fullFile.loading}
            disabled={fullFile.loading}
            onClick={fullFile.toggle}
          >
            {fullFile.shown ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </IconButton>
        )}
        {editors.length > 0 && <OpenInMenu editors={editors} onOpenIn={(app) => onOpenIn(app, firstChangedLine(file))} />}
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pl-1 text-micro text-muted-foreground">
          <Checkbox
            className="size-3.5 [&_svg]:size-3"
            checked={viewed}
            onCheckedChange={(checked) => onViewedChange(Boolean(checked))}
          />
          {t(($) => $.local_changes.viewed)}
        </label>
      </div>
      {expandable && (
        <CollapsibleContent>
          <DiffFileBody file={file} layout={layout} />
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

function OpenInMenu({
  editors,
  onOpenIn,
}: {
  editors: LocalGitEditor[];
  onOpenIn: (app: LocalGitEditor) => void;
}) {
  const { t } = useT("projects");
  const label = (app: LocalGitEditor) =>
    app === "xcode"
      ? t(($) => $.local_changes.open_xcode)
      : app === "vscode"
        ? t(($) => $.local_changes.open_vscode)
        : t(($) => $.local_changes.open_finder);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton size="icon-xs" variant="ghost" label={t(($) => $.local_changes.open_in)}>
            <ExternalLink className="size-3.5" />
          </IconButton>
        }
      />
      <DropdownMenuContent align="end">
        {editors.map((app) => (
          <DropdownMenuItem key={app} onClick={() => onOpenIn(app)}>
            {label(app)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DiffFileBody({ file, layout }: { file: LocalGitDiffFile; layout: DiffLayout }) {
  const { t } = useT("projects");
  // Mounted only while the section is open, so closed files cost nothing.
  const highlighted = useMemo(() => highlightDiffFile(file), [file]);

  return (
    <div className="border-t">
      {layout === "split" ? (
        <SplitDiffBody file={file} highlighted={highlighted} />
      ) : (
        <pre className="transcript-code overflow-x-auto py-1 font-mono text-micro">
          {file.hunks.map((hunk, hunkIndex) => (
            <div key={hunkIndex}>
              <div className="select-none bg-muted/60 px-3 py-0.5 text-faint-foreground">{hunk.header}</div>
              {hunk.lines.map((line, lineIndex) => (
                <DiffRow key={lineIndex} line={line} html={highlighted.get(line)} />
              ))}
            </div>
          ))}
        </pre>
      )}
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
    <div className={cn("flex", line.kind === "add" && "bg-success/10", line.kind === "remove" && "bg-destructive/10")}>
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
