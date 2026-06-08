"use client";
import { useState } from "react";
import DailyHuddleTab  from "@/components/dashboard/tabs/DailyHuddleTab";
import KPITab          from "@/components/dashboard/tabs/KPITab";
import RegularTaskTab  from "@/components/dashboard/tabs/RegularTaskTab";
import TicketsTab      from "@/components/dashboard/tabs/TicketsTab";
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
  // tracks which tabs have ever been visited → keep mounted once rendered
  const [mounted, setMounted] = useState<Set<string>>(new Set(["daily-huddle"]));

  function switchTab(id: string) {
    setActive(id);
    setMounted(prev => new Set([...prev, id]));
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Tab bar */}
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

      {/* Content — mount once, hide with CSS when inactive */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {mounted.has("daily-huddle") && (
          <div className={active !== "daily-huddle" ? "hidden" : ""}><DailyHuddleTab /></div>
        )}
        {mounted.has("kpi") && (
          <div className={active !== "kpi" ? "hidden" : ""}><KPITab /></div>
        )}
        {mounted.has("regular-task") && (
          <div className={active !== "regular-task" ? "hidden" : ""}><RegularTaskTab /></div>
        )}
        {mounted.has("tickets") && (
          <div className={active !== "tickets" ? "hidden" : ""}><TicketsTab /></div>
        )}
        {mounted.has("trading-ethics") && (
          <div className={active !== "trading-ethics" ? "hidden" : ""}><TradingEthicsTab /></div>
        )}
      </div>
    </div>
  );
}
