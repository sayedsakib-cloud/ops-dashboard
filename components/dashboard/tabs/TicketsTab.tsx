"use client";
import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
type AgentStat = {
  name: string; resolved: number; avgResolutionFmt: string;
  slaMet: number; slaBreaches: number; slaRate: number;
};
type TicketSummary = {
  total: number; resolved: number; open: number;
  slaMetCount: number; slaBreachCount: number; slaComplianceRate: number;
  avgResolutionFmt: string;
  avgOfficeHoursFmt: string;  avgOfficeHoursCount: number;
  avgOutsideHoursFmt: string; avgOutsideHoursCount: number;
};
type TicketData = {
  summary: TicketSummary;
  byAgent: AgentStat[];
  ticketTypes: string[];
};

// ── Hardcoded ticket types (shown in dropdown) ─────────────────────────────
const TICKET_TYPES: Record<string, string[]> = {
  cr: [
    "CR - Account Got Flagged But Email Was Not Sent",
    "CR - Need to Respond to Client's Email / Client Missed the Interview",
    "CR - Case Requires Review",
  ],
  bizops: [
    "BO - Change of Payout Address & Method",
    "BO - Client facing RISE Work Issue",
    "BO - Competition KYC",
    "BO - Competition Payout address",
    "BO - Complaint About Discrepancy in Profit Share",
    "BO - KYC/Agreement Sign Done, Yet to Receive FundedNext Account/Unable to Sign Agreement",
    "BO - Max Allocation Issue",
    "BO - Need Update of KYC",
    "BO - Veriff Doesn't Accept KYC Documents / Unable to Submit KYC Documents",
    "BO - Need An Update Of Current Payout",
  ],
};

// ── UI helpers ─────────────────────────────────────────────────────────────
function MetricCard({
  icon, label, value, sub, valueColor,
}: { icon?: string; label: string; value: string | number; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${valueColor ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SlaBar({ rate }: { rate: number }) {
  const color = rate >= 80 ? "bg-green-500" : rate >= 60 ? "bg-amber-400" : "bg-red-500";
  return (
    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
      <div className={`h-3 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${Math.min(rate, 100)}%` }} />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function TicketsTab() {
  const [section,    setSection]    = useState<"cr" | "bizops">("cr");
  const [dateMode,   setDateMode]   = useState<"created" | "resolved">("created");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [ticketType, setTicketType] = useState("");
  const [data,       setData]       = useState<TicketData | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  async function load(
    sec: string,
    mode: string, from: string, to: string,
    tt: string,
  ) {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ section: sec });
      if (mode === "created") {
        if (from) p.set("createdFrom",  from);
        if (to)   p.set("createdTo",    to);
      } else {
        if (from) p.set("resolvedFrom", from);
        if (to)   p.set("resolvedTo",   to);
      }
      if (tt) p.set("type", tt);

      const res  = await fetch(`/api/tickets?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  // Reset + reload on section change
  useEffect(() => {
    setDateMode("created"); setDateFrom(""); setDateTo(""); setTicketType("");
    load(section, "created", "", "", "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const handleApply = () => load(section, dateMode, dateFrom, dateTo, ticketType);
  const handleReset = () => {
    setDateMode("created"); setDateFrom(""); setDateTo(""); setTicketType("");
    load(section, "created", "", "", "");
  };

  // Merge hardcoded types with any extra types found in API data
  const dropdownTypes = [
    ...TICKET_TYPES[section],
    ...(data?.ticketTypes ?? []).filter(t => !TICKET_TYPES[section].includes(t)),
  ];

  const s        = data?.summary;
  const slaRate  = s?.slaComplianceRate ?? 0;
  const slaColor = slaRate >= 80 ? "text-green-600" : slaRate >= 60 ? "text-amber-600" : "text-red-600";

  return (
    <div className="space-y-5">

      {/* ── Section toggle ── */}
      <div className="flex gap-2">
        {([
          { key: "cr",     label: "Case Resolution"     },
          { key: "bizops", label: "Business Operations" },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setSection(key)}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
              section === key
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">🔍 Filters</p>
        <div className="flex flex-wrap items-end gap-3">

          {/* Date mode toggle */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Filter date by</label>
            <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
              <button
                onClick={() => setDateMode("created")}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  dateMode === "created"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}>
                Created Date
              </button>
              <button
                onClick={() => setDateMode("resolved")}
                className={`px-3 py-1.5 font-medium transition-colors border-l border-gray-300 ${
                  dateMode === "resolved"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}>
                Resolved Date
              </button>
            </div>
          </div>

          {/* Date range */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>

          {/* Ticket type */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Ticket Type</label>
            <select value={ticketType} onChange={e => setTicketType(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
              <option value="">All types</option>
              {dropdownTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <button onClick={handleApply}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors">
            Apply
          </button>
          <button onClick={handleReset}
            className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors">
            Reset
          </button>
        </div>

        <p className="text-xs text-gray-400 mt-2">
          {dateMode === "created"
            ? "Filtering by ticket creation date · defaults to last 30 days if no range is set"
            : "Filtering by ticket resolved date · returns tickets closed within the selected range"}
        </p>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="text-2xl mb-2">⏳</div>
            <p className="text-gray-400 text-sm animate-pulse">Fetching tickets from Intercom…</p>
            <p className="text-gray-300 text-xs mt-1">This may take a few seconds</p>
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Data ── */}
      {!loading && s && (
        <div className="space-y-5">

          {/* Row 1 — Counts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard icon="🎫" label="Total Tickets" value={s.total} />
            <MetricCard icon="✅" label="Resolved"      value={s.resolved}  valueColor="text-green-700" />
            <MetricCard icon="🔓" label="Open"          value={s.open}      valueColor="text-amber-600" />
            <MetricCard
              icon="📊" label="SLA Compliance"
              value={`${s.slaComplianceRate}%`}
              sub={`${s.slaMetCount} met · ${s.slaBreachCount} breached`}
              valueColor={slaColor}
            />
          </div>

          {/* Row 2 — Resolution times */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <MetricCard
              icon="⏱️" label="Avg Resolution (All)"
              value={s.avgResolutionFmt}
              sub={`Based on ${s.resolved} resolved tickets`}
            />
            <MetricCard
              icon="🏢" label="Avg Resolution — Office Hours"
              value={s.avgOfficeHoursFmt}
              sub={`Created 9:00 AM – 5:00 PM GMT+6 · ${s.avgOfficeHoursCount} tickets`}
              valueColor="text-blue-700"
            />
            <MetricCard
              icon="🌙" label="Avg Resolution — Outside Hours"
              value={s.avgOutsideHoursFmt}
              sub={`Created 5:01 PM – 8:59 AM GMT+6 · ${s.avgOutsideHoursCount} tickets`}
              valueColor="text-purple-700"
            />
          </div>

          {/* SLA overview */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-semibold text-gray-900 text-sm">SLA Overview</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  24-hour SLA — every ticket must be resolved within 24 hours of creation
                </p>
              </div>
              <span className={`text-3xl font-bold ${slaColor}`}>{s.slaComplianceRate}%</span>
            </div>
            <SlaBar rate={slaRate} />
            <div className="flex justify-between mt-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
                <span className="text-gray-600">SLA Met</span>
                <span className="font-bold text-green-700 text-lg">{s.slaMetCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-red-600 text-lg">{s.slaBreachCount}</span>
                <span className="text-gray-600">SLA Breached</span>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
              </div>
            </div>
          </div>

          {/* Agent table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900 text-sm">Resolved by Agent</p>
                <p className="text-xs text-gray-400 mt-0.5">Resolution performance per Intercom agent</p>
              </div>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                {data!.byAgent.length} agents
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-900 text-white">
                    {["Agent","Resolved","Avg Resolution","SLA Met","SLA Breaches","SLA Rate"].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data!.byAgent.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                        No resolved tickets in this period
                      </td>
                    </tr>
                  ) : data!.byAgent.map((ag, i) => (
                    <tr key={ag.name} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="px-4 py-3 font-medium text-gray-900">{ag.name}</td>
                      <td className="px-4 py-3 font-bold text-gray-900">{ag.resolved}</td>
                      <td className="px-4 py-3 text-gray-700 font-medium">{ag.avgResolutionFmt}</td>
                      <td className="px-4 py-3 text-green-700 font-semibold">{ag.slaMet}</td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${ag.slaBreaches > 0 ? "text-red-600" : "text-gray-400"}`}>
                          {ag.slaBreaches}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-[110px]">
                          <span className={`text-sm font-bold w-12 ${
                            ag.slaRate >= 80 ? "text-green-700" : ag.slaRate >= 60 ? "text-amber-600" : "text-red-600"
                          }`}>
                            {ag.slaRate}%
                          </span>
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-1.5 rounded-full ${
                                ag.slaRate >= 80 ? "bg-green-500" : ag.slaRate >= 60 ? "bg-amber-400" : "bg-red-500"
                              }`}
                              style={{ width: `${ag.slaRate}%` }}
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
