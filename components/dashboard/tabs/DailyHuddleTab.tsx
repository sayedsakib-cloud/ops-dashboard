"use client";
import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
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

// ── Formatters ─────────────────────────────────────────────────────────────
function fmtVal(m: Metric): string {
  if (m.value === null) return "—";
  if (m.format === "currency")
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(m.value);
  if (m.format === "hrs") return `${m.value} hrs`;
  return new Intl.NumberFormat("en-US").format(m.value);
}
function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────
function MetricCard({ m }: { m: Metric }) {
  const up = (m.change ?? 0) >= 0;
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100 flex flex-col justify-between min-h-[90px]">
      <div className="text-xs text-gray-500 font-medium leading-snug mb-2">{m.label}</div>
      <div>
        <div className="text-2xl font-bold text-gray-900">{fmtVal(m)}</div>
        {m.change !== null && (
          <div className={`text-xs mt-0.5 font-semibold ${up ? "text-green-600" : "text-red-500"}`}>
            {up ? "▲" : "▼"} {Math.abs(m.change).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-indigo-950 text-white text-center font-semibold py-2.5 text-sm tracking-wide rounded-t-lg">
      {title}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function DailyHuddleTab() {
  const [data,       setData]    = useState<HuddleData | null>(null);
  const [loading,    setLoading] = useState(true);
  const [error,      setError]   = useState<string | null>(null);
  const [rangeStart, setStart]   = useState("");
  const [rangeEnd,   setEnd]     = useState("");

  async function load(start?: string, end?: string) {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set("startDate", start);
      if (end)   p.set("endDate",   end);
      const url  = "/api/dailyhuddle" + (p.toString() ? `?${p}` : "");
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

  if (loading)
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400 text-sm animate-pulse">Loading Daily Huddle data…</div>
      </div>
    );
  if (error)
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
        Error: {error}
      </div>
    );
  if (!data) return null;

  const minDate = data.availableDates[0];
  const maxDate = data.availableDates[data.availableDates.length - 1];

  return (
    <div className="space-y-5">

      {/* Header + Date range picker */}
      <div className="bg-white rounded-lg shadow-sm px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-xl font-bold text-gray-900">Daily Huddle — Operations</h1>

        <div className="flex flex-wrap items-end gap-3">
          {/* From date */}
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">From</label>
            <input
              type="date"
              value={rangeStart}
              min={minDate}
              max={maxDate}
              onChange={e => setStart(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* To date */}
          <div>
            <label className="block text-xs text-gray-500 font-medium mb-1">To</label>
            <input
              type="date"
              value={rangeEnd}
              min={minDate}
              max={maxDate}
              onChange={e => setEnd(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          {/* Apply button */}
          <button
            onClick={() => load(rangeStart, rangeEnd)}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
          >
            Apply
          </button>

          {/* Reset to latest day */}
          <button
            onClick={() => { setStart(""); setEnd(""); load(); }}
            className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors"
          >
            Reset
          </button>

          {/* Range label */}
          {data.prevDate && (
            <span className="text-xs text-gray-400 hidden md:inline self-end pb-2">
              {data.rangeDays > 1
                ? `${data.rangeDays}-day range · vs prior ${data.rangeDays} days`
                : `vs ${fmtDate(data.prevDate)}`}
            </span>
          )}
        </div>
      </div>

      {/* BizOps section */}
      <div className="rounded-lg overflow-hidden shadow-sm">
        <SectionHeader title="BizOps Last Day Metrics" />
        <div className="bg-gray-50 p-4 space-y-3">
          {/* Row 1 — 6 metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.bizops.map(m => <MetricCard key={m.label} m={m} />)}
          </div>

          {/* Row 2 — FN Processed + label + Eligible KYC + Eligible Payout */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-stretch">
            <MetricCard m={data.bizopsEligible.fnProcessed} />
            <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
              <span className="text-sm font-bold text-gray-700 leading-tight">Today&apos;s</span>
              <span className="text-sm font-bold text-gray-700 leading-tight">Eligible Count</span>
              <span className="text-2xl text-indigo-600 font-bold mt-1">→</span>
            </div>
            <MetricCard m={data.bizopsEligible.eligibleKYC} />
            <MetricCard m={data.bizopsEligible.eligiblePayout} />
          </div>
        </div>
      </div>

      {/* CR section */}
      <div className="rounded-lg overflow-hidden shadow-sm">
        <SectionHeader title="CR Last Day Metrics" />
        <div className="bg-gray-50 p-4 space-y-3">
          {/* Row 1 — 6 metric cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.cr.map(m => <MetricCard key={m.label} m={m} />)}
          </div>

          {/* Savings Amount — full-width */}
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100 text-center">
            <div className="text-sm text-gray-500 font-medium mb-1">{data.crSavings.label}</div>
            <div className="text-4xl font-bold text-gray-900">{fmtVal(data.crSavings)}</div>
            {data.crSavings.change !== null && (
              <div className={`text-sm mt-1.5 font-semibold ${
                (data.crSavings.change ?? 0) >= 0 ? "text-green-600" : "text-red-500"
              }`}>
                {(data.crSavings.change ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(data.crSavings.change).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-right">
        Showing {fmtDate(data.rangeStart)}
        {data.rangeStart !== data.rangeEnd && ` – ${fmtDate(data.rangeEnd)}`}
        {data.prevDate && ` · compared to prior ${data.rangeDays} day${data.rangeDays > 1 ? "s" : ""}`}
      </p>
    </div>
  );
}
