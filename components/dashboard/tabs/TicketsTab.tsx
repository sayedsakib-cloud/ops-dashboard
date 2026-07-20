"use client";
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { useTheme } from "next-themes";
import { Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ── Session cache (5-min TTL, survives tab switches) ──────────────────────
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string): any {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}
function setCache(key: string, data: any): void {
  try { sessionStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

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
    <Card className="gap-0 p-4">
      <div className="mb-1.5 flex items-center gap-1.5">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-2xl font-bold", valueColor ?? "text-foreground")}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

function slaTextColor(rate: number) {
  return rate >= 80 ? "text-emerald-600 dark:text-emerald-400"
       : rate >= 60 ? "text-amber-600 dark:text-amber-400"
       : "text-red-600 dark:text-red-400";
}
function slaBarColor(rate: number) {
  return rate >= 80 ? "bg-emerald-500" : rate >= 60 ? "bg-amber-500" : "bg-red-500";
}

function SlaBar({ rate, h = "h-3" }: { rate: number; h?: string }) {
  return (
    <div className={cn("w-full overflow-hidden rounded-full bg-muted", h)}>
      <div className={cn("rounded-full transition-all duration-700", h, slaBarColor(rate))}
        style={{ width: `${Math.min(rate, 100)}%` }} />
    </div>
  );
}

// Segmented control (controlled)
function Segmented<T extends string>({ value, onChange, options, size = "default" }: {
  value: T; onChange: (v: T) => void; options: { key: T; label: string }[]; size?: "default" | "sm";
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {options.map(({ key, label }) => (
        <button key={key} onClick={() => onChange(key)}
          className={cn(
            "rounded-md font-medium transition-colors",
            size === "sm" ? "px-3 py-1 text-sm" : "px-3 py-1.5 text-sm",
            value === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function TicketsTab() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [section,   setSection]   = useState<"cr" | "bizops">("cr");
  const [crState,   setCrState]   = useState<SectionState>({ ...DEFAULT_SECTION });
  const [boState,   setBoState]   = useState<SectionState>({ ...DEFAULT_SECTION });
  const [showBreachTable, setShowBreachTable] = useState(false);

  const cur    = section === "cr" ? crState   : boState;
  const setCur = section === "cr" ? setCrState : setBoState;

  async function load(sec: string, st: SectionState) {
    const setter = sec === "cr" ? setCrState : setBoState;
    const cacheKey = `tickets:${sec}:${st.dateMode}:${st.dateFrom}:${st.dateTo}:${st.ticketType}`;

    const hit = getCached(cacheKey);
    if (hit) {
      setter(prev => ({ ...prev, data: hit, loading: false, error: null }));
      return;
    }

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
      setCache(cacheKey, json);
      setter(prev => ({ ...prev, data: json, loading: false }));
    } catch (e) {
      setter(prev => ({ ...prev, error: e instanceof Error ? e.message : "Error", loading: false }));
    }
  }

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

  const s          = cur.data?.summary;
  const slaRate    = s?.slaComplianceRate ?? 0;
  const agentRows  = (cur.data?.byAgent ?? []).filter(a => a.name !== "Unassigned");
  const unassigned = (cur.data?.byAgent ?? []).find(a => a.name === "Unassigned");

  const chartColors = ["#5B5BD6","#3B82F6","#8b5cf6","#06b6d4","#f59e0b","#14b8a6","#10b981","#ec4899","#f97316","#84cc16"];
  const axisColor    = isDark ? "#94a3b8" : "#64748b";
  const tooltipBg     = isDark ? "#1e293b" : "#ffffff";
  const tooltipBorder = isDark ? "#334155" : "#e5e7eb";
  const tooltipText   = isDark ? "#f1f5f9" : "#111827";

  return (
    <div className="space-y-5">
      {/* Section toggle */}
      <Segmented
        value={section}
        onChange={setSection}
        options={[
          { key: "cr",     label: "Case Resolution" },
          { key: "bizops", label: "Business Operations" },
        ]}
      />

      {/* Filters */}
      <Card className="gap-0 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">🔍 Filters</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Filter date by</Label>
            <Segmented
              size="sm"
              value={cur.dateMode}
              onChange={(m) => setCur(prev => ({ ...prev, dateMode: m }))}
              options={[
                { key: "created",  label: "Created Date" },
                { key: "resolved", label: "Resolved Date" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From</Label>
            <Input type="date" value={cur.dateFrom} className="w-auto"
              onChange={e => setCur(prev => ({ ...prev, dateFrom: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To</Label>
            <Input type="date" value={cur.dateTo} className="w-auto"
              onChange={e => setCur(prev => ({ ...prev, dateTo: e.target.value }))} />
          </div>
          <div className="min-w-[200px] flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Ticket Type</Label>
            <Select value={cur.ticketType || "all"}
              onValueChange={v => setCur(prev => ({ ...prev, ticketType: v === "all" ? "" : v }))}>
              <SelectTrigger className="w-full"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(cur.data?.ticketTypes ?? []).map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleApply} disabled={cur.loading}>
            {cur.loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Loading</> : "Apply"}
          </Button>
          <Button variant="secondary" onClick={handleReset} disabled={cur.loading}>Reset</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {cur.dateMode === "created"
            ? "Filtering by ticket creation date, defaults to last 7 days"
            : "Filtering by resolved date, returns tickets closed in the selected range"}
        </p>
      </Card>

      {/* Loading */}
      {cur.loading && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Fetching tickets from Intercom...</p>
            <p className="mt-1 text-xs text-muted-foreground">Large date ranges may take a few seconds</p>
          </div>
        </div>
      )}

      {cur.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <strong>Error:</strong> {cur.error}
        </div>
      )}

      {/* Data */}
      {!cur.loading && s && (
        <div className="space-y-5">
          {/* Row 1 — Counts */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard icon="🎫" label="Total Tickets" value={s.total} />
            <MetricCard icon="✅" label="Resolved" value={s.resolved} valueColor="text-emerald-600 dark:text-emerald-400" />
            <MetricCard icon="🔓" label="Open" value={s.open} valueColor="text-amber-600 dark:text-amber-400" />
            <MetricCard icon="📊" label="SLA Compliance"
              value={`${s.slaComplianceRate}%`}
              sub={`${s.slaMetCount} met · ${s.slaBreachCount} breached`}
              valueColor={slaTextColor(slaRate)}
            />
          </div>

          {/* Row 2 — Resolution times */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <MetricCard icon="⏱️" label="Avg Resolution (All)" value={s.avgResolutionFmt}
              sub={`Based on ${s.resolved} resolved tickets`} />
            <MetricCard icon="🏢" label="Avg Resolution — Office Hours" value={s.avgOfficeHoursFmt}
              sub={`Created 9:00 AM - 5:00 PM GMT+6 · ${s.avgOfficeHoursCount} tickets`}
              valueColor="text-[#5B5BD6] dark:text-[#a5b4fc]" />
            <MetricCard icon="🌙" label="Avg Resolution — Outside Hours" value={s.avgOutsideHoursFmt}
              sub={`Created 5:01 PM - 8:59 AM GMT+6 · ${s.avgOutsideHoursCount} tickets`}
              valueColor="text-[#3B82F6] dark:text-[#60a5fa]" />
          </div>

          {/* SLA overview */}
          <Card className="gap-0 p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold">SLA Overview</p>
                <p className="mt-0.5 text-xs text-muted-foreground">24-hour SLA — every ticket must be resolved within 24 hours of creation</p>
              </div>
              <span className={cn("text-3xl font-bold", slaTextColor(slaRate))}>{s.slaComplianceRate}%</span>
            </div>
            <SlaBar rate={slaRate} />
            <div className="mt-3 flex justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">SLA Met</span>
                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{s.slaMetCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-red-600 dark:text-red-400">{s.slaBreachCount}</span>
                <span className="text-muted-foreground">SLA Breached</span>
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
              </div>
            </div>
          </Card>

          {/* Agent table */}
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">Resolved by Agent</CardTitle>
              <CardDescription className="text-xs">Resolution performance per Intercom agent</CardDescription>
              <CardAction className="flex items-center gap-3">
                {unassigned && <span className="text-xs text-muted-foreground">+{unassigned.resolved} unassigned</span>}
                <Badge variant="secondary">{agentRows.length} agents</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {["Agent","Resolved","Avg Resolution","SLA Met","SLA Breaches","SLA Rate"].map(h => (
                      <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentRows.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No resolved tickets in this period</TableCell></TableRow>
                  ) : agentRows.map((ag) => (
                    <TableRow key={ag.name}>
                      <TableCell className="font-medium">{ag.name}</TableCell>
                      <TableCell className="font-bold">{ag.resolved}</TableCell>
                      <TableCell className="font-medium text-muted-foreground">{ag.avgResolutionFmt}</TableCell>
                      <TableCell className="font-semibold text-emerald-600 dark:text-emerald-400">{ag.slaMet}</TableCell>
                      <TableCell>
                        <span className={cn("font-semibold", ag.slaBreaches > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                          {ag.slaBreaches}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-[110px] items-center gap-2">
                          <span className={cn("w-12 text-sm font-bold", slaTextColor(ag.slaRate))}>{ag.slaRate}%</span>
                          <SlaBar rate={ag.slaRate} h="h-1.5" />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Ticket Type Distribution chart */}
          {(cur.data?.ticketTypeStats?.length ?? 0) > 0 && (
            <Card className="gap-0 p-5">
              <p className="text-sm font-semibold">Ticket Type Distribution</p>
              <p className="mb-4 text-xs text-muted-foreground">Frequency of ticket types in selected period</p>
              <ResponsiveContainer width="100%" height={Math.max(200, (cur.data?.ticketTypeStats?.length ?? 0) * 42)}>
                <BarChart data={cur.data?.ticketTypeStats} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={280}
                    tick={{ fontSize: 11, fill: axisColor }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: isDark ? "rgba(148,163,184,0.08)" : "rgba(0,0,0,0.04)" }}
                    formatter={(v: any) => [v, "Tickets"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, backgroundColor: tooltipBg, border: `1px solid ${tooltipBorder}`, color: tooltipText }}
                    labelStyle={{ color: tooltipText, fontWeight: 600 }}
                    itemStyle={{ color: tooltipText }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {(cur.data?.ticketTypeStats ?? []).map((_, idx) => (
                      <Cell key={idx} fill={chartColors[idx % chartColors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* SLA Breach Details */}
          {(cur.data?.slaBreachDetails?.length ?? 0) > 0 && (
            <Card className="gap-0 overflow-hidden py-0">
              <CardHeader className="border-b py-4">
                <CardTitle className="flex items-center gap-1.5 text-sm">
                  <AlertTriangle className="h-4 w-4 text-amber-500" /> SLA Breach Details
                </CardTitle>
                <CardDescription className="text-xs">
                  {cur.data?.slaBreachDetails?.length} tickets that exceeded 24-hour SLA · sorted by longest resolution first
                </CardDescription>
                <CardAction>
                  <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowBreachTable(v => !v)}>
                    {showBreachTable ? "Hide" : "Show"} details
                  </Button>
                </CardAction>
              </CardHeader>

              {showBreachTable && (
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {["Ticket #","Type","Contact Ref","Created","Resolved","Duration","Resolved By"].map(h => (
                          <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cur.data?.slaBreachDetails?.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell>
                            <a href={b.ticketLink} target="_blank" rel="noopener noreferrer"
                              className="text-xs font-medium text-primary hover:underline">
                              #{b.ticketId}
                            </a>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs text-muted-foreground" title={b.ticketType}>{b.ticketType}</TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{b.contactRef}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTS(b.createdAt)}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtTS(b.resolvedAt)}</TableCell>
                          <TableCell><span className="text-xs font-semibold text-red-600 dark:text-red-400">{b.resolutionTimeFmt}</span></TableCell>
                          <TableCell className="whitespace-nowrap text-xs font-medium">{b.resolvedBy}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
