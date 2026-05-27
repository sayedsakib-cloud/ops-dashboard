"use client";

import { DateRange } from "@/lib/dashboardHelpers";

interface DateFilterProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  availableWeeks?: Array<{ start: string; end: string }>;
}

export default function DateFilter({ dateRange, onDateRangeChange, availableWeeks }: DateFilterProps) {
  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newStart = e.target.value ? new Date(e.target.value) : null;
    onDateRangeChange({ start: newStart, end: dateRange.end });
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEnd = e.target.value ? new Date(e.target.value) : null;
    onDateRangeChange({ start: dateRange.start, end: newEnd });
  };

  const handleWeekSelect = (week: { start: string; end: string }) => {
    onDateRangeChange({
      start: new Date(week.start),
      end: new Date(week.end),
    });
  };

  const startDateStr = dateRange.start ? dateRange.start.toISOString().split("T")[0] : "";
  const endDateStr = dateRange.end ? dateRange.end.toISOString().split("T")[0] : "";

  return (
    <div className="rounded-3xl bg-slate-950/95 p-6 ring-1 ring-slate-800">
      <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Date Filter</p>

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:gap-3">
        <div className="flex-1">
          <label className="block text-xs text-slate-400">Start Date</label>
          <input
            type="date"
            value={startDateStr}
            onChange={handleStartDateChange}
            className="mt-2 w-full rounded-2xl bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700 focus:ring-sky-400"
          />
        </div>

        <div className="flex-1">
          <label className="block text-xs text-slate-400">End Date</label>
          <input
            type="date"
            value={endDateStr}
            onChange={handleEndDateChange}
            className="mt-2 w-full rounded-2xl bg-slate-900 px-3 py-2 text-white ring-1 ring-slate-700 focus:ring-sky-400"
          />
        </div>
      </div>

      {availableWeeks && availableWeeks.length > 0 && (
        <div className="mt-4">
          <label className="block text-xs text-slate-400">Quick Select Week</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {availableWeeks.slice(0, 5).map((week, idx) => (
              <button
                key={idx}
                onClick={() => handleWeekSelect(week)}
                className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-300 hover:bg-sky-600 hover:text-white transition-colors"
              >
                {new Date(week.start).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
