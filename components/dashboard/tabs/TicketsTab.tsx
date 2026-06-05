"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

// ── Types ──────────────────────────────────────────────────────────────────
type AgentStat = {
  name: string; resolved: number; avgResolutionFmt: string;
  slaMet: number; slaBreaches: number; slaRate: number;
};
type BreachDetail = {
  id: string; ticketId: string | number; ticketLink: string;
  contactRef: string; ticketType: string;
  createdAt: number; resolvedAt: number;
  resolutionTimeFmt: string; resolvedBy: string;
};
type TicketData = {
  summary: {
    total: number; resolved: number; open: number;
    slaMetCount: number; slaBreachCount: number; slaComplianceRate: number;
    avgResolutionFmt: string;
    avgOfficeHoursFmt: string;  avgOfficeHoursCount: number;
    avgOutsideHoursFmt: string; avgOutsideHoursCount: number;
  };
  byAgent:          AgentStat[];
  ticketTypes:      string[];
  ticketTypeStats:  { name: string; count: number }[];
  slaBreachDetails: BreachDetail[];
};

type SectionState = {
  data:       TicketData | null;
  loading:    boolean;
  error:      string | null;
  dateMode:   "created" | "resolved";
  dateFrom:   string;
  dateTo:     string;
  ticketType: string;
};

const DEFAULT_SECTION: SectionState = {
  data: null, loading: false, error: null,
  dateMode: "created", dateFrom: "", dateTo: "", ticketType: "",
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTS(ts: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("en-GB", {
    timeZone:    "Asia/Dhaka",
    day:   "2-digit", month: "short", year: "numeric",
    hour:  "2-digit", minute: "2-digit", hour12: false,
  });
}

function MetricCard({ icon, label, value, sub, valueColor }: {
  icon?: string; label: string; value: string | number; sub?: string; valueColor?: string;
}) {
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
  const [section,   setSection]   = useState<"cr" | "bizops">("cr");
  const [crState,   setCrState]   = useState<SectionState>({ ...DEFAULT_SECTION });
  const [boState,   setBoState]   = useState<SectionState>({ ...DEFAULT_SECTION });
  const [showBreachTable, setShowBreachTable] = useState(false);

  const cur    = section === "cr" ? crState   : boState;
  const setCur = section === "cr" ? setCrState : setBoState;

  async function load(sec: string, st: SectionState) {
    const setter = sec === "cr" ? setCrState : setBoState;
    setter(prev => ({ ...prev, loading: true, error: null }));
    try {
      const p = new URLSearchParams({ section: sec });
      if (st.dateMode === "created") {
        if (st.dateFrom) p.set("createdFrom",  st.dateFrom);
        if (st.dateTo)   p.set("createdTo",    st.dateTo);
      } else {
        if (st.dateFrom) p.set("resolvedFrom", st.dateFrom);
        if (st.dateTo)   p.set("resolvedTo",   st.dateTo);
      }
      if (st.ticketType) p.set("type", st.ticketType);
      const res  = await fetch(`/api/tickets?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setter(prev => ({ ...prev, data: json, loading: false }));
    } catch (e) {
      setter(prev => ({ ...prev, error: e instanceof Error ? e.message : "Error", loading: false }));
    }
  }

  // Auto-load section on first visit
  useEffect(() => {
    if (!cur.data && !cur.loading) load(section, cur);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const handleApply = () => load(section, cur);
  const handleReset = () => {
    const fresh: SectionState = { ...DEFAULT_SECTION };
    setCur(fresh);
    setTimeout(() => load(section, fresh), 0);
  };

  const s         = cur.data?.summary;
  const slaRate   = s?.slaComplianceRate ?? 0;
  const slaColor  = slaRate >= 80 ? "text-green-600" : slaRate >= 60 ? "text-amber-600" : "text-red-600";
  // Filter out "Unassigned" from display table
  const agentRows = (cur.data?.byAgent ?? []).filter(a => a.name !== "Unassigned");
  const unassigned = (cur.data?.byAgent ?? []).find(a => a.name === "Unassigned");

  // Chart colours
  const chartColors = ["#6366f1","#8b5cf6","#ec4899","#f59e0b","#10b981","#3b82f6","#ef4444","#14b8a6","#f97316","#84cc16"];

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
              section === key ? "bg-indigo-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">🔍 Filters</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Filter date by</label>
            <div className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
              {(["created", "resolved"] as const).map(m => (
                <button key={m} onClick={() => setCur(prev => ({ ...prev, dateMode: m }))}
                  className={`px-3 py-1.5 font-medium transition-colors capitalize ${
                    cur.dateMode === m ? "bg-indigo-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  } ${m === "resolved" ? "border-l border-gray-300" : ""}`}>
                  {m} Date
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={cur.dateFrom}
              onChange={e => setCur(prev => ({ ...prev, dateFrom: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={cur.dateTo}
              onChange={e => setCur(prev => ({ ...prev, dateTo: e.target.value }))}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Ticket Type</label>
            <select value={cur.ticketType}
              onChange={e => setCur(prev => ({ ...prev, ticketType: e.target.value }))}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
              <option value="">All types</option>
              {(cur.data?.ticketTypes ?? []).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <button onClick={handleApply} disabled={cur.loading}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-60 transition-colors">
            {cur.loading ? "Loading…" : "Apply"}
          </button>
          <button onClick={handleReset} disabled={cur.loading}
            className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 disabled:opacity-60 transition-colors">
            Reset
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          {cur.dateMode === "created"
            ? "Filtering by ticket creation date · defaults to last 30 days"
            : "Filtering by resolved date · returns tickets closed in the selected range"}
        </p>
      </div>

      {/* ── Loading overlay ── */}
      {cur.loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-500 text-sm">Fetching tickets from Intercom…</p>
            <p className="text-gray-400 text-xs mt-1">Large date ranges may take a few seconds</p>
          </div>
        </div>
      )}

      {cur.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          <strong>Error:</strong> {cur.error}
        </div>
      )}

      {/* ── Data (show even while refreshing for persistence) ── */}
      {!cur.loading && s && (
        <div className="space-y-5">

          {/* Row 1 — Counts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard icon="🎫" label="Total Tickets" value={s.total} />
            <MetricCard icon="✅" label="Resolved"      value={s.resolved}  valueColor="text-green-700" />
            <MetricCard icon="🔓" label="Open"          value={s.open}      valueColor="text-amber-600" />
            <MetricCard icon="📊" label="SLA Compliance"
              value={`${s.slaComplianceRate}%`}
              sub={`${s.slaMetCount} met · ${s.slaBreachCount} breached`}
              valueColor={slaColor}
            />
          </div>

          {/* Row 2 — Resolution times */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <MetricCard icon="⏱️" label="Avg Resolution (All)"
              value={s.avgResolutionFmt}
              sub={`Based on ${s.resolved} resolved tickets`}
            />
            <MetricCard icon="🏢" label="Avg Resolution — Office Hours"
              value={s.avgOfficeHoursFmt}
              sub={`Created 9:00 AM – 5:00 PM GMT+6 · ${s.avgOfficeHoursCount} tickets`}
              valueColor="text-blue-700"
            />
            <MetricCard icon="🌙" label="Avg Resolution — Outside Hours"
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
                <p className="text-xs text-gray-400 mt-0.5">24-hour SLA — every ticket must be resolved within 24 hours of creation</p>
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
              <div className="flex items-center gap-3">
                {unassigned && (
                  <span className="text-xs text-gray-400">
                    +{unassigned.resolved} unassigned
                  </span>
                )}
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                  {agentRows.length} agents
                </span>
              </div>
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
                  {agentRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">No resolved tickets in this period</td></tr>
                  ) : agentRows.map((ag, i) => (
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
                          }`}>{ag.slaRate}%</span>
                          <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                            <div className={`h-1.5 rounded-full ${
                              ag.slaRate >= 80 ? "bg-green-500" : ag.slaRate >= 60 ? "bg-amber-400" : "bg-red-500"
                            }`} style={{ width: `${ag.slaRate}%` }} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Ticket Type Distribution chart ── */}
          {(cur.data?.ticketTypeStats?.length ?? 0) > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
              <p className="font-semibold text-gray-900 text-sm mb-1">Ticket Type Distribution</p>
              <p className="text-xs text-gray-400 mb-4">Frequency of ticket types in selected period</p>
              <ResponsiveContainer width="100%" height={Math.max(200, (cur.data?.ticketTypeStats?.length ?? 0) * 42)}>
                <BarChart
                  data={cur.data?.ticketTypeStats}
                  layout="vertical"
                  margin={{ top: 0, right: 40, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category" dataKey="name" width={280}
                    tick={{ fontSize: 11, fill: "#374151" }} tickLine={false} axisLine={false}
                  />
                  <Tooltip
                    formatter={(v: any) => [v, "Tickets"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {(cur.data?.ticketTypeStats ?? []).map((_, idx) => (
                      <Cell key={idx} fill={chartColors[idx % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── SLA Breach Details ── */}
          {(cur.data?.slaBreachDetails?.length ?? 0) > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900 text-sm">⚠️ SLA Breach Details</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {cur.data?.slaBreachDetails?.length} tickets that exceeded 24-hour SLA · sorted by longest resolution first
                  </p>
                </div>
                <button
                  onClick={() => setShowBreachTable(v => !v)}
                  className="text-xs text-indigo-600 font-medium hover:underline"
                >
                  {showBreachTable ? "Hide" : "Show"} details
                </button>
              </div>

              {showBreachTable && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-900 text-white">
                        {["Ticket #","Type","Contact Ref","Created","Resolved","Duration","Resolved By"].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cur.data?.slaBreachDetails?.map((b, i) => (
                        <tr key={b.id} className={i % 2 === 0 ? "bg-white" : "bg-red-50/40"}>
                          <td className="px-4 py-2.5">
                            
                              href={b.ticketLink}
                              target="_blank"
                              
                            <a href={b.ticketLink} target="_blank" rel="noopener noreferrer" className={`text-indigo-600 hover:underline font-medium text-xs`}>{"#"}{b.ticketId}</a>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-600 max-w-[180px] truncate" title={b.ticketType}>
                            {b.ticketType}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-600 font-mono">{b.contactRef}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtTS(b.createdAt)}</td>
                          <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtTS(b.resolvedAt)}</td>
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-red-600 text-xs">{b.resolutionTimeFmt}</span>
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-700 font-medium whitespace-nowrap">{b.resolvedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
