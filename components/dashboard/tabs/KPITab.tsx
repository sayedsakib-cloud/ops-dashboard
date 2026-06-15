"use client";
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// Parse FRT string (e.g. "5h 3m", "36m", "1d 6h") to decimal hours
function parseFrtHours(s: string): number {
  if (!s || s === "--") return Infinity;
  let h = 0;
  const d  = s.match(/(\d+)d/); if (d)  h += parseInt(d[1])  * 24;
  const hr = s.match(/(\d+)h/); if (hr) h += parseInt(hr[1]);
  const m  = s.match(/(\d+)m/); if (m)  h += parseInt(m[1])  / 60;
  return h > 0 ? h : Infinity;
}
function frtStatus(frt: string): { label: string; cls: string } {
  const h = parseFrtHours(frt);
  if (h === Infinity) return { label: "--", cls: "" };
  if (h <= 1) return { label: "Super Green", cls: "bg-emerald-400 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap" };
  if (h <= 2) return { label: "Green",       cls: "bg-green-500 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap" };
  if (h <= 4) return { label: "Yellow",      cls: "bg-amber-400 text-gray-900 text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap" };
  return       { label: "Red",          cls: "bg-red-400 text-white text-xs font-semibold px-3 py-1 rounded-full whitespace-nowrap" };
}

// ── Types ──────────────────────────────────────────────────────────────────
type IndivRow = {
  weekStart: string; weekEnd: string; quarter: string; name: string;
  complexityGroup: string; frtSpeed: string; frtCount: string;
  complexity: string; emailCount: string; quality: string;
  qcErrors: string; remarks: string;
};
type TeamRow = {
  weekStart: string; weekEnd: string; quarter: string;
  negReviewPct: string; totalReviews: string; stakeholderMgmt: string; remarks: string;
};
type QtrAgent  = { name: string; Q2: number|null; Q3: number|null; Q4: number|null };
type KPIData   = {
  filterStart: string; filterEnd: string;
  weekRanges:  { start: string; end: string }[];
  allAgents:   string[];
  summary:     { totalEmailVolume: number; avgNegReview: number|null; tpReviewsCount: number; agentsActive: number };
  individualPerformance: IndivRow[];
  teamKPI:     TeamRow[];
  quarterly:   { availableQuarters: string[]; agents: QtrAgent[] };
};
type BAUData = { headers: string[]; rows: string[][]; total: number; filtered: number };

// ── Badge helpers ──────────────────────────────────────────────────────────
function frtClass(v: string) {
  const s = v.toLowerCase();
  if (s.startsWith("under 2")) return "bg-green-100 text-green-800";
  if (s.startsWith("2+"))      return "bg-teal-100 text-teal-800";
  if (s.startsWith("3+"))      return "bg-amber-100 text-amber-800";
  if (s.startsWith("4+"))      return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-600";
}
function complexityClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes("12% and above"))            return "bg-green-100 text-green-800";
  if (s.includes("above 9%"))                 return "bg-lime-100 text-lime-800";
  if (s.includes("9%") && s.includes("11%")) return "bg-yellow-100 text-yellow-800";
  if (s.includes("7%") || s.includes("8%"))  return "bg-orange-100 text-orange-800";
  if (s.includes("below 5%"))                return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-600";
}
function qcClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes("no qc") || s.includes("no issues")) return "bg-green-50 text-green-700 border border-green-200";
  if (s.includes("critical") || s.includes("refund"))  return "bg-red-100 text-red-800";
  if (s.includes("major"))                              return "bg-orange-100 text-orange-800";
  if (s.includes("1") && s.includes("error"))           return "bg-yellow-100 text-yellow-800";
  return "bg-gray-100 text-gray-600";
}
function stakeholderClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes("3% or more")) return "bg-red-100 text-red-800";
  if (s.includes("2%"))         return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-600";
}
function qcDisplay(v: string) {
  return v.toLowerCase().includes("no qc") ? "✓ No Issues" : (v || "—");
}

// ── Shared UI helpers ──────────────────────────────────────────────────────
const PALETTE = [
  "bg-indigo-500","bg-purple-500","bg-pink-500","bg-blue-500",
  "bg-teal-500","bg-emerald-500","bg-orange-500","bg-rose-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function Avatar({ name }: { name: string }) {
  return (
    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 ${avatarColor(name)}`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}
function Badge({ val, cls }: { val: string; cls: string }) {
  if (!val) return <span className="text-gray-400 text-xs">—</span>;
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{val}</span>;
}
function StatCard({ icon, label, value }: { icon: string; label: string; value: string|number }) {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span>{icon}</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value ?? "—"}</div>
    </div>
  );
}
function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="bg-gray-900 text-white">
        {cols.map(c => (
          <th key={c} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}
function rankLabel(i: number) {
  if (i === 0) return "🥇"; if (i === 1) return "🥈"; if (i === 2) return "🥉";
  return `#${i + 1}`;
}

// ── BAU Section ────────────────────────────────────────────────────────────
// Sub-tabs keep their data when switching between them (no reload on switch back)
const PAGE_SIZE = 50;

function BAUSection() {
  const [bauTab, setBauTab] = useState<"regular" | "hireflix">("regular");
  // Track whether each sub-tab has ever been visited
  const [hirelixLoaded, setHirelixLoaded] = useState(false);

  // ── Per sub-tab data (prevents re-fetch on switch back) ──────────────────
  const [regularData,    setRegularData]    = useState<BAUData | null>(null);
  const [regularLoading, setRegularLoading] = useState(false);
  const [regularError,   setRegularError]   = useState<string | null>(null);
  const [regularFrom,    setRegularFrom]    = useState("");
  const [regularTo,      setRegularTo]      = useState("");
  const [regularName,    setRegularName]    = useState("");
  const [regularPage,    setRegularPage]    = useState(1);

  const [hirelixData,    setHirelixData]    = useState<BAUData | null>(null);
  const [hirelixLoading, setHirelixLoading] = useState(false);
  const [hirelixError,   setHirelixError]   = useState<string | null>(null);
  const [hirelixFrom,    setHirelixFrom]    = useState("");
  const [hirelixTo,      setHirelixTo]      = useState("");
  const [hirelixName,    setHirelixName]    = useState("");
  const [hirelixPage,    setHirelixPage]    = useState(1);

  async function loadTab(tab: string, from: string, to: string, name: string) {
    const setData    = tab === "regular" ? setRegularData    : setHirelixData;
    const setLoading = tab === "regular" ? setRegularLoading : setHirelixLoading;
    const setError   = tab === "regular" ? setRegularError   : setHirelixError;
    const setPage    = tab === "regular" ? setRegularPage    : setHirelixPage;

    setLoading(true); setError(null); setPage(1);
    try {
      const p = new URLSearchParams({ tab });
      if (from) p.set("from", from);
      if (to)   p.set("to",   to);
      if (name) p.set("name", name);
      const res  = await fetch(`/api/tasks?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  // Load regular tab on first mount
  useEffect(() => { loadTab("regular", "", "", ""); }, []);

  function switchBauTab(tab: "regular" | "hireflix") {
    setBauTab(tab);
    // Only load hireflix the first time it's visited
    if (tab === "hireflix" && !hirelixLoaded) {
      setHirelixLoaded(true);
      loadTab("hireflix", "", "", "");
    }
  }

  // Current tab helpers for the shared filter UI
  const isReg  = bauTab === "regular";
  const curFrom    = isReg ? regularFrom    : hirelixFrom;
  const curTo      = isReg ? regularTo      : hirelixTo;
  const curName    = isReg ? regularName    : hirelixName;
  const setCurFrom = isReg ? setRegularFrom : setHirelixFrom;
  const setCurTo   = isReg ? setRegularTo   : setHirelixTo;
  const setCurName = isReg ? setRegularName : setHirelixName;

  function handleApply()  { loadTab(bauTab, curFrom, curTo, curName); }
  function handleReset()  {
    setCurFrom(""); setCurTo(""); setCurName("");
    loadTab(bauTab, "", "", "");
  }

  function renderTable(data: BAUData | null, loading: boolean, error: string | null, page: number, setPage: (p: number) => void, totalLabel: string) {
    if (loading) return (
      <div className="flex items-center justify-center py-8">
        <span className="text-gray-400 text-sm animate-pulse">Loading...</span>
      </div>
    );
    if (error) return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
        Error: {error}
      </div>
    );
    if (!data) return null;

    // Find name/agent column for by-name summary
    const nameIdx = data.headers.findIndex(h =>
      h.toLowerCase().includes("name") || h.toLowerCase().includes("agent")
    );
    // Value column = the count column (Final Count / Initial Email Count).
    // The API always returns it as the last column.
    const valueIdx = data.headers.findIndex(h => /count/i.test(h));

    // Value column = the count column (Final Count / Initial Email Count).
    // The API always returns it as the last column.
    //const valueIdx = data.headers.findIndex(h => /count/i.test(h));
    const vIdx = valueIdx >= 0 ? valueIdx : data.headers.length - 1;
    const numOf = (v: string) => {
      const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
      return isNaN(n) ? 0 : n;
    };
    const byName = new Map<string, number>();
    if (nameIdx >= 0) {
      data.rows.forEach(row => {
        const n = row[nameIdx] || "Unknown";
        byName.set(n, (byName.get(n) || 0) + numOf(row[vIdx]));
      });
    }
    const nameSummary = [...byName.entries()].sort((a, b) => b[1] - a[1]);
    const grandTotal = data.rows.reduce((acc, row) => acc + numOf(row[vIdx]), 0);

    const totalPages = Math.ceil(data.rows.length / PAGE_SIZE);
    const pagedRows  = data.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
      <div className="space-y-4">

        {/* Total count card */}
        <div className="bg-white rounded-lg p-5 shadow-sm border border-gray-100 inline-block min-w-[220px]">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{totalLabel}</p>
          <p className="text-3xl font-bold text-gray-900">{grandTotal.toLocaleString()}</p>
        </div>

        {/* By-name summary table */}
        {nameSummary.length > 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-sm">Count by Name</p>
              <p className="text-xs text-gray-400 mt-0.5">Filtered period totals per teammate</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <THead cols={[nameIdx >= 0 ? data.headers[nameIdx] : "Name", "Count"]} />
                <tbody>
                  {nameSummary.map(([name, count], i) => (
                    <tr key={name} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{name}</td>
                      <td className="px-4 py-2.5 font-bold text-gray-900 text-right pr-10">{count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* Collapsible full records */}
        <details className="group">
          <summary className="bg-white rounded-lg shadow-sm border border-gray-100 px-5 py-3 flex items-center justify-between cursor-pointer list-none hover:bg-gray-50 transition-colors select-none">
            <span className="text-sm font-semibold text-gray-800">
              View all records ({data.filtered.toLocaleString()} of {data.total.toLocaleString()})
            </span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </summary>
          <div className="mt-2 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            {totalPages > 1 ? (
              <div className="px-5 py-2 border-b border-gray-100 flex items-center justify-end gap-2 text-sm text-gray-600">
                <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}
                  className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
                  {"<"}
                </button>
                <span className="text-xs">Page {page} / {totalPages}</span>
                <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}
                  className="w-7 h-7 flex items-center justify-center rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50">
                  {">"}
                </button>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <THead cols={data.headers} />
                <tbody>
                  {pagedRows.length === 0 ? (
                    <tr><td colSpan={data.headers.length} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
                  ) : pagedRows.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      {row.map((cell, j) => (
                        <td key={j} className="px-4 py-2.5 text-gray-700 whitespace-nowrap text-sm">
                          {cell || "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>

      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab buttons */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: "regular",  label: "📋 Regular Task Report" },
          { key: "hireflix", label: "🎯 Hireflix Count"       },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => switchBauTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              bauTab === key
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Shared filter bar */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">📅 Date Range Filter</p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From date</label>
            <input type="date" value={curFrom} onChange={e => setCurFrom(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To date</label>
            <input type="date" value={curTo} onChange={e => setCurTo(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-gray-500 mb-1">Filter by name</label>
            <input type="text" value={curName} onChange={e => setCurName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleApply()}
              placeholder="All agents…"
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
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
        <p className="text-xs text-gray-400 mt-2">Filtering on column: Date</p>
      </div>

      {/* Sub-tab content — keep-mounted with inline style toggle */}
      <div style={{ display: bauTab === "regular" ? "block" : "none" }}>
        {renderTable(regularData, regularLoading, regularError, regularPage, setRegularPage, "Total Task Count")}
      </div>
      <div style={{ display: bauTab === "hireflix" ? "block" : "none" }}>
        {hirelixLoaded ? renderTable(hirelixData, hirelixLoading, hirelixError, hirelixPage, setHirelixPage, "Total Hireflix Count") : null}
      </div>
    </div>
  );
}

// ── Main KPI Tab ───────────────────────────────────────────────────────────
export default function KPITab() {
  const [section,        setSection]        = useState<"kpi" | "bau">("kpi");
  const [bauEverMounted, setBauEverMounted] = useState(false);

  // KPI data state
  const [data,     setData]    = useState<KPIData | null>(null);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState<string | null>(null);
  const [fromDate, setFrom]    = useState("");
  const [toDate,   setTo]      = useState("");
  const [agent,    setAgent]   = useState("all");
  const [quarter,  setQuarter] = useState("Q2");

  async function loadKPI(f?: string, t?: string, a?: string) {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (f) p.set("startDate", f);
      if (t) p.set("endDate",   t);
      if (a && a !== "all") p.set("agent", a);
      const res  = await fetch(`/api/kpi?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setData(json);
      setFrom(json.filterStart ?? "");
      setTo(json.filterEnd   ?? "");
      if (json.quarterly?.availableQuarters?.length > 0) {
        setQuarter(q =>
          json.quarterly.availableQuarters.includes(q)
            ? q
            : json.quarterly.availableQuarters[0]
        );
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadKPI(); }, []);

  // Handle section toggle — lazy-mount BAU
  function handleSectionSwitch(s: "kpi" | "bau") {
    setSection(s);
    if (s === "bau") setBauEverMounted(true);
  }

  // Quarterly leaderboard
  const qtrAgents = (data?.quarterly.agents ?? [])
    .map(a => ({ ...a, score: a[quarter as "Q2"|"Q3"|"Q4"] }))
    .filter(a => a.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const scores  = qtrAgents.map(a => a.score ?? 0);
  const qtrAvg  = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 0;
  const qtrMax  = scores.length ? Math.max(...scores) : 0;
  const qtrMin  = scores.length ? Math.min(...scores) : 0;

  return (
    <div className="space-y-5">

      {/* ── Top section toggle ── */}
      <div className="flex gap-2">
        {([
          { key: "kpi", label: "CR Pax KPI DB & CR Team KPI DB" },
          { key: "bau", label: "CR BAU"                          },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => handleSectionSwitch(key)}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors ${
              section === key
                ? "bg-indigo-600 text-white shadow-sm"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── CR BAU — lazy-mount, then keep alive ── */}
      <div style={{ display: section === "bau" ? "block" : "none" }}>
        {bauEverMounted && <BAUSection />}
      </div>

      {/* ── KPI content — always mounted (default section) ── */}
      <div style={{ display: section === "kpi" ? "block" : "none" }}>

        {loading && (
          <div className="flex items-center justify-center h-64">
            <span className="text-gray-400 text-sm animate-pulse">Loading KPI data…</span>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            Error: {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-8">

            {/* ══ SECTION 1 ══ */}
            <section className="space-y-4">

              {/* Filter bar */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">📅 Date Range Filter</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">From (week start)</label>
                    <input type="date" value={fromDate} onChange={e => setFrom(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">To (week end)</label>
                    <input type="date" value={toDate} onChange={e => setTo(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Filter by agent name</label>
                    <select value={agent} onChange={e => setAgent(e.target.value)}
                      className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none min-w-[140px]">
                      <option value="all">All agents…</option>
                      {data.allAgents.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  <button onClick={() => loadKPI(fromDate, toDate, agent)}
                    className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors">
                    Apply
                  </button>
                  <button onClick={() => { setAgent("all"); loadKPI(); }}
                    className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors">
                    Reset
                  </button>
                </div>
                {data.filterStart && data.filterEnd && (
                  <p className="text-xs text-gray-400 mt-3">
                    Showing: <span className="font-medium text-gray-600">{data.filterStart}</span>
                    {" to "}
                    <span className="font-medium text-gray-600">{data.filterEnd}</span>
                  </p>
                )}
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon="📧" label="Total Email Volume"
                  value={data.summary.totalEmailVolume.toLocaleString()} />
                <StatCard icon="⭐" label="Avg Neg. Review %"
                  value={data.summary.avgNegReview !== null ? `${data.summary.avgNegReview}%` : "—"} />
                <StatCard icon="📝" label="TP Reviews Count"
                  value={data.summary.tpReviewsCount} />
                <StatCard icon="👥" label="Agents Active"
                  value={data.summary.agentsActive} />
              </div>

              {/* Individual performance table */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Individual Weekly Performance</p>
                    <p className="text-xs text-gray-400 mt-0.5">Metrics by agent - CR Pax KPI DB</p>
                  </div>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                    {data.individualPerformance.length} agents
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <THead cols={["Agent","Group","Email Vol.","FRT Count","Status","EC Complexity","QC Grade","Remarks"]} />
                    <tbody>
                      {data.individualPerformance.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No data for selected period</td></tr>
                      ) : data.individualPerformance.map((row, i) => {
                        const st = frtStatus(row.frtCount);
                        return (
                          <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Avatar name={row.name} />
                                <div>
                                  <div className="font-medium text-gray-900 text-sm">{row.name}</div>
                                  <div className="text-xs text-gray-400">{row.quarter}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">{row.complexityGroup || "—"}</td>
                            <td className="px-4 py-3 text-right font-semibold text-gray-900">{row.emailCount || "—"}</td>
                            <td className="px-4 py-3 font-medium text-gray-700">{row.frtCount || "—"}</td>
                            <td className="px-4 py-3">
                              {st.label === "--" ? (
                                <span className="text-gray-400 text-xs">—</span>
                              ) : (
                                <span className={st.cls}>{st.label}</span>
                              )}
                            </td>
                            <td className="px-4 py-3"><Badge val={row.complexity} cls={complexityClass(row.complexity)} /></td>
                            <td className="px-4 py-3"><Badge val={qcDisplay(row.quality)} cls={qcClass(row.quality)} /></td>
                            <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={row.remarks}>
                              {row.remarks || "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Team KPI table */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Team KPI DB Summary</p>
                    <p className="text-xs text-gray-400 mt-0.5">High-level operations monitoring - CR Team KPI DB</p>
                  </div>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                    {data.teamKPI.length} records
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <THead cols={["Period","QTR","Neg. Review %","TP Reviews","Stakeholder Mgmt","Remarks"]} />
                    <tbody>
                      {data.teamKPI.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No data for selected period</td></tr>
                      ) : data.teamKPI.map((row, i) => (
                        <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                          <td className="px-4 py-3 font-medium text-gray-800">{row.weekStart}{" to "}{row.weekEnd}</td>
                          <td className="px-4 py-3 text-gray-600 font-medium">{row.quarter}</td>
                          <td className="px-4 py-3">
                            <span className={`font-semibold ${parseFloat(row.negReviewPct) >= 3 ? "text-red-600" : "text-amber-600"}`}>
                              {row.negReviewPct || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-semibold text-gray-900">{row.totalReviews || "—"}</td>
                          <td className="px-4 py-3">
                            <Badge val={row.stakeholderMgmt} cls={stakeholderClass(row.stakeholderMgmt)} />
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500 max-w-[200px] truncate" title={row.remarks}>
                            {row.remarks || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            <div className="border-t border-gray-200" />

            {/* ══ SECTION 2: CR Quarterly Avg. Points ══ */}
            <section className="space-y-4">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-widest">
                CR Quarterly Avg. Points
              </h2>

              {/* Quarter pills */}
              <div className="flex gap-2">
                {(data.quarterly.availableQuarters.length > 0
                  ? data.quarterly.availableQuarters
                  : ["Q2","Q3","Q4"]
                ).map(q => (
                  <button key={q} onClick={() => setQuarter(q)}
                    className={`px-5 py-1.5 rounded-full text-sm font-semibold transition-colors ${
                      quarter === q
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}>
                    {q}
                  </button>
                ))}
              </div>

              {/* Quarterly summary */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon="👥" label="Agents Tracked" value={qtrAgents.length} />
                <StatCard icon="📊" label="Average Score"  value={qtrAvg || "—"} />
                <StatCard icon="🏆" label="Highest Score"  value={qtrMax || "—"} />
                <StatCard icon="📉" label="Lowest Score"   value={qtrMin || "—"} />
              </div>

              {/* Leaderboard */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">Agent Points — {quarter}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Average performance scores - {quarter}</p>
                  </div>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full font-medium">
                    {qtrAgents.length} agents
                  </span>
                </div>
                <div className="grid grid-cols-12 bg-gray-900 text-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wide">
                  <div className="col-span-1">Rank</div>
                  <div className="col-span-3">Agent</div>
                  <div className="col-span-8">Score</div>
                </div>
                {qtrAgents.length === 0 ? (
                  <div className="px-5 py-10 text-center text-gray-400 text-sm">No data for {quarter}</div>
                ) : qtrAgents.map((a, i) => {
                  const score = a.score ?? 0;
                  const top3  = i < 3;
                  return (
                    <div key={a.name}
                      className={`grid grid-cols-12 items-center px-5 py-4 border-b border-gray-50 last:border-0 ${
                        i % 2 === 0 ? "bg-white" : "bg-gray-50/50"
                      }`}>
                      <div className="col-span-1 text-sm font-bold text-gray-600">{rankLabel(i)}</div>
                      <div className="col-span-3 flex items-center gap-2">
                        <Avatar name={a.name} />
                        <div>
                          <div className="font-semibold text-gray-900 text-sm">{a.name}</div>
                          <div className="text-xs text-gray-400">{quarter}</div>
                        </div>
                      </div>
                      <div className="col-span-8 flex items-center gap-3">
                        <span className={`text-base font-bold w-12 text-right ${top3 ? "text-indigo-600" : "text-amber-600"}`}>
                          {score.toFixed(2)}
                        </span>
                        <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-2.5 rounded-full transition-all duration-500 ${top3 ? "bg-indigo-500" : "bg-amber-400"}`}
                            style={{ width: `${Math.min((score / 3) * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
