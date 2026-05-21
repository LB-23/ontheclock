/** Victorian (AU) public holidays.
 *
 *  Used by the admin LeaveManagement calendar to mark dates with a "P/H" tag
 *  so leave approvals can be considered alongside official no-work days.
 *  Returns dates in YYYY-MM-DD (local) so they line up with date-fns format(date,'yyyy-MM-dd').
 *
 *  Source: business.vic.gov.au — Victorian Public Holidays.
 *  Where Christmas/Boxing Day fall on a weekend the gazetted substitute
 *  weekday is included (and the actual date is dropped, matching the
 *  Public Holidays Act 1993).
 */

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

/** Meeus/Jones/Butcher anonymous Gregorian algorithm — Easter Sunday in `y`. */
function easterSunday(y: number): { m: number; d: number } {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { m: month, d: day }
}

/** Nth (1..5) weekday of a month. `weekday` = 0 Sun .. 6 Sat. */
function nthWeekday(y: number, monthIdx0: number, weekday: number, n: number): number {
  const first = new Date(y, monthIdx0, 1)
  const offset = (weekday - first.getDay() + 7) % 7
  return 1 + offset + (n - 1) * 7
}

/** True if the calendar date is a Saturday or Sunday. */
function isWeekend(y: number, m: number, d: number): boolean {
  const wd = new Date(y, m - 1, d).getDay()
  return wd === 0 || wd === 6
}

/** All Victorian public holidays for the given calendar year, keyed by YYYY-MM-DD. */
export function vicHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>()
  const add = (iso: string, name: string) => out.set(iso, name)

  // New Year's Day — if Sat/Sun, substitute the following Monday
  if (isWeekend(year, 1, 1)) {
    const sub = new Date(year, 0, 1).getDay() === 6 ? 3 : 2  // Sat → Mon (+2), Sun → Mon (+1)
    add(iso(year, 1, sub), "New Year's Day (Observed)")
  } else {
    add(iso(year, 1, 1), "New Year's Day")
  }

  // Australia Day — if Sat/Sun, substitute the following Monday
  if (isWeekend(year, 1, 26)) {
    const sub = new Date(year, 0, 26).getDay() === 6 ? 28 : 27
    add(iso(year, 1, sub), 'Australia Day (Observed)')
  } else {
    add(iso(year, 1, 26), 'Australia Day')
  }

  // Labour Day — second Monday in March
  add(iso(year, 3, nthWeekday(year, 2, 1, 2)), 'Labour Day')

  // Easter: Good Friday, Saturday, Sunday, Monday
  const easter = easterSunday(year)
  const easterSundayDate = new Date(year, easter.m - 1, easter.d)
  const addOffset = (days: number, name: string) => {
    const d = new Date(easterSundayDate); d.setDate(d.getDate() + days)
    add(iso(d.getFullYear(), d.getMonth() + 1, d.getDate()), name)
  }
  addOffset(-2, 'Good Friday')
  addOffset(-1, 'Easter Saturday')
  addOffset( 0, 'Easter Sunday')
  addOffset(+1, 'Easter Monday')

  // ANZAC Day — observed on actual date (VIC does NOT shift if on weekend)
  add(iso(year, 4, 25), 'ANZAC Day')

  // King's Birthday — second Monday in June
  add(iso(year, 6, nthWeekday(year, 5, 1, 2)), "King's Birthday")

  // AFL Grand Final Friday — date varies each year; published map kept
  // small/explicit so we don't make up dates we can't verify.
  const afl: Record<number, string> = {
    2024: '2024-09-27',
    2025: '2025-09-26',
    2026: '2026-09-25',
    2027: '2027-09-24',
    2028: '2028-09-29',
  }
  if (afl[year]) add(afl[year], 'AFL Grand Final Friday')

  // Melbourne Cup Day — first Tuesday in November
  add(iso(year, 11, nthWeekday(year, 10, 2, 1)), 'Melbourne Cup')

  // Christmas Day & Boxing Day — substitute when on weekend
  // Christmas
  if (isWeekend(year, 12, 25)) {
    const sub = new Date(year, 11, 25).getDay() === 6 ? 27 : 28  // Sat (6) → Mon 27, Sun (0) → Mon 26 wait
    // Actually: Sat 25 → Mon 27; Sun 25 → Mon 26
    const realSub = new Date(year, 11, 25).getDay() === 6 ? 27 : 26
    add(iso(year, 12, realSub), 'Christmas Day (Observed)')
    void sub
  } else {
    add(iso(year, 12, 25), 'Christmas Day')
  }
  // Boxing Day
  if (isWeekend(year, 12, 26)) {
    const wd = new Date(year, 11, 26).getDay()
    const realSub = wd === 6 ? 28 : 27  // Sat 26 → Mon 28; Sun 26 → Mon 27
    add(iso(year, 12, realSub), 'Boxing Day (Observed)')
  } else {
    add(iso(year, 12, 26), 'Boxing Day')
  }

  return out
}

/** Look up the holiday name (if any) for a given Date. */
export function holidayFor(date: Date): string | null {
  const key = iso(date.getFullYear(), date.getMonth() + 1, date.getDate())
  return vicHolidays(date.getFullYear()).get(key) ?? null
}
