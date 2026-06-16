"use client";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { Loader2 } from "lucide-react";
import DailyHuddleTab from "@/components/dashboard/tabs/DailyHuddleTab";
import KPITab from "@/components/dashboard/tabs/KPITab";
import RegularTaskTab from "@/components/dashboard/tabs/RegularTaskTab";
import TicketsTab from "@/components/dashboard/tabs/TicketsTab";
import TradingEthicsTab from "@/components/dashboard/tabs/TradingEthicsTab";
import Sidebar from "@/components/dashboard/Sidebar";
import DashboardLoader from "@/components/dashboard/DashboardLoader";
import ModeToggle from "@/components/layout/ModeToggle";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<string, string> = {
  "daily-huddle": "Daily Huddle",
  "kpi": "KPI",
  "regular-task": "Regular Task",
  "tickets": "Tickets",
  "trading-ethics": "Trading Ethics Email Performance",
};

export default function DashboardPage() {
  const { status } = useSession({ required: true });
  const { resolvedTheme } = useTheme();
  const [active, setActive] = useState("daily-huddle");
  const [mounted, setMounted] = useState<Record<string, boolean>>({ "daily-huddle": true });
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => { setThemeReady(true); }, []);

  function switchTab(id: string) {
    setActive(id);
    if (!mounted[id]) setMounted(prev => ({ ...prev, [id]: true }));
  }
  const vis = (id: string): React.CSSProperties => ({ display: active === id ? "block" : "none" });

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verifying session...</p>
        </div>
      </div>
    );
  }

  // `.ops-dark` is applied only to tabs NOT yet migrated to shadcn, and only in
  // dark mode. KPI is migrated, so it opts out. Remove a tab's `legacy` wrapper
  // class as each is converted; delete the whole mechanism when all are done.
  const legacy = themeReady && resolvedTheme === "dark" ? "ops-dark" : undefined;

  return (
    <DashboardLoader>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar active={active} onSwitch={switchTab} />

        <div className="flex flex-1 flex-col overflow-hidden min-w-0">
          <header className="flex h-14 flex-shrink-0 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <h1 className="text-sm font-medium text-foreground">{TAB_LABELS[active]}</h1>
            <div className="ml-auto"><ModeToggle /></div>
          </header>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-6 py-5">
            <div style={vis("daily-huddle")} className={cn(legacy)}>
              {mounted["daily-huddle"] ? <DailyHuddleTab /> : null}
            </div>
            <div style={vis("kpi")}>
              {mounted["kpi"] ? <KPITab /> : null}
            </div>
            <div style={vis("regular-task")} className={cn(legacy)}>
              {mounted["regular-task"] ? <RegularTaskTab /> : null}
            </div>
            <div style={vis("tickets")} className={cn(legacy)}>
              {mounted["tickets"] ? <TicketsTab /> : null}
            </div>
            <div style={vis("trading-ethics")} className={cn(legacy)}>
              {mounted["trading-ethics"] ? <TradingEthicsTab /> : null}
            </div>
          </div>
        </div>
      </div>
    </DashboardLoader>
  );
}
