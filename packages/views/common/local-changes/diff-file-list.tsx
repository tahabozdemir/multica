"use client";

import { CircleCheck } from "@multica/ui/icons";
import { cn } from "@multica/ui/lib/utils";
import type { LocalGitDiffFile } from "../../platform/local-git";
import { useT } from "../../i18n";

/** The changed files as a navigable list: status, name, size and viewed state. */
export function DiffFileList({
  files,
  activeIndex,
  viewed,
  onSelect,
}: {
  files: LocalGitDiffFile[];
  activeIndex: number;
  viewed: boolean[];
  onSelect: (index: number) => void;
}) {
  const { t } = useT("projects");
  const viewedCount = viewed.filter(Boolean).length;

  return (
    <nav aria-label={t(($) => $.local_changes.files_label)} className="flex min-h-0 flex-col">
      <p className="px-3 pt-3 pb-1.5 text-micro text-muted-foreground tabular-nums">
        {t(($) => $.local_changes.viewed_progress, { viewed: viewedCount, total: files.length })}
      </p>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {files.map((file, index) => {
          const name = file.path.split("/").pop() ?? file.path;
          const dir = file.path.slice(0, file.path.length - name.length);
          return (
            <li key={`${file.status}:${file.path}`}>
              <button
                type="button"
                aria-current={index === activeIndex ? "true" : undefined}
                onClick={() => onSelect(index)}
                title={file.path}
                className={cn(
                  "flex w-full min-w-0 items-center gap-1.5 rounded-xs px-1.5 py-1 text-left text-caption transition-colors hover:bg-accent/40",
                  index === activeIndex && "bg-accent hover:bg-accent",
                )}
              >
                <CircleCheck
                  aria-hidden
                  className={cn("size-3 shrink-0", viewed[index] ? "text-success" : "text-transparent")}
                />
                <span className={cn("min-w-0 flex-1 truncate", viewed[index] && "text-muted-foreground")}>
                  <span className="font-mono">{name}</span>
                  {dir && <span className="ml-1 text-micro text-faint-foreground">{dir}</span>}
                </span>
                {!file.binary && (
                  <span className="shrink-0 font-mono text-micro tabular-nums">
                    {file.additions > 0 && <span className="text-success">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="ml-1 text-destructive">−{file.deletions}</span>}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
