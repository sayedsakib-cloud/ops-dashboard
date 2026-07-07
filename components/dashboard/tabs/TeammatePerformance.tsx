"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type HourlyCell = {
  dow: number; hour: number;
  closed_count: number; replies_count: number;
  frt_median: number | null; close_median: number | null;
};
type Payload = {
  from: string; to: string; agent: string | null;
  grid: HourlyCell[];
  agents: { admin_id: string; name: string }[];
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmtDur(s: number | null): string {
  if (s == null) return "";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function colorFor(v: number | null, max: number, kind: "count" | "duration"): string {
  if (v == null || v <= 0) return "transparent";
  const t = max > 0 ? Math.min(1, v / max) : 0;
  if (kind === "count") {
    return `rgba(37, 99, 235, ${0.12 + 0.85 * t})`; // blue: darker = more
  }
  // duration: single warm ramp, pale amber (fast) -> deep red (slow).
  // colorblind-safe — magnitude reads from lightness, not a red/green hue switch.
  const r = Math.round(250 + (180 - 250) * t);
  const g = Math.round(240 + (30 - 240) * t);
  const b = Math.round(180 + (30 - 180) * t);
  return `rgba(${r}, ${g}, ${b}, ${0.35 + 0.6 * t})`;
}

function Heatmap({
  title, subtitle, grid, metric, kind,
}: {
  title: string; subtitle: string; grid: HourlyCell[];
  metric: keyof HourlyCell; kind: "count" | "duration";
}) {
  // index cells by dow*24+hour
  const at = (dow: number, hour: number) =>
    grid.find(c => c.dow === dow && c.hour === hour);
  const values = grid.map(c => c[metric] as number | null).filter((v): v is number => v != null && v > 0);
  const max = values.length ? Math.max(...values) : 0;
  const fmt = (v: number | null) => v == null ? "" : (kind === "duration" ? fmtDur(v) : String(v));

  return (
    <Card className="overflow-hidden border bg-card">
      <CardHeader className="py-3">
        <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
        <CardDescription className="text-xs">{subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-4">
        <div className="min-w-[640px]">
          {/* hour header */}
          <div className="flex items-center">
            <div className="w-10 shrink-0" />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="flex-1 text-center text-[9px] text-muted-foreground">
                {h % 2 === 0 ? h : ""}
              </div>
            ))}
          </div>
          {/* rows */}
          {DOW.map((label, dow) => (
            <div key={dow} className="flex items-center">
              <div className="w-10 shrink-0 pr-1 text-right text-[11px] font-medium text-muted-foreground">{label}</div>
              {Array.from({ length: 24 }).map((_, h) => {
                const cell = at(dow, h);
                const v = cell ? (cell[metric] as number | null) : null;
                const bg = colorFor(v, max, kind);
                const showVal = v != null && (kind === "duration" ? v > 0 : v > 0);
                return (
                  <div key={h} className="flex-1 p-[1px]">
                    <div
                      title={`${label} ${h}:00 — ${showVal ? fmt(v) : "no data"}`}
                      className="flex h-6 items-center justify-center rounded-[3px] border border-black/5 text-[9px] font-semibold text-white/95 dark:border-white/5"
                      style={{ background: bg }}
                    >
                      {showVal && max > 0 && (v as number) / max > 0.28 ? fmt(v) : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeammatePerformance() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [agent, setAgent] = useState<string>(""); // "" = all agents

  async function load(f?: string, t?: string, a?: string) {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (f) p.set("from", f);
      if (t) p.set("to", t);
      if (a) p.set("agent", a);
      const r = await fetch("/api/teep/hourly" + (p.toString() ? "?" + p.toString() : ""));
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? "Failed to load");
      setData(j);
      if (!f) setFrom(j.from);
      if (!t) setTo(j.to);
    } catch (e: any) {
      setError(e?.message ?? "Could not load teammate performance.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* default: yesterday, all agents */ }, []);

  const agentName = data?.agents.find(a => a.admin_id === agent)?.name;
  const rangeLabel = data ? (data.from === data.to ? data.from : `${data.from} → ${data.to}`) : "";

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="border bg-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Agent</Label>
            <select
              value={agent}
              onChange={e => { setAgent(e.target.value); load(from, to, e.target.value); }}
              className="h-9 w-52 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">All agents</option>
              {data?.agents.map(a => <option key={a.admin_id} value={a.admin_id}>{a.name}</option>)}
            </select>
          </div>
          <Button onClick={() => load(from, to, agent)} disabled={loading} className="h-9">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
          </Button>
          {rangeLabel && (
            <span className="ml-auto text-xs text-muted-foreground">
              Showing <b>{agentName ?? "all agents"}</b> · {rangeLabel} · times in Asia/Dhaka
            </span>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-56 w-full animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : error ? (
        <p className="py-8 text-center text-sm text-destructive">{error}</p>
      ) : data ? (
        <div className="space-y-4">
          <Heatmap title="Closed conversations" subtitle="Unique conversations closed, by hour" grid={data.grid} metric="closed_count" kind="count" />
          <Heatmap title="Replies sent" subtitle="Customer-facing replies, by hour" grid={data.grid} metric="replies_count" kind="count" />
          {agent && (
            <>
              <Heatmap title="Median first-reply time (FRT)" subtitle="Median time to first reply, by hour" grid={data.grid} metric="frt_median" kind="duration" />
              <Heatmap title="Median time to close" subtitle="Median time from open to first close, by hour" grid={data.grid} metric="close_median" kind="duration" />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
