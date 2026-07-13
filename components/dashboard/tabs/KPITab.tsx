"use client";
import { useEffect, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
  if (h <= 1) return { label: "Super Green", cls: "bg-emerald-500 text-white" };
  if (h <= 2) return { label: "Green",       cls: "bg-green-600 text-white" };
  if (h <= 4) return { label: "Yellow",      cls: "bg-amber-500 text-white" };
  return       { label: "Red",          cls: "bg-red-500 text-white" };
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

// ── Badge color helpers (dark-aware tokens, no .ops-dark dependency) ─────────
function complexityClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes("12% and above"))           return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (s.includes("above 9%"))                return "bg-lime-500/15 text-lime-700 dark:text-lime-400";
  if (s.includes("9%") && s.includes("11%")) return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
  if (s.includes("7%") || s.includes("8%"))  return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
  if (s.includes("below 5%"))                return "bg-red-500/15 text-red-700 dark:text-red-400";
  return "bg-muted text-muted-foreground";
}
// ── EC Status (per-group band -> level), mirrors the rule decided in the sheet ─
const EC_STATUS: Record<"A" | "B", Record<string, "super" | "green" | "yellow" | "red">> = {
  A: { "12% and above": "super", "9% - 11%": "green", "5% - 8%": "yellow", "below 5%": "red" },
  B: { "above 9% (up to 10%+)": "super", "7% - 9%": "green", "3% - 6%": "yellow", "below 3%": "red" },
};
function normBand(s: string) {
  return s.replace(/[\u2013\u2014]/g, "-").trim().toLowerCase().replace(/\s+/g, " ");
}
function ecLevel(group: string, complexity: string): "super" | "green" | "yellow" | "red" | null {
  const table = EC_STATUS[String(group).includes("A") ? "A" : "B"];
  const want = normBand(complexity);
  for (const k in table) if (normBand(k) === want) return table[k];
  return null;
}
const EC_PILL: Record<string, { label: string; cls: string }> = {
  super:  { label: "Super Green", cls: "bg-emerald-500 text-white" },
  green:  { label: "Green",       cls: "bg-green-600 text-white" },
  yellow: { label: "Yellow",      cls: "bg-amber-500 text-white" },
  red:    { label: "Red",         cls: "bg-red-500 text-white" },
};
function ecStatus(group: string, complexity: string): { label: string; cls: string } {
  const level = ecLevel(group, complexity);
  return level ? EC_PILL[level] : { label: "--", cls: "" };
}
// EC Complexity tint, group-aware (super = deeper solid green, distinct from green)
const EC_TINT: Record<string, string> = {
  super:  "bg-emerald-300 text-emerald-900",
  green:  "bg-green-500/15 text-green-700 dark:text-green-400",
  yellow: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  red:    "bg-red-500/15 text-red-700 dark:text-red-400",
};
function complexityClassFor(group: string, v: string): string {
  const level = ecLevel(group, v);
  return level && EC_TINT[level] ? EC_TINT[level] : complexityClass(v);
}
function qcClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes("no qc") || s.includes("no issues")) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  if (s.includes("critical") || s.includes("refund"))  return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (s.includes("major"))                             return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
  if (s.includes("1") && s.includes("error"))          return "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400";
  return "bg-muted text-muted-foreground";
}
function stakeholderClass(v: string) {
  const s = v.toLowerCase();
  if (s.includes("3% or more")) return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (s.includes("2%"))         return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  return "bg-muted text-muted-foreground";
}
function qcDisplay(v: string) {
  return v.toLowerCase().includes("no qc") ? "No Issues" : (v || "—");
}

// ── Shared UI helpers ──────────────────────────────────────────────────────
// Brand-led categorical palette: red/orange first, then distinct hues kept
// so multiple agents/series stay visually separable.
const PALETTE = [
  "bg-red-500","bg-orange-500","bg-rose-500","bg-amber-500",
  "bg-pink-500","bg-teal-500","bg-violet-500","bg-emerald-500",
];
function avatarColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}
function AgentAvatar({ name }: { name: string }) {
  return (
    <Avatar className="h-8 w-8">
      <AvatarFallback className={cn("text-xs font-bold text-white", avatarColor(name))}>
        {name.charAt(0).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
function ColorBadge({ val, cls }: { val: string; cls: string }) {
  if (!val) return <span className="text-muted-foreground text-xs">—</span>;
  return <Badge className={cls}>{val}</Badge>;
}
function StatCard({ icon, label, value }: { icon: string; label: string; value: string|number }) {
  return (
    <Card className="gap-0 p-4">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span>{icon}</span>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value ?? "—"}</div>
    </Card>
  );
}
function rankLabel(i: number) {
  if (i === 0) return "🥇"; if (i === 1) return "🥈"; if (i === 2) return "🥉";
  return `#${i + 1}`;
}

// Segmented control (controlled, keeps content mounted via parent display logic)
function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { key: T; label: string }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
      {options.map(({ key, label }) => (
        <button key={key} onClick={() => onChange(key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── BAU Section ────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

function BAUSection() {
  const [bauTab, setBauTab] = useState<"regular" | "hireflix">("regular");
  const [hirelixLoaded, setHirelixLoaded] = useState(false);

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

  useEffect(() => { loadTab("regular", "", "", ""); }, []);

  function switchBauTab(tab: "regular" | "hireflix") {
    setBauTab(tab);
    if (tab === "hireflix" && !hirelixLoaded) {
      setHirelixLoaded(true);
      loadTab("hireflix", "", "", "");
    }
  }

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
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </div>
    );
    if (error) return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        Error: {error}
      </div>
    );
    if (!data) return null;

    const nameIdx = data.headers.findIndex(h =>
      h.toLowerCase().includes("name") || h.toLowerCase().includes("agent")
    );
    const valueIdx = data.headers.findIndex(h => /count/i.test(h));
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
        <Card className="inline-block min-w-[220px] gap-0 p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{totalLabel}</p>
          <p className="text-3xl font-bold">{grandTotal.toLocaleString()}</p>
        </Card>

        {/* By-name summary */}
        {nameSummary.length > 0 ? (
          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="border-b py-4">
              <CardTitle className="text-sm">Count by Name</CardTitle>
              <CardDescription className="text-xs">Filtered period totals per teammate</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{nameIdx >= 0 ? data.headers[nameIdx] : "Name"}</TableHead>
                    <TableHead className="pr-10 text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nameSummary.map(([name, count]) => (
                    <TableRow key={name}>
                      <TableCell className="font-medium">{name}</TableCell>
                      <TableCell className="pr-10 text-right font-bold">{count.toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {/* Collapsible full records */}
        <details className="group">
          <summary className="flex cursor-pointer list-none select-none items-center justify-between rounded-lg border bg-card px-5 py-3 text-sm font-semibold transition-colors hover:bg-accent">
            <span>View all records ({data.filtered.toLocaleString()} of {data.total.toLocaleString()})</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <Card className="mt-2 gap-0 overflow-hidden py-0">
            {totalPages > 1 ? (
              <div className="flex items-center justify-end gap-2 border-b px-5 py-2 text-sm text-muted-foreground">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>{"<"}</Button>
                <span className="text-xs">Page {page} / {totalPages}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages}>{">"}</Button>
              </div>
            ) : null}
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {data.headers.map(h => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRows.length === 0 ? (
                    <TableRow><TableCell colSpan={data.headers.length} className="py-8 text-center text-muted-foreground">No records found</TableCell></TableRow>
                  ) : pagedRows.map((row, i) => (
                    <TableRow key={i}>
                      {row.map((cell, j) => (
                        <TableCell key={j} className="whitespace-nowrap">{cell || "—"}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Segmented
        value={bauTab}
        onChange={switchBauTab}
        options={[
          { key: "regular",  label: "📋 Regular Task Report" },
          { key: "hireflix", label: "🎯 Hireflix Count" },
        ]}
      />

      {/* Shared filter bar */}
      <Card className="gap-0 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">📅 Date Range Filter</p>
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From date</Label>
            <Input type="date" value={curFrom} onChange={e => setCurFrom(e.target.value)} className="w-auto" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">To date</Label>
            <Input type="date" value={curTo} onChange={e => setCurTo(e.target.value)} className="w-auto" />
          </div>
          <div className="min-w-[180px] flex-1 space-y-1">
            <Label className="text-xs text-muted-foreground">Filter by name</Label>
            <Input
              type="text" value={curName} onChange={e => setCurName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleApply()}
              placeholder="All agents..."
            />
          </div>
          <Button onClick={handleApply}>Apply</Button>
          <Button variant="secondary" onClick={handleReset}>Reset</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Filtering on column: Date</p>
      </Card>

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

  function handleSectionSwitch(s: "kpi" | "bau") {
    setSection(s);
    if (s === "bau") setBauEverMounted(true);
  }

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
      <Segmented
        value={section}
        onChange={handleSectionSwitch}
        options={[
          { key: "kpi", label: "CR Pax KPI DB & CR Team KPI DB" },
          { key: "bau", label: "CR BAU" },
        ]}
      />

      {/* CR BAU — lazy-mount, then keep alive */}
      <div style={{ display: section === "bau" ? "block" : "none" }}>
        {bauEverMounted && <BAUSection />}
      </div>

      {/* KPI content */}
      <div style={{ display: section === "kpi" ? "block" : "none" }}>
        {loading && (
          <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading KPI data...
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            Error: {error}
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-8">
            {/* ══ SECTION 1 ══ */}
            <section className="space-y-4">
              {/* Filter bar */}
              <Card className="gap-0 p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">📅 Date Range Filter</p>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">From (week start)</Label>
                    <Input type="date" value={fromDate} onChange={e => setFrom(e.target.value)} className="w-auto" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">To (week end)</Label>
                    <Input type="date" value={toDate} onChange={e => setTo(e.target.value)} className="w-auto" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Filter by agent name</Label>
                    <Select value={agent} onValueChange={setAgent}>
                      <SelectTrigger className="min-w-[160px]"><SelectValue placeholder="All agents..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All agents...</SelectItem>
                        {data.allAgents.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => loadKPI(fromDate, toDate, agent)}>Apply</Button>
                  <Button variant="secondary" onClick={() => { setAgent("all"); loadKPI(); }}>Reset</Button>
                </div>
                {data.filterStart && data.filterEnd && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing: <span className="font-medium text-foreground">{data.filterStart}</span>
                    {" to "}
                    <span className="font-medium text-foreground">{data.filterEnd}</span>
                  </p>
                )}
              </Card>

              {/* Summary cards */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard icon="📧" label="Total Email Volume" value={data.summary.totalEmailVolume.toLocaleString()} />
                <StatCard icon="⭐" label="Avg Neg. Review %" value={data.summary.avgNegReview !== null ? `${data.summary.avgNegReview}%` : "—"} />
                <StatCard icon="📝" label="TP Reviews Count" value={data.summary.tpReviewsCount} />
                <StatCard icon="👥" label="Agents Active" value={data.summary.agentsActive} />
              </div>

              {/* Individual performance table */}
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b py-4">
                  <CardTitle className="text-sm">Individual Weekly Performance</CardTitle>
                  <CardDescription className="text-xs">Metrics by agent - CR Pax KPI DB</CardDescription>
                  <CardAction><Badge variant="secondary">{data.individualPerformance.length} agents</Badge></CardAction>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {["Agent","Group","FRT Count","FRT Status","Email Vol.","EC Complexity","EC Status","QC Grade","Remarks"].map(h => (
                          <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.individualPerformance.length === 0 ? (
                        <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No data for selected period</TableCell></TableRow>
                      ) : data.individualPerformance.map((row, i) => {
                        const st = frtStatus(row.frtCount);
                        const ec = ecStatus(row.complexityGroup, row.complexity);
                        return (
                          <TableRow key={i}>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <AgentAvatar name={row.name} />
                                <div>
                                  <div className="text-sm font-medium">{row.name}</div>
                                  <div className="text-xs text-muted-foreground">{row.quarter}</div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{row.complexityGroup || "—"}</TableCell>
                            <TableCell className="font-medium">{row.frtCount || "—"}</TableCell>
                            <TableCell>
                              {st.label === "--" ? <span className="text-xs text-muted-foreground">—</span> : <Badge className={st.cls}>{st.label}</Badge>}
                            </TableCell>
                            <TableCell className="text-right font-semibold">{row.emailCount || "—"}</TableCell>
                            <TableCell><ColorBadge val={row.complexity} cls={complexityClassFor(row.complexityGroup, row.complexity)} /></TableCell>
                            <TableCell>
                              {ec.label === "--" ? <span className="text-xs text-muted-foreground">—</span> : <Badge className={ec.cls}>{ec.label}</Badge>}
                            </TableCell>
                            <TableCell><ColorBadge val={qcDisplay(row.quality)} cls={qcClass(row.quality)} /></TableCell>
                            <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.remarks}>{row.remarks || "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Team KPI table */}
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b py-4">
                  <CardTitle className="text-sm">Team KPI DB Summary</CardTitle>
                  <CardDescription className="text-xs">High-level operations monitoring - CR Team KPI DB</CardDescription>
                  <CardAction><Badge variant="secondary">{data.teamKPI.length} records</Badge></CardAction>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {["Period","QTR","Neg. Review %","TP Reviews","Stakeholder Mgmt","Remarks"].map(h => (
                          <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.teamKPI.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No data for selected period</TableCell></TableRow>
                      ) : data.teamKPI.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{row.weekStart}{" to "}{row.weekEnd}</TableCell>
                          <TableCell className="font-medium text-muted-foreground">{row.quarter}</TableCell>
                          <TableCell>
                            <span className={cn("font-semibold", parseFloat(row.negReviewPct) >= 3 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")}>
                              {row.negReviewPct || "—"}
                            </span>
                          </TableCell>
                          <TableCell className="font-semibold">{row.totalReviews || "—"}</TableCell>
                          <TableCell><ColorBadge val={row.stakeholderMgmt} cls={stakeholderClass(row.stakeholderMgmt)} /></TableCell>
                          <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={row.remarks}>{row.remarks || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </section>

            <Separator />

            {/* ══ SECTION 2: CR Quarterly Avg. Points ══ */}
            <section className="space-y-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">CR Quarterly Avg. Points</h2>

              {/* Quarter pills */}
              <div className="flex gap-2">
                {(data.quarterly.availableQuarters.length > 0 ? data.quarterly.availableQuarters : ["Q2","Q3","Q4"]).map(q => (
                  <Button key={q} size="sm" variant={quarter === q ? "default" : "secondary"}
                    className="rounded-full" onClick={() => setQuarter(q)}>
                    {q}
                  </Button>
                ))}
              </div>

              {/* Quarterly summary */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard icon="👥" label="Agents Tracked" value={qtrAgents.length} />
                <StatCard icon="📊" label="Average Score"  value={qtrAvg || "—"} />
                <StatCard icon="🏆" label="Highest Score"  value={qtrMax || "—"} />
                <StatCard icon="📉" label="Lowest Score"   value={qtrMin || "—"} />
              </div>

              {/* Leaderboard */}
              <Card className="gap-0 overflow-hidden py-0">
                <CardHeader className="border-b py-4">
                  <CardTitle className="text-sm">Agent Points — {quarter}</CardTitle>
                  <CardDescription className="text-xs">Average performance scores - {quarter}</CardDescription>
                  <CardAction><Badge variant="secondary">{qtrAgents.length} agents</Badge></CardAction>
                </CardHeader>
                <div className="grid grid-cols-12 bg-muted/50 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <div className="col-span-1">Rank</div>
                  <div className="col-span-3">Agent</div>
                  <div className="col-span-8">Score</div>
                </div>
                {qtrAgents.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-muted-foreground">No data for {quarter}</div>
                ) : qtrAgents.map((a, i) => {
                  const score = a.score ?? 0;
                  const top3  = i < 3;
                  return (
                    <div key={a.name} className="grid grid-cols-12 items-center border-b px-5 py-4 last:border-0">
                      <div className="col-span-1 text-sm font-bold text-muted-foreground">{rankLabel(i)}</div>
                      <div className="col-span-3 flex items-center gap-2">
                        <AgentAvatar name={a.name} />
                        <div>
                          <div className="text-sm font-semibold">{a.name}</div>
                          <div className="text-xs text-muted-foreground">{quarter}</div>
                        </div>
                      </div>
                      <div className="col-span-8 flex items-center gap-3">
                        <span className={cn("w-12 text-right text-base font-bold", top3 ? "text-primary" : "text-amber-600 dark:text-amber-400")}>
                          {score.toFixed(2)}
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full transition-all duration-500", top3 ? "bg-primary" : "bg-amber-500")}
                            style={{ width: `${Math.min((score / 3) * 100, 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Card>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
