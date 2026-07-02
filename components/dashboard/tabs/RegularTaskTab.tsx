"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type FeedMessage = {
  id: string;
  content: string;
  date: number;
  authorName: string;
  authorAvatar: string | null;
  authorInitials: string;
  authorColor: string | null;
};

const TAB_TRIGGER_CLS =
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm";

// ---- safe markdown -> html: escape everything, then a controlled subset ----
const LINK_CLS = "text-sky-600 underline decoration-sky-400/50 underline-offset-2 dark:text-sky-400";

function inlineMd(raw: string): string {
  let s = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/`([^`]+)`/g, '<code class="rounded bg-black/10 px-1 py-0.5 text-[0.85em] dark:bg-white/10">$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    `<a href="$2" target="_blank" rel="noopener noreferrer" class="${LINK_CLS}">$1</a>`);
  s = s.replace(/(^|[\s])(https?:\/\/[^\s<]+)/g,
    `$1<a href="$2" target="_blank" rel="noopener noreferrer" class="${LINK_CLS}">$2</a>`);
  return s;
}

function renderContent(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inList = false;
  let pendingGap = false; // a blank line was seen; add top margin to the next block
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const gap = () => (pendingGap ? " mt-2" : "");

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const t = line.trim();

    if (!t) { closeList(); pendingGap = true; continue; }
    if (/^\*{1,2}$/.test(t)) { continue; }                 // orphan * / ** markers
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(t)) {                 // horizontal rule
      closeList(); out.push('<hr class="my-3 border-black/10 dark:border-white/15"/>'); pendingGap = false; continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);                  // headings
    if (h) {
      closeList();
      const lvl = h[1].length;
      const cls = lvl <= 1 ? "text-lg font-bold" : lvl === 2 ? "text-base font-bold" : "text-sm font-semibold";
      out.push(`<p class="${cls}${gap()} mb-1">${inlineMd(h[2])}</p>`); pendingGap = false; continue;
    }
    const b = /^[-*]\s+(.*)$/.exec(t);                      // bullet items
    if (b) {
      if (!inList) { out.push(`<ul class="${gap()} space-y-1 pl-1">`); inList = true; }
      out.push(`<li class="flex gap-2"><span class="mt-0.5 opacity-50">\u2022</span><span>${inlineMd(b[1])}</span></li>`);
      pendingGap = false; continue;
    }
    closeList();                                            // paragraph
    out.push(`<p class="${gap()}">${inlineMd(t)}</p>`); pendingGap = false;
  }
  closeList();
  return out.join("");
}

function dayLabel(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function Avatar({ m }: { m: FeedMessage }) {
  const bg = m.authorColor ?? "#64748b";
  if (m.authorAvatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={m.authorAvatar} alt={m.authorName} className="h-9 w-9 rounded-full object-cover ring-2 ring-white/40" />;
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-white/40"
         style={{ background: bg }}>
      {m.authorInitials}
    </div>
  );
}

function OpsProcessFeed() {
  const [messages, setMessages] = useState<FeedMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch("/api/regular-task/clickup-feed");
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? "Failed to load");
        if (!cancelled) setMessages(j.messages ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Could not load updates.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const groups: { label: string; items: FeedMessage[] }[] = [];
  for (const m of messages ?? []) {
    const label = dayLabel(m.date);
    const g = groups.find(x => x.label === label);
    if (g) g.items.push(m);
    else groups.push({ label, items: [m] });
  }

  return (
    <div className="relative overflow-hidden rounded-2xl p-4 sm:p-6">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-sky-200/40 via-fuchsia-200/30 to-emerald-200/30 dark:from-sky-500/10 dark:via-fuchsia-500/10 dark:to-emerald-500/10" />

      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">OPS &mdash; Process Update</h2>
          <p className="text-xs text-muted-foreground">Latest updates from the ClickUp channel &middot; refreshed daily</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 w-full animate-pulse rounded-xl bg-white/40 dark:bg-white/5" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (messages && messages.length === 0) ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No updates yet.</p>
      ) : (
        <div className="space-y-6">
          {groups.map(group => (
            <div key={group.label} className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-white/40 bg-white/50 px-3 py-1 text-xs font-semibold text-foreground/80 backdrop-blur-md dark:border-white/10 dark:bg-white/10">
                  {group.label}
                </span>
                <div className="h-px flex-1 bg-gradient-to-r from-white/50 to-transparent dark:from-white/10" />
              </div>

              {group.items.map(m => (
                <div key={m.id}
                     className="rounded-2xl border border-white/40 bg-white/50 p-4 shadow-lg backdrop-blur-md transition-shadow hover:shadow-xl dark:border-white/10 dark:bg-white/[0.06]">
                  <div className="mb-2 flex items-center gap-3">
                    <Avatar m={m} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{m.authorName}</p>
                      <p className="text-xs text-muted-foreground">{timeLabel(m.date)}</p>
                    </div>
                  </div>
                  <div
                    className="space-y-1 break-words text-sm leading-relaxed text-foreground/90 [&_a]:break-all"
                    dangerouslySetInnerHTML={{ __html: renderContent(m.content) }}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RegularTaskTab() {
  return (
    <Tabs defaultValue="process" className="space-y-4">
      <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
        <TabsTrigger value="process" className={TAB_TRIGGER_CLS}>Process Updates</TabsTrigger>
        <TabsTrigger value="reports" className={TAB_TRIGGER_CLS}>Task Reports</TabsTrigger>
      </TabsList>

      <TabsContent value="process" className="mt-4 focus-visible:outline-none">
        <OpsProcessFeed />
      </TabsContent>

      <TabsContent value="reports" className="mt-4 focus-visible:outline-none">
        <div className="rounded-lg border bg-card p-10 text-center">
          <div className="mb-3 text-4xl">&#9989;</div>
          <h2 className="text-lg font-semibold text-foreground">Task Reports</h2>
          <p className="mt-1 text-sm text-muted-foreground">Coming soon &mdash; Regular Task Report &middot; Hireflix Count</p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
