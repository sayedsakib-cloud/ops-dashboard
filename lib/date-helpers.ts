// Shared date helpers for Daily Huddle routes.
// Sheet dates land in mixed formats across tabs; this normalizes them.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Parse "11-Jun-2026", "Jun 11, 2026", "2026-06-11", "06/11/2026" -> Date (UTC midnight).
// Returns null when unrecognized so callers can skip the row.
export function parseSheetDate(raw: string): Date | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // DD-Mon-YYYY  (e.g. "11-Jun-2026")
  let m = s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo !== undefined) return new Date(Date.UTC(+m[3], mo, +m[1]));
  }

  // Mon DD, YYYY  (e.g. "Jun 11, 2026")
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (mo !== undefined) return new Date(Date.UTC(+m[3], mo, +m[2]));
  }

  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));

  // DD/MM/YYYY or MM/DD/YYYY. Disambiguate: if the first number > 12 it must be the day.
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2], year = +m[3];
    let day: number, month: number;
    if (a > 12) {            // a can only be a day -> DD/MM/YYYY
      day = a; month = b;
    } else if (b > 12) {     // b can only be a day -> MM/DD/YYYY
      day = b; month = a;
    } else {                 // ambiguous (both <= 12) -> assume DD/MM/YYYY (sheet uses day-first)
      day = a; month = b;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return new Date(Date.UTC(year, month - 1, day));
    return null;
  }

  // Fallback to Date.parse (last resort, may misread).
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}

// Returns the most recently COMPLETED Mon-Sun window relative to `today`.
// Cutover happens on Monday: that day's window is the just-finished Mon-Sun.
// On Sun/Tue/Wed/etc., the previous full Mon-Sun is still the answer.
export function lastCompletedMonSun(today: Date = new Date()): { start: Date; end: Date } {
  // Work in UTC to avoid TZ drift across the team (GMT+6) and Vercel (UTC).
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  // getUTCDay(): Sun=0, Mon=1, ..., Sat=6. We want Mon=0 .. Sun=6.
  const dow = (t.getUTCDay() + 6) % 7;
  // Days back to the most recent Sunday that has fully passed.
  // Today is Sun (dow=6) -> 0 days back to today (today IS the Sunday that just ended? no -
  //   on Sunday the week isn't complete until Mon, so we want the PREVIOUS Sunday).
  // Use: end = "this week's Monday minus 1 day", which is always the previous Sunday.
  const daysToThisMonday = dow; // dow days back to the Mon of the current week
  const thisMonday = new Date(t);
  thisMonday.setUTCDate(t.getUTCDate() - daysToThisMonday);
  const end = new Date(thisMonday);
  end.setUTCDate(thisMonday.getUTCDate() - 1); // Sunday
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 6); // Monday
  return { start, end };
}

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function inRange(d: Date, start: Date, end: Date): boolean {
  return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
}

// "Jun 8, 2026" style for chart x-axis labels matching the existing UI.
export function formatLabel(d: Date): string {
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// Parse "1,234" / "$28.04" / "" -> number. Empty -> 0.
export function toNum(v: unknown): number {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
}
