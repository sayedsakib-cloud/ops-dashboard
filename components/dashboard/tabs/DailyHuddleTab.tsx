"use client";
import { useEffect, useState } from "react";

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

export default function DailyHuddleTab() {
  const [data, setData] = useState<HuddleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd,   setRangeEnd]   = useState("");

  async function load(start?: string, end?: string) {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set("startDate", start);
      if (end)   p.set("endDate",   end);
      const url = "/api/dailyhuddle" + (p.toString() ? `?${p}` : "");
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      setSelectedDate(json.date);
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

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-lg shadow-sm px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-900">Daily Huddle — Operations</h1>
        <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 font-medium">From</label>
            <input
              type="date"
              value={rangeStart || data.rangeStart}
              min={data.availableDates[0]}
              max={data.availableDates[data.availableDates.length - 1]}
              onChange={e => setRangeStart(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <label className="text-xs text-gray-500 font-medium">To</label>
            <input
              type="date"
              value={rangeEnd || data.rangeEnd}
              min={data.availableDates[0]}
              max={data.availableDates[data.availableDates.length - 1]}
              onChange={e => setRangeEnd(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button
              onClick={() => load(rangeStart || data.rangeStart, rangeEnd || data.rangeEnd)}
              className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 transition-colors"
            >
              Apply
            </button>
          </div>
          {data.rangeDays > 1 && (
            <span className="text-xs text-gray-400 hidden md:inline">
              {data.rangeDays}-day range · vs prior {data.rangeDays} days
            </span>
          )}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden shadow-sm">
        <SectionHeader title="BizOps Last Day Metrics" />
        <div className="bg-gray-50 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.bizops.map((m) => <MetricCard key={m.label} m={m} />)}
          </div>
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

      <div className="rounded-lg overflow-hidden shadow-sm">
        <SectionHeader title="CR Last Day Metrics" />
        <div className="bg-gray-50 p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.cr.map((m) => <MetricCard key={m.label} m={m} />)}
          </div>
          <div className="bg-white rounded-lg p-6 shadow-sm border border-gray-100 text-center">
            <div className="text-sm text-gray-500 font-medium mb-1">{data.crSavings.label}</div>
            <div className="text-4xl font-bold text-gray-900">{fmtVal(data.crSavings)}</div>
            {data.crSavings.change !== null && (
              <div className={`text-sm mt-1.5 font-semibold ${(data.crSavings.change ?? 0) >= 0 ? "text-green-600" : "text-red-500"}`}>
                {(data.crSavings.change ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(data.crSavings.change).toFixed(1)}%
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 text-right">
        Showing {fmtDate(data.date)}
        {data.prevDate && ` · compared to ${fmtDate(data.prevDate)}`}
      </p>
    </div>
  );
}
