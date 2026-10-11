import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TimelineItem {
  id: string;
  /** When it happened (already formatted). */
  at: string;
  title: ReactNode;
  /** Who did it. */
  by?: ReactNode;
  detail?: ReactNode;
  /** Tints the marker: success / warning / destructive. */
  tone?: "success" | "warning" | "destructive";
}

const TONE: Record<NonNullable<TimelineItem["tone"]>, string> = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" };

/** A vertical history: marker, title, who/when, free detail. Used for état history, request events and audit trails. */
export function Timeline({ items, empty = "Aucun historique" }: { items: TimelineItem[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="relative ml-2 space-y-4 border-l pl-5">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span aria-hidden className={cn("absolute -left-[26px] top-1.5 size-2.5 rounded-full ring-4 ring-background", it.tone ? TONE[it.tone] : "bg-muted-foreground/50")} />
          <div className="text-sm font-medium">{it.title}</div>
          <div className="text-xs text-muted-foreground">{it.at}{it.by ? <> · {it.by}</> : null}</div>
          {it.detail && <div className="mt-1 text-sm text-foreground/80">{it.detail}</div>}
        </li>
      ))}
    </ol>
  );
}
