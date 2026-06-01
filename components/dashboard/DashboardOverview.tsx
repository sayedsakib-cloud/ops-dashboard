"use client";

import { useEffect, useState } from "react";
import DateFilter from "./DateFilter";
import KPIWidget from "./KPIWidget";
import TaskWidget from "./TaskWidget";
import HireflixWidget from "./HireflixWidget";
import PerformanceOverview from "./PerformanceOverview";
import { DateRange, getLastNWeeksDateRange, getAvailableWeeks, filterKPIByDateRange, filterTasksByDateRange, filterHireflixByDateRange } from "@/lib/dashboardHelpers";

type IntercomInbox = {
  teamId: string;
  name: string;
  total: number;
  error?: string;
};

type SheetData = {
  tab: string;
  rows: unknown[][];
  columns?: string[];
};

type DashboardState = {
  intercom?: {
    inboxes: IntercomInbox[];
  };
  sheets?: {
    kpi: SheetData[];
    tasks: SheetData[];
  };
  error?: string;
  loading: boolean;
};

export default function DashboardOverview() {
  const [state, setState] = useState<DashboardState>({ loading: true });
  const [dateRange, setDateRange] = useState<DateRange>(getLastNWeeksDateRange(8)); // Default: last 8 weeks
  const [availableWeeks, setAvailableWeeks] = useState<Array<{ start: string; end: string }>>([]);

  useEffect(() => {
    async function loadData() {
      try {
        const [intercomRes, sheetsRes] = await Promise.all([
          fetch("/api/performance", { cache: "no-store" }),
          fetch("/api/test/sheets", { cache: "no-store" }),
        ]);

        if (!intercomRes.ok || !sheetsRes.ok) {
          const [intercomErr, sheetsErr] = await Promise.all([
            intercomRes.text(),
            sheetsRes.text(),
          ]);

          throw new Error(
            `Intercom error: ${intercomRes.status} ${intercomErr} | Sheets error: ${sheetsRes.status} ${sheetsErr}`
          );
        }

        const intercom = await intercomRes.json();
        const sheets = await sheetsRes.json();

        setState({ loading: false, intercom, sheets });

        // Extract available weeks from Individual KPI Database
        const individualKPI = sheets.kpi?.find((s: SheetData) => s.tab.includes("Individual"));
        if (individualKPI) {
          const weeks = getAvailableWeeks(individualKPI.rows);
          setAvailableWeeks(weeks);
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        setState({ loading: false, error });
      }
    }

    loadData();
  }, []);

  if (state.loading) {
    return (
      <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 text-center text-slate-300">
        Loading dashboard data...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-3xl border border-rose-600 bg-rose-950/70 p-8 text-rose-200">
        <h2 className="text-xl font-semibold">Dashboard data failed to load</h2>
        <p className="mt-3 text-sm whitespace-pre-wrap">{state.error}</p>
      </div>
    );
  }

  // Get sheet data
  const individualKPI = state.sheets?.kpi?.find((s) => s.tab.includes("Individual"));
  const teamKPI = state.sheets?.kpi?.find((s) => s.tab.includes("Team"));
  const tasksSheet = state.sheets?.tasks?.find((s) => s.tab.includes("Regular"));
  const hireflixSheet = state.sheets?.tasks?.find((s) => s.tab.includes("Hireflix"));

  const filteredIndividualKPI = individualKPI ? filterKPIByDateRange(individualKPI.rows, dateRange) : [];
  const filteredTeamKPI = teamKPI ? filterKPIByDateRange(teamKPI.rows, dateRange) : [];
  const filteredTasks = tasksSheet ? filterTasksByDateRange(tasksSheet.rows, dateRange) : [];
  const filteredHireflix = hireflixSheet ? filterHireflixByDateRange(hireflixSheet.rows, dateRange) : [];

  return (
    <div className="space-y-6">
      {/* Performance Overview - New Section */}
      <section className="rounded-3xl bg-white p-8 shadow-lg">
        <PerformanceOverview />
      </section>

      {/* Date Filter */}
      <DateFilter dateRange={dateRange} onDateRangeChange={setDateRange} availableWeeks={availableWeeks} />

      {/* KPI Widgets */}
      <div className="grid gap-6 lg:grid-cols-2">
        {individualKPI && (
          <KPIWidget
            title="Individual KPI Database"
            data={filteredIndividualKPI.map((item) => item.row as unknown[])}
            columns={individualKPI.columns || []}
            type="individual"
          />
        )}

        {teamKPI && (
          <KPIWidget
            title="Team KPI Database"
            data={filteredTeamKPI.map((item) => item.row as unknown[])}
            columns={teamKPI.columns || []}
            type="team"
          />
        )}
      </div>

      {/* Task Widgets */}
      <div className="grid gap-6 lg:grid-cols-2">
        {tasksSheet && <TaskWidget data={filteredTasks.map((item) => item.row as unknown[])} columns={tasksSheet.columns || []} />}

        {hireflixSheet && <HireflixWidget data={filteredHireflix.map((item) => item.row as unknown[])} columns={hireflixSheet.columns || []} />}
      </div>
    </div>
  );
}
