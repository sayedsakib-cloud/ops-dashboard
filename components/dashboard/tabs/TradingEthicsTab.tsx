"use client";
import { useEffect, useState, useRef } from "react";
import { Loader2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// ── Types ──────────────────────────────────────────────────────────────────
type AgentRow = {
  name: string;
  assigned: number; repliedTo: number; closed: number;
  avgFrtFmt: string; avgHandlingFmt: string; avgAtfFmt: string;
  repliedPerHour: string; closedPerHour: string;
  slaMet: number; slaTotal: number; slaRate: number;
};
type TeepData = {
  summary: {
    totalClosed: number;
    avgFrtFmt: string;
    avgHandlingFmt: string;
    slaRate: number;
    slaMetCount: number;
    slaTotalCount: number;
    top3: { name: string; closed: number }[];
  };
  periodDays: number;
  summaryRow: AgentRow;
  agents: AgentRow[];
};

// ── Cache (sessionStorage, survives refresh; clears when the tab closes) ────
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
function cacheKey(from: string, to: string) { return `teep:v1:${from}:${to}`; }
function getCached(key: string): TeepData | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data as TeepData;
  } catch { return null; }
}
function setCached(key: string, data: TeepData) {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────
const PALETTE = [
  "bg-indigo-500","bg-purple-500","bg-pink-500","bg-blue-500",
  "bg-teal-500","bg-emerald-500","bg-orange-500","bg-rose-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function AgentAvatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const cls = size === "xs" ? "h-6 w-6 text-xs" : "h-7 w-7 text-sm";
  return (
    <Avatar className={cls}>
      <AvatarFallback className={cn("font-bold text-white", avatarColor(name))}>{name.charAt(0).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
function slaText(rate: number) {
  return rate >= 80 ? "text-emerald-600 dark:text-emerald-400"
       : rate >= 60 ? "text-amber-600 dark:text-amber-400"
       : "text-red-600 dark:text-red-400";
}
function slaBarColor(rate: number) {
  return rate >= 80 ? "bg-emerald-500" : rate >= 60 ? "bg-amber-500" : "bg-red-500";
}

// Info tooltip (native title)
function Tip({ text }: { text: string }) {
  return (
    <span title={text}
      className="ml-1 inline-flex h-4 w-4 flex-shrink-0 cursor-help items-center justify-center rounded-full bg-blue-500 align-middle text-xs font-bold text-white transition-colors hover:bg-blue-600">
      i
    </span>
  );
}

function SummaryCard({ label, tip, value, valueColor, sub, children }: {
  label: string; tip?: string; value?: string | number;
  valueColor?: string; sub?: string; children?: React.ReactNode;
}) {
  return (
    <Card className="gap-0 p-4">
      <div className="mb-2 flex items-center gap-0.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
        {tip ? <Tip text={tip} /> : null}
      </div>
      {value !== undefined ? <p className={cn("text-2xl font-bold", valueColor ?? "text-foreground")}>{value}</p> : null}
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      {children}
    </Card>
  );
}

function SlaBar({ rate }: { rate: number }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-1.5 rounded-full", slaBarColor(rate))} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={cn("text-xs font-bold", slaText(rate))}>{rate}%</span>
    </div>
  );
}

type ColSpec = { label: string; tip?: string };
function HeadRow({ cols }: { cols: Array<string | ColSpec> }) {
  return (
    <TableRow>
      {cols.map(col => {
        const lbl = typeof col === "string" ? col : col.label;
        const tip = typeof col === "string" ? undefined : col.tip;
        return (
          <TableHead key={lbl} className="whitespace-nowrap">
            {tip ? <span className="inline-flex items-center gap-1">{lbl}<Tip text={tip} /></span> : lbl}
          </TableHead>
        );
      })}
    </TableRow>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function TradingEthicsTab() {
  const [data,    setData]    = useState<TeepData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [notice,  setNotice]  = useState<string | null>(null);
  const [from,    setFrom]    = useState("");
  const [to,      setTo]      = useState("");
  const [autoFill, setAutoFill] = useState(true); // auto-reload through missing days
  const autoRef = useRef(autoFill);
  autoRef.current = autoFill;
  // Track the active range so auto-reload refetches the same window.
  const activeRange = useRef<{ start: string; end: string }>({ start: "", end: "" });
  // Cap consecutive auto-retries on errors so a persistent failure can't loop forever.
  const errorRetries = useRef(0);
  // Mirror of `data` for use inside async closures (state is stale there).
  const dataRef = useRef<TeepData | null>(null);

  async function load(start?: string, end?: string) {
    const s = start ?? "";
    const e = end ?? "";
    activeRange.current = { start: s, end: e };
    const key = cacheKey(s, e);
    const hit = getCached(key);
    if (hit) { setData(hit); setError(null); setNotice(null); setLoading(false); return; }

    setLoading(true); setError(null); setNotice(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set("startDate", start);
      if (end)   p.set("endDate",   end);
      const res  = await fetch("/api/teep" + (p.toString() ? "?" + p.toString() : ""));

      // Read as text first so a non-JSON response (e.g. a timeout error page)
      // doesn't crash JSON.parse with "Unexpected token".
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { json = null; }

      if (!res.ok || !json) {
        const msg = json?.error
          || (res.status === 504 || res.status === 500
                ? "The server is still computing this range. It will continue automatically -- please wait."
                : `Request failed (${res.status}).`);
        throw new Error(msg);
      }

      setData(json);
      dataRef.current = json;
      // Only cache COMPLETE results -- caching a partial would make reloads
      // return the partial from sessionStorage and never progress.
      if (!json.partial) {
        setCached(key, json);
        setNotice(null);
        errorRetries.current = 0;
      } else {
        errorRetries.current = 0; // making progress, not erroring
        // If the server reports the cache isn't persisting, retrying can never
        // finish a wide range -- stop and show the fix instead of looping.
        if (json.cacheHealthy === false) {
          setNotice(
            "The Supabase cache isn't saving results, so wide ranges can't finish. " +
            "Check that SUPABASE_SERVICE_ROLE_KEY is set in Vercel and that teep_tables.sql has been run. " +
            "(Single days still work.)"
          );
          return; // do not auto-reload into an endless loop
        }
        setNotice(
          `Building this range: ${json.ready ?? 0} of ${json.total ?? "?"} days computed` +
          (autoRef.current
            ? " -- continuing automatically..."
            : " -- click Reload to compute more.")
        );
        // Auto-reload: if enabled and still on the same range, refetch shortly.
        if (autoRef.current) {
          setTimeout(() => {
            if (activeRange.current.start === s && activeRange.current.end === e) {
              load(start, end);
            }
          }, 1500);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      // If we already have (partial) data on screen, a failed request just means
      // one heavy day didn't finish this attempt. Show a soft notice, not a red
      // error, and keep retrying -- heavy days get faster on retry because each
      // conversation's parts fetch is cached server-side for 5 min.
      const haveData = Boolean(dataRef.current);
      if (haveData) {
        setNotice(
          `A heavy day is still computing (it speeds up on retry). ` +
          (autoRef.current ? "Continuing automatically..." : "Click Reload to retry.")
        );
        setError(null);
      } else {
        setError(msg);
      }
      // Auto-retry with a higher cap (heavy days may need several warm-up passes).
      if (autoRef.current && errorRetries.current < 30) {
        errorRetries.current += 1;
        setTimeout(() => {
          if (activeRange.current.start === s && activeRange.current.end === e) {
            load(start, end);
          }
        }, 4000);
      } else if (autoRef.current) {
        // Gave up auto-retrying -- leave a clear manual path.
        setNotice(
          `Stopped after several attempts. Some heavy days may need a manual Reload. ` +
          `Current total reflects the days computed so far.`
        );
      }
    }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const s = data?.summary;

  const TIP_CLOSED     = "Based on admin_assignee_id and teammates at close time. Conversations closed without formal assignment may not be fully captured - typically around 10% below Intercom's Closed by teammates metric due to public API limitations.";
  const TIP_FRT        = "Time from conversation creation to first human agent reply (time_to_admin_reply). Attributed to the primary handler only.";
  const TIP_HANDLING   = "time_to_first_close minus time_to_admin_reply (first reply to close). Intercom measures from agent assignment to close using parts-level data not available via the public API.";
  const TIP_REPLIED_HR = "Conversations replied to divided by number of working days (Mon-Fri) in the period. NOT the same as Intercom's Conv. Replied / Active Hr which uses actual logged-in status time.";
  const TIP_CLOSED_HR  = "Conversations closed divided by number of working days (Mon-Fri) in the period. NOT the same as Intercom's Conv. Closed / Active Hr which uses actual logged-in status time.";

  return (
    <div className="space-y-5">
      {/* Header */}
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">Trading Ethics Email Performance</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Channel: Email - Team: All CR inboxes - Timezone: GMT+6</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-auto" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-auto" />
          </div>
          <Button onClick={() => load(from, to)} disabled={loading}>
            {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading</> : "Apply"}
          </Button>
          <Button variant="secondary" onClick={() => { setFrom(""); setTo(""); load(); }} disabled={loading}>Reset</Button>
          <Button
            variant="outline"
            onClick={() => load(activeRange.current.start, activeRange.current.end)}
            disabled={loading}
            title="Compute more days for the current range"
          >
            Reload
          </Button>
          <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
            <input
              type="checkbox"
              checked={autoFill}
              onChange={e => setAutoFill(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Auto-fill days
          </label>
        </div>
      </Card>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Fetching email conversations from Intercom...</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
          {notice}
        </div>
      ) : null}

      {!loading && s ? (
        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryCard label="Emails Closed" tip={TIP_CLOSED}
              value={s.totalClosed.toLocaleString()}
              sub={"Last " + data!.periodDays + (data!.periodDays > 1 ? " days" : " day")} />
            <SummaryCard label="Avg First Response Time" tip={TIP_FRT}
              value={s.avgFrtFmt} sub="Avg time to first human reply" />
            <SummaryCard label="Top 3 Agents by Closed">
              <div className="mt-1 space-y-1.5">
                {s.top3.map((ag, i) => (
                  <div key={ag.name} className="flex items-center gap-2">
                    <span className="w-4 text-xs font-bold text-muted-foreground">{i + 1}.</span>
                    <AgentAvatar name={ag.name} size="xs" />
                    <span className="flex-1 truncate text-xs font-medium">{ag.name}</span>
                    <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{ag.closed}</span>
                  </div>
                ))}
              </div>
            </SummaryCard>
            <SummaryCard label="SLA Compliance (24H)">
              <p className={cn("text-2xl font-bold", slaText(s.slaRate))}>{s.slaRate}%</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{s.slaMetCount} met / {s.slaTotalCount} total</p>
              <SlaBar rate={s.slaRate} />
            </SummaryCard>
          </div>

          {/* Disclaimer banner — collapsible */}
          <details className="group rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <summary className="flex cursor-pointer list-none select-none items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300 [&::-webkit-details-marker]:hidden">
              <span className="flex-shrink-0 text-lg text-amber-500">!</span>
              Why don&apos;t these numbers match the Intercom report?
              <ChevronRight className="ml-auto h-4 w-4 text-amber-500 transition-transform group-open:rotate-90" />
            </summary>
            <div className="mt-3 space-y-2 pl-7 text-xs leading-relaxed text-amber-700 dark:text-amber-300/90">
              <p><strong>Why is Emails Closed lower than the Intercom report?</strong> Our count uses the current conversation owner to assign credit. About 7-10% of closures are missed because some agents close conversations without formally claiming them. Intercom tracks every close action at a deeper level not accessible via the public API.</p>
              <p><strong>Replied / Day and Closed / Day</strong> show how many conversations each agent handled per working day on average. Intercom divides by actual Active-status hours - a much smaller number. These are different metrics and will not match.</p>
            </div>
          </details>

          {/* Table 1 — Conversation Volume */}
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">Conversation Volume</CardTitle>
              <CardDescription className="text-xs">Assignment and reply activity per teammate</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <HeadRow cols={[
                    "Teammate",
                    "Conversations Assigned",
                    "Conversations Replied To",
                    { label: "Closed Conversations", tip: TIP_CLOSED },
                  ]} />
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                    <TableCell>Summary</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.assigned.toLocaleString()}</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.repliedTo.toLocaleString()}</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.closed.toLocaleString()}</TableCell>
                  </TableRow>
                  {data!.agents.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AgentAvatar name={row.name} />
                          <span className="text-sm font-medium">{row.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center font-medium text-muted-foreground">{row.assigned}</TableCell>
                      <TableCell className="text-center font-medium text-muted-foreground">{row.repliedTo}</TableCell>
                      <TableCell className="text-center font-bold">{row.closed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Table 2 — Timing and Efficiency */}
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">Timing and Efficiency</CardTitle>
              <CardDescription className="text-xs">Hover the blue i icons on column headers to understand accuracy limitations vs Intercom</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <HeadRow cols={[
                    "Teammate",
                    { label: "Avg First Response Time", tip: TIP_FRT },
                    { label: "Avg Handling Time",       tip: TIP_HANDLING },
                    { label: "Replied / Day (avg)",     tip: TIP_REPLIED_HR },
                    { label: "Closed / Day (avg)",      tip: TIP_CLOSED_HR },
                  ]} />
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                    <TableCell>Summary</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.avgFrtFmt}</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.avgHandlingFmt}</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.repliedPerHour}</TableCell>
                    <TableCell className="text-center">{data!.summaryRow.closedPerHour}</TableCell>
                  </TableRow>
                  {data!.agents.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <AgentAvatar name={row.name} />
                          <div>
                            <div className="text-sm font-medium">{row.name}</div>
                            <div className="mt-0.5 flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">SLA</span>
                              <span className={cn("text-xs font-semibold", slaText(row.slaRate))}>
                                {row.slaTotal > 0 ? row.slaRate + "%" : "--"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">{row.avgFrtFmt}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{row.avgHandlingFmt}</TableCell>
                      <TableCell className="text-center font-medium">{row.repliedPerHour}</TableCell>
                      <TableCell className="text-center font-medium">{row.closedPerHour}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
