"use client";
import { useEffect, useState } from "react";
import { useSession }           from "next-auth/react";
import { useRouter }            from "next/navigation";
import DailyHuddleTab   from "@/components/dashboard/tabs/DailyHuddleTab";
import KPITab           from "@/components/dashboard/tabs/KPITab";
import RegularTaskTab   from "@/components/dashboard/tabs/RegularTaskTab";
import TicketsTab       from "@/components/dashboard/tabs/TicketsTab";
import TradingEthicsTab from "@/components/dashboard/tabs/TradingEthicsTab";
import Sidebar          from "@/components/dashboard/Sidebar";
import DashboardLoader  from "@/components/dashboard/DashboardLoader";

const TAB_LABELS: Record<string, string> = {
  "daily-huddle":   "Daily Huddle",
  "kpi":            "KPI",
  "regular-task":   "Regular Task",
  "tickets":        "Tickets",
  "trading-ethics": "Trading Ethics Email Performance",
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/api/auth/signin");
    }
  }, [status, router]);

  const [active,  setActive]  = useState("daily-huddle");
  const [mounted, setMounted] = useState<Record<string, boolean>>({
    "daily-huddle": true,
  });

  function switchTab(id: string) {
    setActive(id);
    if (!mounted[id]) setMounted(prev => ({ ...prev, [id]: true }));
  }

  const vis = (id: string): React.CSSProperties => ({
    display: active === id ? "block" : "none",
  });

  // Show nothing while checking auth status
  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#0a1628" }}>
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-slate-400 text-sm">Checking session...</p>
        </div>
      </div>
    );
  }

  // Redirect in progress — show nothing
  if (!session) return null;

  return (
    <DashboardLoader>
      <div className="flex h-screen overflow-hidden" style={{ background: "#0d1117" }}>

        {/* Left sidebar */}
        <Sidebar active={active} onSwitch={switchTab} />

        {/* Main area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

          {/* Top header bar */}
          <div
            className="flex-shrink-0 flex items-center px-6 h-14 border-b"
            style={{ background: "#0e1623", borderColor: "#1a2540" }}
          >
            <h1 className="text-sm font-semibold" style={{ color: "#94a3b8" }}>
              {TAB_LABELS[active]}
            </h1>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto ops-dark px-6 py-5" style={{ background: "#0a1628" }}>
            <div style={vis("daily-huddle")}>
              {mounted["daily-huddle"] ? <DailyHuddleTab /> : null}
            </div>
            <div style={vis("kpi")}>
              {mounted["kpi"] ? <KPITab /> : null}
            </div>
            <div style={vis("regular-task")}>
              {mounted["regular-task"] ? <RegularTaskTab /> : null}
            </div>
            <div style={vis("tickets")}>
              {mounted["tickets"] ? <TicketsTab /> : null}
            </div>
            <div style={vis("trading-ethics")}>
              {mounted["trading-ethics"] ? <TradingEthicsTab /> : null}
            </div>
          </div>

        </div>
      </div>
    </DashboardLoader>
  );
}
