/**
 * Dashboard helper functions for filtering and parsing sheet data
 */

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export interface KPIRow {
  weekStart: string;
  weekEnd: string;
  [key: string]: unknown;
}

export interface TaskRow {
  date: string;
  [key: string]: unknown;
}

export interface HireflixRow {
  date: string;
  [key: string]: unknown;
}

/**
 * Parse date string in format YYYY-MM-DD
 */
export function parseDate(dateStr: string | unknown): Date | null {
  if (typeof dateStr !== "string") return null;
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Check if a date is within a range
 */
export function isDateInRange(date: Date | null, range: DateRange): boolean {
  if (!date) return true; // No date = include
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}

/**
 * Filter KPI rows by date range (uses columns B and C: weekStart, weekEnd)
 */
export function filterKPIByDateRange(rows: unknown[][], dateRange: DateRange): KPIRow[] {
  return rows
    .map((row) => {
      const weekStart = row[1] as string | undefined;
      const weekEnd = row[2] as string | undefined;
      return {
        weekStart: weekStart || "",
        weekEnd: weekEnd || "",
        row,
      };
    })
    .filter((item) => {
      const startDate = parseDate(item.weekStart);
      return isDateInRange(startDate, dateRange);
    })
    .map((item) => ({
      weekStart: item.weekStart,
      weekEnd: item.weekEnd,
      row: item.row,
    })) as KPIRow[];
}

/**
 * Filter tasks by date range (uses column A: date)
 */
export function filterTasksByDateRange(rows: unknown[][], dateRange: DateRange): TaskRow[] {
  return rows
    .map((row) => {
      const date = row[0] as string | undefined;
      return {
        date: date || "",
        row,
      };
    })
    .filter((item) => {
      const itemDate = parseDate(item.date);
      return isDateInRange(itemDate, dateRange);
    })
    .map((item) => ({
      date: item.date,
      row: item.row,
    })) as TaskRow[];
}

/**
 * Filter Hireflix by date range (uses column G: date)
 */
export function filterHireflixByDateRange(rows: unknown[][], dateRange: DateRange): HireflixRow[] {
  return rows
    .map((row) => {
      const date = row[6] as string | undefined; // Column G (index 6)
      return {
        date: date || "",
        row,
      };
    })
    .filter((item) => {
      const itemDate = parseDate(item.date);
      return isDateInRange(itemDate, dateRange);
    })
    .map((item) => ({
      date: item.date,
      row: item.row,
    })) as HireflixRow[];
}

/**
 * Get date range for last N weeks
 */
export function getLastNWeeksDateRange(weeks: number): DateRange {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - weeks * 7);
  return { start, end };
}

/**
 * Get all unique weeks from KPI data
 */
export function getAvailableWeeks(kpiRows: unknown[][]): Array<{ start: string; end: string }> {
  const weeks = new Set<string>();
  const result: Array<{ start: string; end: string }> = [];

  kpiRows.forEach((row) => {
    const start = row[1] as string | undefined;
    const end = row[2] as string | undefined;
    if (start && end) {
      const key = `${start}|${end}`;
      if (!weeks.has(key)) {
        weeks.add(key);
        result.push({ start, end });
      }
    }
  });

  return result.sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime());
}
