"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
  CartesianGrid, Legend,
} from "recharts";
import { ArrowRight, Loader2, ArrowUp, ArrowDown, Calendar as CalIcon } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------- Types --------------------------------------------------------------

type Fmt = "number" | "hrs" | "currency";

type MetricRow = {
  label: string;
  key: string;
  value: number;
  prev: number;
  fmt?: Fmt;
};

type HuddleData = {
  date: string;          // formatted (e.g. "Jun 15, 2026")
  prevDate?: string;
  bizops: MetricRow[];
  cr: MetricRow[];
  savings: { value: number; prev: number };
  eligibleKyc: number;
  eligiblePayout: number;
  prevEligiblePayout?: number;
};

type Feedback = { date: string; communityChaos: string; trustpilot: string };

type AlignRow = { date: string; achievement: string; focus: string };
type AlignmentPayload = {
  bdBizOps: AlignRow[];
  bdCR: AlignRow[];
  slBizOps: AlignRow[];
  slCR: AlignRow[];
};

type ChartSeries = Array<{ name: string; value: number; key: string }>;
type BdSlPayload = {
  date: string;
  charts: {
    kyc: { date: string; series: ChartSeries };
    payout: { date: string; series: ChartSeries };
    intercom: { date: string; series: ChartSeries };
    clickup: { date: string; series: ChartSeries };
    instantKyc: { date: string; series: ChartSeries };
    crEmail: { date: string; series: ChartSeries };
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
const fmtHrs = (n: number) => `${n.toFixed(2)} hrs`;
const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const fmtCurrencyShort = (n: number) => {
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
};

function formatBy(fmt: Fmt | undefined, n: number) {
  if (fmt === "hrs") return fmtHrs(n);
  if (fmt === "currency") return fmtCurrency(n);
  return fmtNumber(n);
}

function pctChange(curr: number, prev: number): number | null {
  if (!isFinite(prev) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

// ---------- Top-level component ------------------------------------------------

export default function DailyHuddleTab() {
  return (
    <Tabs defaultValue="huddle" className="space-y-4">
      <TabsList className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
        <TabsTrigger value="huddle" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
          Huddle Metrics
        </TabsTrigger>
        <TabsTrigger value="alignment" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
          Alignment Huddle
        </TabsTrigger>
        <TabsTrigger value="bdsl" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
          BD-SL Contribution
        </TabsTrigger>
        <TabsTrigger value="weekly" className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
          Weekly Trend
        </TabsTrigger>
      </TabsList>

      <TabsContent value="huddle" className="mt-4 focus-visible:outline-none">
        <HuddleMetricsSection />
      </TabsContent>
      <TabsContent value="alignment" className="mt-4 focus-visible:outline-none">
        <AlignmentSection />
      </TabsContent>
      <TabsContent value="bdsl" className="mt-4 focus-visible:outline-none">
        <BdSlSection />
      </TabsContent>
      <TabsContent value="weekly" className="mt-4 focus-visible:outline-none">
        <WeeklySection />
      </TabsContent>
    </Tabs>
  );
}

// =============================================================================
//   1. HUDDLE METRICS  (rename of "Daily Huddle - Operations" + Negative Feedbacks)
// =============================================================================

function HuddleMetricsSection() {
  const [data, setData] = useState<HuddleData | null>(null);
  const [feedbacks, setFeedbacks] = useState<Feedback[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedbackLoading, setFeedbackLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/daily-huddle");
        if (!r.ok) throw new Error("Failed to load");
        const j = (await r.json()) as HuddleData;
        if (!cancelled) setData(j);
      } catch {
        if (!cancelled) setError("Could not load Huddle Metrics.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    (async () => {
      setFeedbackLoading(true);
      try {
        const r = await fetch("/api/daily-huddle/cr-metrics");
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
  }, []);

  return (
    <div className="space-y-4">
      {/* Title bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Huddle Metrics</h2>
          {data?.date ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Showing {data.date}{data.prevDate ? ` (vs ${data.prevDate})` : ""}
            </p>
          ) : null}
        </div>
      </div>

      {/* BizOps Last Day Metrics */}
      <Card className="overflow-hidden border bg-card">
        <CardHeader className="bg-indigo-500/10 dark:bg-indigo-500/15 py-3 border-b">
          <CardTitle className="text-center text-base font-semibold text-indigo-700 dark:text-indigo-300">
            BizOps Last Day Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {loading ? <KpiSkeletonGrid count={10} /> : error ? (
            <p className="py-8 text-center text-sm text-destructive">{error}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {data?.bizops.slice(0, 6).map(m => <MetricTile key={m.key} row={m} />)}
              {data?.bizops.slice(6).map(m => (
                m.key === "todays-eligible-count" ? (
                  <EligibleCountTile key={m.key} kyc={data.eligibleKyc} payoutSoFar={data.eligiblePayout} prevPayoutSoFar={data.prevEligiblePayout} />
                ) : (
                  <MetricTile key={m.key} row={m} />
                )
              ))}
            </div>
          )}
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
          {loading ? <KpiSkeletonGrid count={6} /> : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              {data?.cr.map(m => <MetricTile key={m.key} row={m} />)}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Savings Amount */}
      <Card className="border bg-card">
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">Savings Amount</p>
          {loading || !data ? (
            <Skeleton className="mx-auto mt-2 h-10 w-40" />
          ) : (
            <>
              <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">
                {fmtCurrency(data.savings.value)}
              </p>
              <ChangeBadge curr={data.savings.value} prev={data.savings.prev} />
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
                      <TableCell className="whitespace-nowrap font-medium text-foreground">{f.date}</TableCell>
                      <TableCell className="whitespace-pre-line text-sm text-foreground">{f.communityChaos || "-"}</TableCell>
                      <TableCell className="whitespace-pre-line text-sm text-foreground">{f.trustpilot || "-"}</TableCell>
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

function MetricTile({ row }: { row: MetricRow }) {
  const change = pctChange(row.value, row.prev);
  return (
    <Card className="border bg-card">
      <CardContent className="p-3">
        <p className="text-[11px] font-medium text-muted-foreground">{row.label}</p>
        <p className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          {formatBy(row.fmt, row.value)}
        </p>
        {change !== null ? (
          <p className={cn(
            "mt-0.5 text-xs font-medium",
            change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
          )}>
            {change >= 0 ? "+" : ""}{change.toFixed(1)}%
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function EligibleCountTile({ kyc, payoutSoFar, prevPayoutSoFar }: { kyc: number; payoutSoFar: number; prevPayoutSoFar?: number }) {
  const change = prevPayoutSoFar !== undefined ? pctChange(payoutSoFar, prevPayoutSoFar) : null;
  return (
    <Card className="border bg-card">
      <CardContent className="p-3">
        <p className="text-[11px] font-medium text-muted-foreground">
          Today&apos;s Eligible Count <ArrowRight className="inline h-3 w-3 text-muted-foreground" />
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <p className="text-[10px] text-muted-foreground">KYC</p>
            <p className="text-lg font-bold text-foreground">{fmtNumber(kyc)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Payout So Far</p>
            <p className="text-lg font-bold text-foreground">{fmtNumber(payoutSoFar)}</p>
            {change !== null ? (
              <p className={cn("text-[10px] font-medium", change >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                {change >= 0 ? "+" : ""}{change.toFixed(1)}%
              </p>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChangeBadge({ curr, prev }: { curr: number; prev: number }) {
  const c = pctChange(curr, prev);
  if (c === null) return null;
  const positive = c >= 0;
  return (
    <p className={cn("mt-1 inline-flex items-center gap-1 text-sm font-medium", positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      {positive ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
      {positive ? "+" : ""}{c.toFixed(1)}%
    </p>
  );
}

function KpiSkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
    </div>
  );
}

// =============================================================================
//   2. ALIGNMENT HUDDLE  (4 cards: BD BizOps, BD CR, SL BizOps, SL CR)
// =============================================================================

function AlignmentSection() {
  const [data, setData] = useState<AlignmentPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/daily-huddle/alignment");
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
  }, []);

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

function BdSlSection() {
  const [data, setData] = useState<BdSlPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/daily-huddle/bd-sl");
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
  }, []);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border bg-card">
        <CardContent className="flex items-center justify-between p-4">
          <h2 className="text-xl font-bold tracking-tight text-foreground">BD-SL-Automation Contribution</h2>
          {data?.date ? (
            <Badge variant="outline" className="px-3 py-1.5 text-xs font-medium">
              <CalIcon className="mr-1.5 inline h-3 w-3" />
              {data.date}
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
            <BdSlBarChart title="KYC" data={data.charts.kyc} dateLabel={data.charts.kyc.date} />
            <BdSlBarChart title="Payout" data={data.charts.payout} dateLabel={data.charts.payout.date} />
            <BdSlBarChart title="Intercom Ticket Solved" data={data.charts.intercom} dateLabel={data.charts.intercom.date} />
            <BdSlBarChart title="Click Up Issues solved" data={data.charts.clickup} dateLabel={data.charts.clickup.date} />
          </div>
          <Separator className="my-2" />
          <div className="grid gap-4 lg:grid-cols-2">
            <BdSlBarChart title="Instant KYC Checked" data={data.charts.instantKyc} dateLabel={data.charts.instantKyc.date} />
            <BdSlBarVertical title="CR Email Contribution" data={data.charts.crEmail} dateLabel={data.charts.crEmail.date} />
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

function BdSlBarChart({ title, data, dateLabel }: { title: string; data: { series: ChartSeries }; dateLabel: string }) {
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
        {/* Legend */}
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {data.series.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colorFor(s.key) }} />
              <span className="text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer>
            <BarChart
              layout="vertical"
              data={[{ date: dateLabel, ...Object.fromEntries(data.series.map(s => [s.key, s.value])) }]}
              margin={{ top: 8, right: 32, bottom: 8, left: 0 }}
              barCategoryGap="20%"
            >
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke={axisColor} fontSize={11} />
              <YAxis dataKey="date" type="category" stroke={axisColor} fontSize={11} width={70} />
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
              {data.series.map(s => (
                <Bar key={s.key} dataKey={s.key} fill={colorFor(s.key)} radius={[0, 2, 2, 0]}>
                  <LabelList dataKey={s.key} position="insideRight" fill="#ffffff" fontSize={12} fontWeight={600} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function BdSlBarVertical({ title, data, dateLabel }: { title: string; data: { series: ChartSeries }; dateLabel: string }) {
  const { resolvedTheme } = useTheme();
  const axisColor = resolvedTheme === "dark" ? "#94a3b8" : "#475569";
  const gridColor = resolvedTheme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(148,163,184,0.3)";

  const colorFor = (key: string) => key === "bd" ? CHART_COLORS.bd : key === "sl" ? CHART_COLORS.sl : CHART_COLORS.auto;
  const chartData = data.series.map(s => ({ name: s.name, key: s.key, value: s.value }));

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="py-3">
        <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {data.series.map(s => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: colorFor(s.key) }} />
              <span className="text-muted-foreground">{s.name}</span>
            </div>
          ))}
        </div>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 16, right: 16, bottom: 28, left: 0 }}>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" stroke={axisColor} fontSize={11} tick={false} />
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
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {chartData.map((d, i) => <Cell key={i} fill={colorFor(d.key)} />)}
                <LabelList dataKey="value" position="insideTop" fill="#ffffff" fontSize={12} fontWeight={600} offset={8} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">{dateLabel}</p>
      </CardContent>
    </Card>
  );
}

// =============================================================================
//   4. WEEKLY TREND  (BizOps grouped bars + CR dual-axis + Savings bars)
// =============================================================================

function WeeklySection() {
  const [data, setData] = useState<WeeklyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/daily-huddle/weekly");
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
  }, []);

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
