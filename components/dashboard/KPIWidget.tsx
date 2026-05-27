"use client";

interface KPIWidgetProps {
  title: string;
  data: unknown[][];
  columns: string[];
  type: "individual" | "team";
}

export default function KPIWidget({ title, data, columns, type }: KPIWidgetProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-3xl bg-slate-950/95 p-6 ring-1 ring-slate-800">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{title}</p>
        <p className="mt-4 text-slate-400">No data for selected date range</p>
      </div>
    );
  }

  // For individual KPI: show summary stats
  if (type === "individual") {
    const totalRows = data.length;
    const peopleSet = new Set<string>();
    data.forEach((row) => {
      if (row[4]) peopleSet.add(String(row[4])); // Column E: person name
    });

    return (
      <div className="rounded-3xl bg-slate-950/95 p-6 ring-1 ring-slate-800">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{title}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Total Entries</p>
            <p className="mt-2 text-2xl font-semibold text-white">{totalRows}</p>
          </div>
          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Unique People</p>
            <p className="mt-2 text-2xl font-semibold text-white">{peopleSet.size}</p>
          </div>
        </div>

        <div className="mt-4 max-h-64 overflow-auto">
          <table className="w-full text-xs text-slate-300">
            <thead>
              <tr className="border-b border-slate-700">
                {columns.slice(0, 5).map((col, idx) => (
                  <th key={idx} className="px-2 py-2 text-left text-slate-400">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row, idx) => (
                <tr key={idx} className="border-b border-slate-800">
                  {row.slice(0, 5).map((cell, cidx) => (
                    <td key={cidx} className="px-2 py-2">
                      {String(cell || "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length > 10 && (
          <p className="mt-2 text-xs text-slate-500">+{data.length - 10} more rows</p>
        )}
      </div>
    );
  }

  // For team KPI: show metrics
  if (type === "team") {
    const avgReview = data
      .map((row) => {
        const val = String(row[4] || "0").replace("%", "");
        return parseFloat(val) || 0;
      })
      .reduce((a, b) => a + b, 0) / data.length;

    const totalReviews = data
      .map((row) => parseInt(String(row[5] || 0)))
      .reduce((a, b) => a + b, 0);

    return (
      <div className="rounded-3xl bg-slate-950/95 p-6 ring-1 ring-slate-800">
        <p className="text-sm uppercase tracking-[0.24em] text-slate-500">{title}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Avg Review %</p>
            <p className="mt-2 text-2xl font-semibold text-white">{avgReview.toFixed(2)}%</p>
          </div>
          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Total Reviews</p>
            <p className="mt-2 text-2xl font-semibold text-white">{totalReviews}</p>
          </div>
          <div className="rounded-2xl bg-slate-900 p-4">
            <p className="text-xs text-slate-400">Weeks Tracked</p>
            <p className="mt-2 text-2xl font-semibold text-white">{data.length}</p>
          </div>
        </div>

        <div className="mt-4 max-h-64 overflow-auto">
          <table className="w-full text-xs text-slate-300">
            <thead>
              <tr className="border-b border-slate-700">
                {columns.slice(1, 7).map((col, idx) => (
                  <th key={idx} className="px-2 py-2 text-left text-slate-400">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((row, idx) => (
                <tr key={idx} className="border-b border-slate-800">
                  {row.slice(1, 7).map((cell, cidx) => (
                    <td key={cidx} className="px-2 py-2">
                      {String(cell || "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length > 10 && (
          <p className="mt-2 text-xs text-slate-500">+{data.length - 10} more rows</p>
        )}
      </div>
    );
  }

  return null;
}
