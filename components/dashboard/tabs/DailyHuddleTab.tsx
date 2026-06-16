"use client";
import { useEffect, useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// -- Types ------------------------------------------------------------------
type Fmt    = "number" | "hrs" | "currency";
type Metric = { label: string; value: number|null; change: number|null; format: Fmt };
type HuddleData = {
  date:           string;
  prevDate:       string|null;
  rangeStart:     string;
  rangeEnd:       string;
  rangeDays:      number;
  availableDates: string[];
  bizops:         Metric[];
  bizopsEligible: { fnProcessed: Metric; eligibleKYC: Metric; eligiblePayout: Metric };
  cr:             Metric[];
  crSavings:      Metric;
};

// -- Formatters -------------------------------------------------------------
function fmtVal(m: Metric): string {
  if (m.value === null) return "--";
  if (m.format === "currency")
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", minimumFractionDigits: 2,
    }).format(m.value);
  if (m.format === "hrs") return `${m.value} hrs`;
  return new Intl.NumberFormat("en-US").format(m.value);
}
function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// -- Sub-components ---------------------------------------------------------
function MetricCard({ m }: { m: Metric }) {
  const up = (m.change ?? 0) >= 0;
  return (
    <Card className="flex min-h-[90px] flex-col justify-between gap-0 p-4">
      <div className="mb-2 text-xs font-medium leading-snug text-muted-foreground">{m.label}</div>
      <div>
        <div className="text-2xl font-bold">{fmtVal(m)}</div>
        {m.change !== null && (
          <div className={cn("mt-0.5 text-xs font-semibold", up ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
            {up ? "+" : ""}{m.change.toFixed(1)}%
          </div>
        )}
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="bg-indigo-600 py-2.5 text-center text-sm font-semibold tracking-wide text-white">{title}</div>
      <div className="space-y-3 bg-muted/30 p-4">{children}</div>
    </Card>
  );
}

// -- Main Component ---------------------------------------------------------
export default function DailyHuddleTab() {
  const [data,       setData]    = useState<HuddleData | null>(null);
  const [loading,    setLoading] = useState(true);
  const [error,      setError]   = useState<string | null>(null);
  const [rangeStart, setStart]   = useState("");
  const [rangeEnd,   setEnd]     = useState("");

  async function load(start?: string, end?: string) {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set("startDate", start);
      if (end)   p.set("endDate",   end);
      const url  = "/api/dailyhuddle" + (p.toString() ? "?" + p.toString() : "");
      const res  = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      setStart(json.rangeStart ?? json.date ?? "");
      setEnd(json.rangeEnd     ?? json.date ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading Daily Huddle data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  const minDate    = data.availableDates[0];
  const maxDate    = data.availableDates[data.availableDates.length - 1];
  const isRange    = data.rangeDays > 1;
  const rangeLabel = isRange
    ? data.rangeDays + "-day range vs prior " + data.rangeDays + " days"
    : (data.prevDate ? "vs " + fmtDate(data.prevDate) : "");

  return (
    <div className="space-y-5">
      {/* Header + Date range picker */}
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold">Daily Huddle - Operations</h1>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={rangeStart} min={minDate} max={maxDate}
              onChange={e => setStart(e.target.value)} className="w-auto" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={rangeEnd} min={minDate} max={maxDate}
              onChange={e => setEnd(e.target.value)} className="w-auto" />
          </div>
          <Button onClick={() => load(rangeStart, rangeEnd)}>Apply</Button>
          <Button variant="secondary" onClick={() => { setStart(""); setEnd(""); load(); }}>Reset</Button>
          {rangeLabel && (
            <span className="hidden self-end pb-2 text-xs text-muted-foreground md:inline">{rangeLabel}</span>
          )}
        </div>
      </Card>

      {/* BizOps section */}
      <Section title="BizOps Last Day Metrics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data.bizops.map(m => <MetricCard key={m.label} m={m} />)}
        </div>
        <div className="grid grid-cols-2 items-stretch gap-3 md:grid-cols-4">
          <MetricCard m={data.bizopsEligible.fnProcessed} />
          <Card className="flex flex-col items-center justify-center gap-0 p-4 text-center">
            <span className="text-sm font-bold leading-tight">Today&apos;s</span>
            <span className="text-sm font-bold leading-tight">Eligible Count</span>
            <ArrowRight className="mt-1 h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          </Card>
          <MetricCard m={data.bizopsEligible.eligibleKYC} />
          <MetricCard m={data.bizopsEligible.eligiblePayout} />
        </div>
      </Section>

      {/* CR section */}
      <Section title="CR Last Day Metrics">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data.cr.map(m => <MetricCard key={m.label} m={m} />)}
        </div>
        <Card className="gap-0 p-6 text-center">
          <div className="mb-1 text-sm font-medium text-muted-foreground">{data.crSavings.label}</div>
          <div className="text-4xl font-bold">{fmtVal(data.crSavings)}</div>
          {data.crSavings.change !== null && (
            <div className={cn("mt-1.5 text-sm font-semibold", (data.crSavings.change ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400")}>
              {(data.crSavings.change ?? 0) >= 0 ? "+" : ""}{Math.abs(data.crSavings.change).toFixed(1)}%
            </div>
          )}
        </Card>
      </Section>

      <p className="text-right text-xs text-muted-foreground">
        {isRange
          ? "Showing " + fmtDate(data.rangeStart) + " to " + fmtDate(data.rangeEnd)
          : "Showing " + fmtDate(data.rangeEnd)}
        {data.prevDate && " (vs prior period)"}
      </p>
    </div>
  );
}
