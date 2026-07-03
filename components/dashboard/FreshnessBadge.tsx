"use client";

import { useEffect, useState } from "react";

// Shows how long ago the TEEP delta sync last ran. Turns amber/red if the
// BI-server cron appears to have stopped, so stale data never goes unnoticed.
export default function FreshnessBadge() {
  const [ageHours, setAgeHours] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/teep/freshness")
      .then(r => r.json())
      .then(j => { if (!cancelled) setAgeHours(j?.ageHours ?? null); })
      .catch(() => { if (!cancelled) setAgeHours(null); });
    return () => { cancelled = true; };
  }, []);

  if (ageHours === undefined) return null; // still loading — stay quiet

  let label: string;
  let cls: string;
  if (ageHours == null) {
    label = "Sync status unknown";
    cls = "border-muted-foreground/30 text-muted-foreground";
  } else {
    const h = ageHours;
    const rel = h < 1 ? "just now" : h < 24 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`;
    label = `Synced ${rel}`;
    // 6h cron + margin: green <12h, amber <36h, red beyond (cron likely down)
    cls = h < 12 ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
        : h < 36 ? "border-amber-500/40 text-amber-600 dark:text-amber-400"
        :          "border-red-500/50 text-red-600 dark:text-red-400";
  }

  return (
    <span
      title="When the TEEP data was last synced from Intercom"
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${cls}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
