"use client";
import { useState } from "react";
import DailyHuddleTab   from "@/components/dashboard/tabs/DailyHuddleTab";
import KPITab           from "@/components/dashboard/tabs/KPITab";
import RegularTaskTab   from "@/components/dashboard/tabs/RegularTaskTab";
import TicketsTab       from "@/components/dashboard/tabs/TicketsTab";
import TradingEthicsTab from "@/components/dashboard/tabs/TradingEthicsTab";

const TABS = [
  { id: "daily-huddle",   label: "Daily Huddle"                     },
  { id: "kpi",            label: "KPI"                              },
  { id: "regular-task",   label: "Regular Task"                     },
  { id: "tickets",        label: "Tickets"                          },
  { id: "trading-ethics", label: "Trading Ethics Email Performance" },
];

export default function DashboardPage() {
  const [active,  setActive]  = useState("daily-huddle");
  // Record<id, mounted> — once true, never removed, component stays in DOM
  const [mounted, setMounted] = useState<Record<string, boolean>>({
    "daily-huddle": true,
  });

  function switchTab(id: string) {
    setActive(id);
    if (!mounted[id]) setMounted(prev => ({ ...prev, [id]: true }));
  }

  // Inline style toggle — cannot be overridden by any CSS class
  const vis = (id: string): React.CSSProperties => ({
    display: active === id ? "block" : "none",
  });

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Tab navigation */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-6">
          <nav className="flex overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`px-5 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors focus:outline-none ${
                  active === tab.id
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab content — each tab mounts once on first visit, then persists via display style */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        <div style={vis("daily-huddle")}>
          {mounted["daily-huddle"] && <DailyHuddleTab />}
        </div>
        <div style={vis("kpi")}>
          {mounted["kpi"] && <KPITab />}
        </div>
        <div style={vis("regular-task")}>
          {mounted["regular-task"] && <RegularTaskTab />}
        </div>
        <div style={vis("tickets")}>
          {mounted["tickets"] && <TicketsTab />}
        </div>
        <div style={vis("trading-ethics")}>
          {mounted["trading-ethics"] && <TradingEthicsTab />}
        </div>
      </div>
    </div>
  );
}
