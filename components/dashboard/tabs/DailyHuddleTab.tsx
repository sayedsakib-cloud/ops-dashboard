"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList,
  CartesianGrid, Legend,
} from "recharts";
import { ArrowRight, Loader2, Calendar as CalIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// ---------- Types --------------------------------------------------------------

type Fmt = "number" | "hrs" | "currency";
type Metric = { label: string; value: number | null; change: number | null; format: Fmt };

type HuddleData = {
  date: string;
  prevDate: string | null;
  rangeStart: string;
  rangeEnd: string;
  rangeDays: number;
  availableDates: string[];
  bizops: Metric[];
  bizopsEligible: { fnProcessed: Metric; eligibleKYC: Metric; eligiblePayout: Metric };
  cr: Metric[];
  crSavings: Metric;
};

type Feedback = { date: string; communityChaos: string; trustpilot: string };

type AlignRow = { date: string; achievement: string; focus: string };
type AlignmentPayload = {
  bdBizOps: AlignRow[];
  bdCR: AlignRow[];
  slBizOps: AlignRow[];
  slCR: AlignRow[];
};

type SeriesMeta = { key: string; name: string };
type DayRow = { date: string; [k: string]: number | string };
type BdSlChart = { series: SeriesMeta[]; rows: DayRow[] };
type BdSlPayload = {
  dateLabel: string;
  charts: {
    kyc: BdSlChart;
    payout: BdSlChart;
    intercom: BdSlChart;
    clickup: BdSlChart;
    instantKyc: BdSlChart;
    crEmail: BdSlChart;
  };
};

type DailyPoint = { date: string; value: number };
type WeeklyPayload = {
  window: { from: string; to: string; fromLabel: string; toLabel: string };
  bizops: { totalPayoutCount: DailyPoint[]; totalKycChecked: DailyPoint[]; intercomSolved: DailyPoint[] };
  cr: { outboundEmail: DailyPoint[]; conversationClosed: DailyPoint[]; savingsAmount: DailyPoint[] };
};

// ---------- Formatting helpers -------------------------------------------------

const fmtNumber = (n: number) => n.toLocaleString();
const fmtCurrencyShort = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
};

function fmtMetric(m: Metric): string {
  if (m.value === null) return "--";
  if (m.format === "currency")
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", minimumFractionDigits: 2,
    }).format(m.value);
  if (m.format === "hrs") return `${m.value} hrs`;
  return new Intl.NumberFormat("en-US").format(m.value);
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function fmtIsoDate(iso: string) {
  // iso is "YYYY-MM-DD"
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ---------- Top-level component ------------------------------------------------

// Shared date range across all sub-tabs. Empty strings mean "use each section's default".
export type DateRange = { from: string; to: string };

const TAB_TRIGGER_CLS =
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm";

export default function DailyHuddleTab() {
  // The single source of truth for the date range, owned here so it survives tab switches.
  // `applied` is what the sections actually fetch with; the draft lives in the filter bar.
  const [huddleRange, setHuddleRange] = useState<DateRange>({ from: "", to: "" });
  const [weeklyRange, setWeeklyRange] = useState<DateRange>({ from: "", to: "" });
  const [alignRange, setAlignRange]   = useState<DateRange>({ from: "", to: "" });
  const [bdslRange, setBdslRange]     = useState<DateRange>({ from: "", to: "" });
  // Bounds (min/max selectable dates) discovered from the huddle route once it loads.
  const [bounds, setBounds] = useState<{ min?: string; max?: string }>({});

  return (
    <Tabs defaultValue="huddle" className="space-y-4">
      <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
        <TabsTrigger value="huddle" className={TAB_TRIGGER_CLS}>Huddle Metrics</TabsTrigger>
        <TabsTrigger value="alignment" className={TAB_TRIGGER_CLS}>Alignment Huddle</TabsTrigger>
        <TabsTrigger value="bdsl" className={TAB_TRIGGER_CLS}>BD-SL Contribution</TabsTrigger>
        <TabsTrigger value="weekly" className={TAB_TRIGGER_CLS}>Weekly Trend</TabsTrigger>
      </TabsList>

      <TabsContent value="huddle" className="mt-4 space-y-4 focus-visible:outline-none">
        <div className="flex justify-end">
          <SharedDateFilter applied={huddleRange} onApply={setHuddleRange} bounds={bounds} />
        </div>
        <HuddleMetricsSection range={huddleRange} onBounds={setBounds} />
      </TabsContent>
      <TabsContent value="alignment" className="mt-4 space-y-4 focus-visible:outline-none">
        <div className="flex justify-end">
          <SharedDateFilter applied={alignRange} onApply={setAlignRange} bounds={bounds} />
        </div>
        <AlignmentSection range={alignRange} />
      </TabsContent>
      <TabsContent value="bdsl" className="mt-4 space-y-4 focus-visible:outline-none">
        <div className="flex justify-end">
          <SharedDateFilter applied={bdslRange} onApply={setBdslRange} bounds={bounds} />
        </div>
        <BdSlSection range={bdslRange} />
      </TabsContent>
      <TabsContent value="weekly" className="mt-4 space-y-4 focus-visible:outline-none">
        <div className="flex justify-end">
          <SharedDateFilter applied={weeklyRange} onApply={setWeeklyRange} bounds={bounds} />
        </div>
        <WeeklySection range={weeklyRange} />
      </TabsContent>
    </Tabs>
  );
}

// One filter bar that drives every sub-tab. Holds a local draft; commits on Apply.
function SharedDateFilter({
  applied, onApply, bounds,
}: {
  applied: DateRange;
  onApply: (r: DateRange) => void;
  bounds: { min?: string; max?: string };
}) {
  const [from, setFrom] = useState(applied.from);
  const [to, setTo] = useState(applied.to);

  // Keep the draft in sync if applied changes elsewhere (e.g. Reset).
  useEffect(() => { setFrom(applied.from); setTo(applied.to); }, [applied.from, applied.to]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input type="date" value={from} min={bounds.min} max={bounds.max}
          onChange={e => setFrom(e.target.value)} className="w-auto" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input type="date" value={to} min={bounds.min} max={bounds.max}
          onChange={e => setTo(e.target.value)} className="w-auto" />
      </div>
      <Button onClick={() => onApply({ from, to })}>Apply</Button>
      <Button variant="secondary" onClick={() => { setFrom(""); setTo(""); onApply({ from: "", to: "" }); }}>
        Reset
      </Button>
    </div>
  );
}

// =============================================================================
//   1. HUDDLE METRICS  (rename of "Daily Huddle - Operations" + Negative Feedbacks)
// =============================================================================

function HuddleMetricsSection({ range, onBounds }: { range: DateRange; onBounds: (b: { min?: string; max?: string }) => void }) {
  const [data, setData] = useState<HuddleData | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadHuddle(start?: string, end?: string) {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set("startDate", start);
      if (end) p.set("endDate", end);
      const url = "/api/dailyhuddle" + (p.toString() ? "?" + p.toString() : "");
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json as HuddleData);
      // Report selectable bounds to the parent filter bar once.
      const dates = (json.availableDates ?? []) as string[];
      if (dates.length) onBounds({ min: dates[0], max: dates[dates.length - 1] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load Huddle Metrics.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadHuddle(range.from || undefined, range.to || undefined);
    (async () => {
      setFeedbackLoading(true);
      try {
        const fp = new URLSearchParams();
        if (range.from) fp.set("from", range.from);
        if (range.to) fp.set("to", range.to);
        const r = await fetch("/api/daily-huddle/cr-metrics" + (fp.toString() ? "?" + fp.toString() : ""));
        if (!r.ok) throw new Error("Failed to load");
        const j = (await r.json()) as { feedbacks: Feedback[] };
        if (!cancelled) setFeedbacks(j.feedbacks ?? []);
      } catch {
        if (!cancelled) setFeedbacks([]);
      } finally {
        if (!cancelled) setFeedbackLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const isRange = (data?.rangeDays ?? 1) > 1;

  return (
    <div className="space-y-4">
      {/* Title bar */}
      <Card className="border bg-card">
        <CardContent className="p-5">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Huddle Metrics</h2>
          {data ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {isRange
                ? `Showing ${fmtIsoDate(data.rangeStart)} to ${fmtIsoDate(data.rangeEnd)}`
                : `Showing ${fmtIsoDate(data.rangeEnd)}`}
              {data.prevDate ? " (vs prior period)" : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* BizOps Last Day Metrics */}
      <Card className="overflow-hidden border bg-card">
        <CardHeader className="bg-indigo-500/10 dark:bg-indigo-500/15 py-3 border-b">
          <CardTitle className="text-center text-base font-semibold text-indigo-700 dark:text-indigo-300">
            BizOps Last Day Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {loading ? <KpiSkeletonGrid count={10} /> : error ? (
            <p className="py-8 text-center text-sm text-destructive">Could not load Huddle Metrics.</p>
          ) : data ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {data.bizops.map(m => <MetricTile key={m.label} m={m} />)}
              </div>
              <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-4">
                <MetricTile m={data.bizopsEligible.fnProcessed} />
                <Card className="flex flex-col items-center justify-center gap-0 border bg-card p-4 text-center">
                  <span className="text-sm font-bold leading-tight text-foreground">Today&apos;s</span>
                  <span className="text-sm font-bold leading-tight text-foreground">Eligible Count</span>
                  <ArrowRight className="mt-1 h-6 w-6 text-indigo-600 dark:text-indigo-400" />
                </Card>
                <MetricTile m={data.bizopsEligible.eligibleKYC} />
                <MetricTile m={data.bizopsEligible.eligiblePayout} />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* CR Last Day Metrics */}
      <Card className="overflow-hidden border bg-card">
        <CardHeader className="bg-indigo-500/10 dark:bg-indigo-500/15 py-3 border-b">
          <CardTitle className="text-center text-base font-semibold text-indigo-700 dark:text-indigo-300">
            CR Last Day Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {loading ? <KpiSkeletonGrid count={6} /> : data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {data.cr.map(m => <MetricTile key={m.label} m={m} />)}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Savings Amount */}
      <Card className="border bg-card">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">{data?.crSavings.label ?? "Savings Amount"}</p>
          {loading || !data ? (
            <Skeleton className="mx-auto mt-2 h-10 w-40" />
          ) : (
            <>
              <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">
                {fmtMetric(data.crSavings)}
              </p>
              {data.crSavings.change !== null ? (
                <p className={cn(
                  "mt-1 text-sm font-medium",
                  data.crSavings.change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                )}>
                  {data.crSavings.change >= 0 ? "+" : ""}{data.crSavings.change.toFixed(1)}%
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Negative Feedbacks + Negative Sentiments */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border bg-card">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-center text-sm font-semibold text-foreground">Negative Feedbacks</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {feedbackLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : !feedbacks || feedbacks.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No entries.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-indigo-950/90 dark:bg-indigo-950/60 hover:bg-indigo-950/90 dark:hover:bg-indigo-950/60">
                    <TableHead className="text-white">Date</TableHead>
                    <TableHead className="text-white">Community Chaos</TableHead>
                    <TableHead className="text-white">Trustpilot Negative Reviews</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {feedbacks.map((f, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap align-top font-medium text-foreground">{f.date}</TableCell>
                      <TableCell className="whitespace-pre-line align-top text-sm text-foreground">{f.communityChaos || "-"}</TableCell>
                      <TableCell className="whitespace-pre-line align-top text-sm text-foreground">{f.trustpilot || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="border bg-card">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-center text-sm font-semibold text-foreground">Negative Sentiments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-indigo-950/90 dark:bg-indigo-950/60 hover:bg-indigo-950/90 dark:hover:bg-indigo-950/60">
                  <TableHead className="text-white">date</TableHead>
                  <TableHead className="text-white">rule_or_policy</TableHead>
                  <TableHead className="text-white">viewCount</TableHead>
                  <TableHead className="text-white">url</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    Data source pending - section will populate later.
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricTile({ m }: { m: Metric }) {
  const up = (m.change ?? 0) >= 0;
  return (
    <Card className="flex min-h-[90px] flex-col justify-between gap-0 border bg-card p-4">
      <div className="mb-2 text-xs font-medium leading-snug text-muted-foreground">{m.label}</div>
      <div>
        <div className="text-2xl font-bold text-foreground">{fmtMetric(m)}</div>
        {m.change !== null ? (
          <div className={cn("mt-0.5 text-xs font-semibold", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400")}>
            {up ? "+" : ""}{m.change.toFixed(1)}%
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function KpiSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
    </div>
  );
}

// =============================================================================
//   2. ALIGNMENT HUDDLE  (4 cards: BD BizOps, BD CR, SL BizOps, SL CR)
// =============================================================================

function AlignmentSection({ range }: { range: DateRange }) {
  const [data, setData] = useState<AlignmentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const p = new URLSearchParams();
        if (range.from) p.set("from", range.from);
        if (range.to) p.set("to", range.to);
        const url = "/api/daily-huddle/alignment" + (p.toString() ? "?" + p.toString() : "");
        const r = await fetch(url);
        if (!r.ok) throw new Error("Failed to load");
        const j = (await r.json()) as AlignmentPayload;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setError("Could not load Alignment Huddle.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  // Latest date across all four buckets, for the header pill.
  const headerDate = (() => {
    if (!data) return "";
    const candidates = [data.bdBizOps[0]?.date, data.bdCR[0]?.date, data.slBizOps[0]?.date, data.slCR[0]?.date].filter(Boolean) as string[];
    return candidates[0] ?? "";
  })();

  return (
    <div className="space-y-4">
      {/* Banner header */}
      <Card className="overflow-hidden border-0 bg-indigo-950/95 dark:bg-indigo-950/80">
        <CardContent className="flex items-center justify-between p-4">
          <h2 className="text-xl font-bold tracking-tight text-white">Alignment Huddle</h2>
          {headerDate ? (
            <Badge variant="outline" className="border-white/30 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-900">
              <CalIcon className="mr-1.5 inline h-3 w-3" />
              {headerDate}
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <AlignmentCard title="Sri Lanka BizOps Update" rows={data?.slBizOps ?? []} variant="achievement-focus" />
          <AlignmentCard title="Sri Lanka CR Update" rows={data?.slCR ?? []} variant="achievement-focus" />
          <AlignmentCard title="Bangladesh BizOps Update" rows={data?.bdBizOps ?? []} variant="achievement-focus" />
          <AlignmentCard title="Bangladesh CR Update" rows={data?.bdCR ?? []} variant="achievement-focus-cr" />
        </div>
      )}
    </div>
  );
}

function AlignmentCard({ title, rows, variant }: { title: string; rows: AlignRow[]; variant: "achievement-focus" | "achievement-focus-cr" }) {
  const colA = variant === "achievement-focus-cr" ? "Last Days Achievement (Team CR)" : "Last Days Achievement";
  const colB = variant === "achievement-focus-cr" ? "Today's Focus (Team CR)" : "Today's Focus";
  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="border-b py-3">
        <CardTitle className="text-center text-lg font-bold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-indigo-950/90 dark:bg-indigo-950/60 hover:bg-indigo-950/90 dark:hover:bg-indigo-950/60">
              <TableHead className="w-24 text-white">Date</TableHead>
              <TableHead className="text-white">{colA}</TableHead>
              <TableHead className="text-white">{colB}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-sm text-muted-foreground">No entries.</TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="whitespace-nowrap align-top text-sm font-medium text-foreground">{r.date}</TableCell>
                  <TableCell className="whitespace-pre-line align-top text-sm text-foreground">{r.achievement || "-"}</TableCell>
                  <TableCell className="whitespace-pre-line align-top text-sm text-foreground">{r.focus || "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =============================================================================
//   3. BD-SL CONTRIBUTION  (6 horizontal bar charts)
// =============================================================================

function BdSlSection({ range }: { range: DateRange }) {
  const [data, setData] = useState<BdSlPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // BD-SL now renders one bar-group per day across the selected range.
        const p = new URLSearchParams();
        if (range.from) p.set("from", range.from);
        if (range.to) p.set("to", range.to);
        const url = "/api/daily-huddle/bd-sl" + (p.toString() ? "?" + p.toString() : "");
        const r = await fetch(url);
        if (!r.ok) throw new Error("Failed to load");
        const j = (await r.json()) as BdSlPayload;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setError("Could not load BD-SL Contribution.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border bg-card">
        <CardContent className="flex items-center justify-between p-4">
          <h2 className="text-xl font-bold tracking-tight text-foreground">BD-SL-Automation Contribution</h2>
          {data?.dateLabel ? (
            <Badge variant="outline" className="px-3 py-1.5 text-xs font-medium">
              <CalIcon className="mr-1.5 inline h-3 w-3" />
              {data.dateLabel}
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <BdSlBarChart title="KYC" chart={data.charts.kyc} />
            <BdSlBarChart title="Payout" chart={data.charts.payout} />
            <BdSlBarChart title="Intercom Ticket Solved" chart={data.charts.intercom} />
            <BdSlBarChart title="Click Up Issues solved" chart={data.charts.clickup} />
          </div>
          <Separator className="my-2" />
          <div className="grid gap-4 lg:grid-cols-2">
            <BdSlBarChart title="Instant KYC Checked" chart={data.charts.instantKyc} />
            <BdSlBarVertical title="CR Email Contribution" chart={data.charts.crEmail} />
          </div>
        </>
      ) : null}
    </div>
  );
}

// Theme-aware chart palette tracking Pictures 4 & 5.
const CHART_COLORS = {
  bd: "#2196F3",   // blue
  sl: "#1AB7C0",   // teal/cyan
  auto: "#E91E63", // magenta/pink
};

function BdSlBarChart({ title, chart }: { title: string; chart: BdSlChart }) {
  const { resolvedTheme } = useTheme();
  const axisColor = resolvedTheme === "dark" ? "#94a3b8" : "#475569";
  const gridColor = resolvedTheme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.3)";

  const colorFor = (key: string) => key === "bd" ? CHART_COLORS.bd : key === "sl" ? CHART_COLORS.sl : CHART_COLORS.auto;
  const rowCount = Math.max(1, chart.rows.length);
  // Height scales with number of days so bars stay readable across a range.
  const height = Math.max(200, rowCount * chart.series.length * 26 + 48);

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="py-3">
        <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {/* Legend */}
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {chart.series.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colorFor(s.key) }} />
              <span className="text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
        {chart.rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No data for this range.</p>
        ) : (
          <div style={{ width: "100%", height }}>
            <ResponsiveContainer>
              <BarChart
                layout="vertical"
                data={chart.rows}
                margin={{ top: 8, right: 40, bottom: 8, left: 0 }}
                barCategoryGap="20%"
              >
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke={axisColor} fontSize={11} />
                <YAxis dataKey="date" type="category" stroke={axisColor} fontSize={11} width={72} />
                <Tooltip
                  cursor={{ fill: resolvedTheme === "dark" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)" }}
                  contentStyle={{
                    backgroundColor: resolvedTheme === "dark" ? "rgb(30 41 59)" : "#ffffff",
                    border: `1px solid ${resolvedTheme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.3)"}`,
                    borderRadius: 8, fontSize: 12,
                  }}
                  labelStyle={{ color: resolvedTheme === "dark" ? "#f1f5f9" : "#111827", fontWeight: 600 }}
                  itemStyle={{ color: resolvedTheme === "dark" ? "#e2e8f0" : "#111827" }}
                />
                {chart.series.map(s => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} fill={colorFor(s.key)} radius={[0, 2, 2, 0]}>
                    <LabelList dataKey={s.key} position="right" fill={axisColor} fontSize={11} fontWeight={600} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BdSlBarVertical({ title, chart }: { title: string; chart: BdSlChart }) {
  const { resolvedTheme } = useTheme();
  const axisColor = resolvedTheme === "dark" ? "#94a3b8" : "#475569";
  const gridColor = resolvedTheme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.3)";

  const colorFor = (key: string) => key === "bd" ? CHART_COLORS.bd : key === "sl" ? CHART_COLORS.sl : CHART_COLORS.auto;

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="py-3">
        <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {chart.series.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colorFor(s.key) }} />
              <span className="text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
        {chart.rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">No data for this range.</p>
        ) : (
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chart.rows} margin={{ top: 16, right: 16, bottom: 8, left: 0 }} barCategoryGap="20%">
                <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke={axisColor} fontSize={11} />
                <YAxis stroke={axisColor} fontSize={11} />
                <Tooltip
                  cursor={{ fill: resolvedTheme === "dark" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)" }}
                  contentStyle={{
                    backgroundColor: resolvedTheme === "dark" ? "rgb(30 41 59)" : "#ffffff",
                    border: `1px solid ${resolvedTheme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.3)"}`,
                    borderRadius: 8, fontSize: 12,
                  }}
                  labelStyle={{ color: resolvedTheme === "dark" ? "#f1f5f9" : "#111827", fontWeight: 600 }}
                  itemStyle={{ color: resolvedTheme === "dark" ? "#e2e8f0" : "#111827" }}
                />
                {chart.series.map(s => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} fill={colorFor(s.key)} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey={s.key} position="top" fill={axisColor} fontSize={11} fontWeight={600} />
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// =============================================================================
//   4. WEEKLY TREND  (BizOps grouped bars + CR dual-axis + Savings bars)
// =============================================================================

function WeeklySection({ range }: { range: DateRange }) {
  const [data, setData] = useState<WeeklyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // Weekly defaults to last completed Mon-Sun when no range is set.
        const p = new URLSearchParams();
        if (range.from) p.set("from", range.from);
        if (range.to) p.set("to", range.to);
        const url = "/api/daily-huddle/weekly" + (p.toString() ? "?" + p.toString() : "");
        const r = await fetch(url);
        if (!r.ok) throw new Error("Failed to load");
        const j = (await r.json()) as WeeklyPayload;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setError("Could not load Weekly Trend.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [range.from, range.to]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border bg-card">
        <CardContent className="flex items-center justify-between p-4">
          <h2 className="text-xl font-bold tracking-tight text-foreground">Weekly Trend</h2>
          {data ? (
            <Badge variant="outline" className="px-3 py-1.5 text-xs font-medium">
              <CalIcon className="mr-1.5 inline h-3 w-3" />
              {data.window.fromLabel} - {data.window.toLabel}
            </Badge>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : data ? (
        <>
          <BizOpsWeeklyChart data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <CrEmailClosedChart data={data} />
            <CrSavingsChart data={data} />
          </div>
        </>
      ) : null}
    </div>
  );
}

function BizOpsWeeklyChart({ data }: { data: WeeklyPayload }) {
  const { resolvedTheme } = useTheme();
  const axisColor = resolvedTheme === "dark" ? "#94a3b8" : "#475569";
  const gridColor = resolvedTheme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.3)";
  const labelColor = resolvedTheme === "dark" ? "#cbd5e1" : "#475569";

  // Stitch all three series into a single per-day row.
  const dates = data.bizops.totalPayoutCount.map(p => p.date);
  const chartData = dates.map((date, i) => ({
    date,
    payout: data.bizops.totalPayoutCount[i]?.value ?? 0,
    kyc: data.bizops.totalKycChecked[i]?.value ?? 0,
    intercom: data.bizops.intercomSolved[i]?.value ?? 0,
  }));

  const total = (k: "payout"|"kyc"|"intercom") => chartData.reduce((a, b) => a + b[k], 0);

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="bg-indigo-950/90 dark:bg-indigo-950/60 py-3">
        <CardTitle className="text-center text-base font-bold text-white">BizOps Weekly Trend</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-center gap-4 text-xs">
          <LegendDot color="#B91C5C" label={`Total Payout Count (Total: ${fmtNumber(total("payout"))})`} />
          <LegendDot color="#1E40AF" label={`Total KYC Checked (Total: ${fmtNumber(total("kyc"))})`} />
          <LegendDot color="#A855F7" label={`Intercom Re-escalation (Total: ${fmtNumber(total("intercom"))})`} />
        </div>
        <div style={{ width: "100%", height: 340 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 24, right: 16, bottom: 12, left: 0 }} barCategoryGap="18%">
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke={axisColor} fontSize={11} />
              <YAxis stroke={axisColor} fontSize={11} />
              <Tooltip
                cursor={{ fill: resolvedTheme === "dark" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)" }}
                contentStyle={{
                  backgroundColor: resolvedTheme === "dark" ? "rgb(30 41 59)" : "#ffffff",
                  border: `1px solid ${resolvedTheme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.3)"}`,
                  borderRadius: 8, fontSize: 12,
                }}
                labelStyle={{ color: resolvedTheme === "dark" ? "#f1f5f9" : "#111827", fontWeight: 600 }}
                itemStyle={{ color: resolvedTheme === "dark" ? "#e2e8f0" : "#111827" }}
              />
              <Bar dataKey="payout" fill="#B91C5C" radius={[4,4,0,0]}>
                <LabelList dataKey="payout" position="top" fill={labelColor} fontSize={11} fontWeight={600} />
              </Bar>
              <Bar dataKey="kyc" fill="#1E40AF" radius={[4,4,0,0]}>
                <LabelList dataKey="kyc" position="top" fill={labelColor} fontSize={11} fontWeight={600} />
              </Bar>
              <Bar dataKey="intercom" fill="#A855F7" radius={[4,4,0,0]}>
                <LabelList dataKey="intercom" position="top" fill={labelColor} fontSize={11} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function CrEmailClosedChart({ data }: { data: WeeklyPayload }) {
  const { resolvedTheme } = useTheme();
  const axisColor = resolvedTheme === "dark" ? "#94a3b8" : "#475569";
  const gridColor = resolvedTheme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.3)";
  const labelColor = resolvedTheme === "dark" ? "#cbd5e1" : "#475569";

  const dates = data.cr.outboundEmail.map(p => p.date);
  const chartData = dates.map((date, i) => ({
    date,
    outbound: data.cr.outboundEmail[i]?.value ?? 0,
    closed: data.cr.conversationClosed[i]?.value ?? 0,
  }));
  const totalOut = chartData.reduce((a,b) => a+b.outbound, 0);
  const totalClose = chartData.reduce((a,b) => a+b.closed, 0);

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="bg-indigo-950/90 dark:bg-indigo-950/60 py-3">
        <CardTitle className="text-center text-base font-bold text-white">CR Weekly Trend</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-center gap-4 text-xs">
          <LegendDot color="#4F46E5" label={`Outbound Email (Total: ${fmtNumber(totalOut)})`} />
          <LegendDot color="#B91C5C" label={`Conversation Closed (Total: ${fmtNumber(totalClose)})`} />
        </div>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 24, right: 16, bottom: 12, left: 0 }} barCategoryGap="18%">
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke={axisColor} fontSize={11} />
              <YAxis yAxisId="left" stroke={axisColor} fontSize={11} />
              <YAxis yAxisId="right" orientation="right" stroke={axisColor} fontSize={11} />
              <Tooltip
                cursor={{ fill: resolvedTheme === "dark" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)" }}
                contentStyle={{
                  backgroundColor: resolvedTheme === "dark" ? "rgb(30 41 59)" : "#ffffff",
                  border: `1px solid ${resolvedTheme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.3)"}`,
                  borderRadius: 8, fontSize: 12,
                }}
                labelStyle={{ color: resolvedTheme === "dark" ? "#f1f5f9" : "#111827", fontWeight: 600 }}
                itemStyle={{ color: resolvedTheme === "dark" ? "#e2e8f0" : "#111827" }}
              />
              <Bar yAxisId="left" dataKey="outbound" fill="#4F46E5" radius={[4,4,0,0]}>
                <LabelList dataKey="outbound" position="top" fill={labelColor} fontSize={10} fontWeight={600} />
              </Bar>
              <Bar yAxisId="right" dataKey="closed" fill="#B91C5C" radius={[4,4,0,0]}>
                <LabelList dataKey="closed" position="top" fill={labelColor} fontSize={10} fontWeight={600} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function CrSavingsChart({ data }: { data: WeeklyPayload }) {
  const { resolvedTheme } = useTheme();
  const axisColor = resolvedTheme === "dark" ? "#94a3b8" : "#475569";
  const gridColor = resolvedTheme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.3)";
  const labelColor = resolvedTheme === "dark" ? "#cbd5e1" : "#475569";

  const chartData = data.cr.savingsAmount.map(p => ({ date: p.date, value: p.value }));
  const total = chartData.reduce((a,b) => a+b.value, 0);

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="bg-indigo-950/90 dark:bg-indigo-950/60 py-3">
        <CardTitle className="text-center text-base font-bold text-white">Savings Amount</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-center text-xs">
          <LegendDot color="#9333EA" label={`Savings Amount (Total: ${fmtCurrency(total)})`} />
        </div>
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 24, right: 16, bottom: 12, left: 0 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" stroke={axisColor} fontSize={11} />
              <YAxis stroke={axisColor} fontSize={11} tickFormatter={(v) => fmtCurrencyShort(Number(v) || 0)} />
              <Tooltip
                cursor={{ fill: resolvedTheme === "dark" ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.15)" }}
                contentStyle={{
                  backgroundColor: resolvedTheme === "dark" ? "rgb(30 41 59)" : "#ffffff",
                  border: `1px solid ${resolvedTheme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(148,163,184,0.3)"}`,
                  borderRadius: 8, fontSize: 12,
                }}
                labelStyle={{ color: resolvedTheme === "dark" ? "#f1f5f9" : "#111827", fontWeight: 600 }}
                itemStyle={{ color: resolvedTheme === "dark" ? "#e2e8f0" : "#111827" }}
                formatter={(v) => [fmtCurrency(Number(v) || 0), "Savings"]}
              />
              <Bar dataKey="value" fill="#9333EA" radius={[6,6,0,0]}>
                <LabelList dataKey="value" position="top" fill={labelColor} fontSize={11} fontWeight={600}
                  formatter={(v) => fmtCurrencyShort(Number(v) || 0)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
