"use client";
import { useEffect, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────
type AgentRow = {
  name: string;
  assigned: number; repliedTo: number; repliesSent: number; closed: number;
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

// ── Avatar ─────────────────────────────────────────────────────────────────
const PALETTE = [
  "bg-indigo-500","bg-purple-500","bg-pink-500","bg-blue-500",
  "bg-teal-500","bg-emerald-500","bg-orange-500","bg-rose-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "xs" }) {
  const cls = size === "xs" ? "w-6 h-6 text-xs" : "w-7 h-7 text-sm";
  return (
    <div className={`${cls} ${avatarColor(name)} rounded-full flex items-center justify-center text-white font-bold flex-shrink-0`}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── Info tooltip (native title attribute — Turbopack-safe) ─────────────────
function Tip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="inline-flex w-4 h-4 rounded-full bg-gray-300 text-gray-600 items-center justify-center text-xs font-bold cursor-help ml-1 hover:bg-gray-400 transition-colors flex-shrink-0 align-middle"
    >
      i
    </span>
  );
}

// ── Summary card ───────────────────────────────────────────────────────────
function Card({
  label, tip, value, valueColor, sub, children,
}: {
  label: string;
  tip?: string;
  value?: string | number;
  valueColor?: string;
  sub?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg p-4 shadow-sm border border-gray-100">
      <div className="flex items-center gap-0.5 mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        {tip ? <Tip text={tip} /> : null}
      </div>
      {value !== undefined ? (
        <p className={`text-2xl font-bold ${valueColor ?? "text-gray-900"}`}>{value}</p>
      ) : null}
      {sub ? <p className="text-xs text-gray-400 mt-1">{sub}</p> : null}
      {children}
    </div>
  );
}

// ── SLA bar ────────────────────────────────────────────────────────────────
function SlaBar({ rate }: { rate: number }) {
  const color = rate >= 80 ? "bg-green-500" : rate >= 60 ? "bg-amber-400" : "bg-red-500";
  const text  = rate >= 80 ? "text-green-600" : rate >= 60 ? "text-amber-600" : "text-red-600";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={`text-xs font-bold ${text}`}>{rate}%</span>
    </div>
  );
}

// ── Table header ───────────────────────────────────────────────────────────
type ColSpec = { label: string; tip?: string };

function TH({ cols }: { cols: Array<string | ColSpec> }) {
  return (
    <thead>
      <tr className="bg-gray-900 text-white">
        {cols.map(col => {
          const lbl = typeof col === "string" ? col : col.label;
          const tip = typeof col === "string" ? undefined : col.tip;
          return (
            <th key={lbl} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide whitespace-nowrap">
              {tip ? (
                <span className="inline-flex items-center gap-1">
                  {lbl}
                  <Tip text={tip} />
                </span>
              ) : lbl}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function TradingEthicsTab() {
  const [data,    setData]    = useState<TeepData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [from,    setFrom]    = useState("");
  const [to,      setTo]      = useState("");

  async function load(start?: string, end?: string) {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (start) p.set("startDate", start);
      if (end)   p.set("endDate",   end);
      const res  = await fetch("/api/teep" + (p.toString() ? "?" + p.toString() : ""));
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const s = data?.summary;

  const TIP_CLOSED      = "Based on admin_assignee_id and teammates at close time. Conversations closed without formal assignment may not be fully captured — typically around 10% below Intercom's Closed by teammates metric due to public API limitations.";
  const TIP_FRT         = "Time from conversation creation to first human agent reply (time_to_admin_reply). Attributed to the primary handler only. May differ slightly from Intercom which uses agent-level assignment timestamps.";
  const TIP_HANDLING    = "time_to_first_close minus time_to_admin_reply (first reply to close). Intercom measures from agent assignment to close using parts-level data not available via the public API.";
  const TIP_ATF         = "time_to_admin_reply minus time_to_assignment. May be inaccurate if conversations are auto-assigned to team (time_to_assignment near 0) rather than directly to the individual agent.";
  const TIP_REPLIED_HR  = "Conversations replied to divided by period days times 8h. Intercom uses actual agent logged-in time as denominator (e.g. 12h 6m) which is not available via the public API.";
  const TIP_CLOSED_HR   = "Conversations closed divided by period days times 8h. Intercom uses actual agent logged-in time as denominator which is not available via the public API.";

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm px-6 py-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Trading Ethics Email Performance</h1>
          <p className="text-xs text-gray-400 mt-0.5">Channel: Email - Team: All CR inboxes - Timezone: GMT+6</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <button onClick={() => load(from, to)} disabled={loading}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-60 transition-colors">
            {loading ? "Loading..." : "Apply"}
          </button>
          <button onClick={() => { setFrom(""); setTo(""); load(); }} disabled={loading}
            className="px-4 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 disabled:opacity-60 transition-colors">
            Reset
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-gray-500 text-sm">Fetching email conversations from Intercom...</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          <strong>Error:</strong> {error}
        </div>
      ) : null}

      {!loading && s ? (
        <div className="space-y-5">

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

            <Card
              label="Emails Closed"
              tip={TIP_CLOSED}
              value={s.totalClosed.toLocaleString()}
              sub={"Last " + data!.periodDays + (data!.periodDays > 1 ? " days" : " day")}
            />

            <Card
              label="Avg First Response Time"
              tip={TIP_FRT}
              value={s.avgFrtFmt}
              sub="Avg time to first human reply"
            />

            <Card label="Top 3 Agents by Closed">
              <div className="mt-1 space-y-1.5">
                {s.top3.map((ag, i) => (
                  <div key={ag.name} className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-400 w-4">{i + 1}.</span>
                    <Avatar name={ag.name} size="xs" />
                    <span className="text-xs font-medium text-gray-700 truncate flex-1">{ag.name}</span>
                    <span className="text-xs font-bold text-indigo-600">{ag.closed}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card label="SLA Compliance (24H)">
              <p className={`text-2xl font-bold ${s.slaRate >= 80 ? "text-green-600" : s.slaRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                {s.slaRate}%
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{s.slaMetCount} met / {s.slaTotalCount} total</p>
              <SlaBar rate={s.slaRate} />
            </Card>
          </div>

          {/* Table 1 — Conversation Volume */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-sm">Conversation Volume</p>
              <p className="text-xs text-gray-400 mt-0.5">Assignment and reply activity per teammate</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TH cols={[
                  "Teammate",
                  "Conversations Assigned",
                  "Conversations Replied To",
                  "Replies Sent",
                  { label: "Closed Conversations", tip: TIP_CLOSED },
                ]} />
                <tbody>
                  <tr className="bg-gray-900 text-white font-semibold">
                    <td className="px-4 py-3 text-sm">Summary</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.assigned.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.repliedTo.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.repliesSent.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.closed.toLocaleString()}</td>
                  </tr>
                  {data!.agents.map((row, i) => (
                    <tr key={row.name} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={row.name} />
                          <span className="font-medium text-gray-900 text-sm">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700 font-medium">{row.assigned}</td>
                      <td className="px-4 py-3 text-center text-gray-700 font-medium">{row.repliedTo}</td>
                      <td className="px-4 py-3 text-center text-gray-700 font-medium">{row.repliesSent}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-gray-900">{row.closed}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 2 — Timing and Efficiency */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <p className="font-semibold text-gray-900 text-sm">Timing and Efficiency</p>
              <p className="text-xs text-gray-400 mt-0.5">Response times and per-8h-day rates (hover column headers for accuracy notes)</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <TH cols={[
                  "Teammate",
                  { label: "Avg First Response Time",        tip: TIP_FRT },
                  { label: "Avg Handling Time",              tip: TIP_HANDLING },
                  { label: "Avg Assignment to 1st Response", tip: TIP_ATF },
                  { label: "Conv. Replied / 8h day",         tip: TIP_REPLIED_HR },
                  { label: "Conv. Closed / 8h day",          tip: TIP_CLOSED_HR },
                ]} />
                <tbody>
                  <tr className="bg-gray-900 text-white font-semibold">
                    <td className="px-4 py-3 text-sm">Summary</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.avgFrtFmt}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.avgHandlingFmt}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.avgAtfFmt}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.repliedPerHour}</td>
                    <td className="px-4 py-3 text-center">{data!.summaryRow.closedPerHour}</td>
                  </tr>
                  {data!.agents.map((row, i) => (
                    <tr key={row.name} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/60"}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={row.name} />
                          <div>
                            <div className="font-medium text-gray-900 text-sm">{row.name}</div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className="text-xs text-gray-400">SLA</span>
                              <span className={`text-xs font-semibold ${row.slaRate >= 80 ? "text-green-600" : row.slaRate >= 60 ? "text-amber-600" : "text-red-600"}`}>
                                {row.slaTotal > 0 ? row.slaRate + "%" : "--"}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-700">{row.avgFrtFmt}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{row.avgHandlingFmt}</td>
                      <td className="px-4 py-3 text-center text-gray-700">{row.avgAtfFmt}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-900">{row.repliedPerHour}</td>
                      <td className="px-4 py-3 text-center font-medium text-gray-900">{row.closedPerHour}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      ) : null}
    </div>
  );
}
