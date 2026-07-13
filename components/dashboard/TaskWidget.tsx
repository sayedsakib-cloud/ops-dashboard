"use client";

interface TaskWidgetProps {
  data: unknown[][];
  columns: string[];
}

export default function TaskWidget({ data, columns }: TaskWidgetProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-3xl bg-slate-950/95 p-6 ring-1 ring-slate-800">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Regular Tasks</p>
        <p className="mt-4 text-slate-400">No tasks for selected date range</p>
      </div>
    );
  }

  // Get person names (assuming column B has names in Regular Task Report)
  const personTasks = new Map<string, number>();
  data.forEach((row) => {
    const person = String(row[1] || "Unknown");
    personTasks.set(person, (personTasks.get(person) || 0) + 1);
  });

  const topPeople = Array.from(personTasks.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="rounded-3xl bg-slate-950/95 p-6 ring-1 ring-slate-800">
      <p className="text-sm uppercase tracking-[0.24em] text-slate-500">Regular Tasks</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Total Tasks</p>
          <p className="mt-2 text-2xl font-semibold text-white">{data.length}</p>
        </div>
        <div className="rounded-2xl bg-slate-900 p-4">
          <p className="text-xs text-slate-400">Assigned To</p>
          <p className="mt-2 text-2xl font-semibold text-white">{personTasks.size}</p>
        </div>
      </div>

      <div className="mt-4">
        <p className="text-xs uppercase tracking-[0.12em] text-slate-400">Top Assignees</p>
        <div className="mt-3 space-y-2">
          {topPeople.map(([person, count]) => (
            <div key={person} className="flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3">
              <span className="text-sm text-slate-300">{person}</span>
              <span className="text-sm font-semibold text-[#ff5a70]">{count} tasks</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 max-h-48 overflow-auto">
        <table className="w-full text-xs text-slate-300">
          <thead>
            <tr className="border-b border-slate-700">
              {columns.slice(0, 3).map((col, idx) => (
                <th key={idx} className="px-2 py-2 text-left text-slate-400">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 8).map((row, idx) => (
              <tr key={idx} className="border-b border-slate-800">
                {row.slice(0, 3).map((cell, cidx) => (
                  <td key={cidx} className="px-2 py-2">
                    {String(cell || "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
