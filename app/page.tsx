"use client";
import { useState } from "react";
import DailyHuddleTab from "@/components/dashboard/tabs/DailyHuddleTab";
import KPITab from "@/components/dashboard/tabs/KPITab";
import RegularTaskTab from "@/components/dashboard/tabs/RegularTaskTab";
import TicketsTab from "@/components/dashboard/tabs/TicketsTab";
import TradingEthicsTab from "@/components/dashboard/tabs/TradingEthicsTab";

const TABS = [
  { id: "daily-huddle", label: "Daily Huddle" },
  { id: "kpi", label: "KPI" },
  { id: "regular-task", label: "Regular Task" },
  { id: "tickets", label: "Tickets" },
  { id: "trading-ethics", label: "Trading Ethics Email Performance" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState("daily-huddle");

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Tab Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-6">
          <nav className="flex overflow-x-auto scrollbar-hide">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors focus:outline-none ${
                  activeTab === tab.id
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

      {/* Tab Content */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {activeTab === "daily-huddle" && <DailyHuddleTab />}
        {activeTab === "kpi" && <KPITab />}
        {activeTab === "regular-task" && <RegularTaskTab />}
        {activeTab === "tickets" && <TicketsTab />}
        {activeTab === "trading-ethics" && <TradingEthicsTab />}
      </div>
    </div>
  );
}
