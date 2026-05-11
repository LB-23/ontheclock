import { startOfWeek, format, parseISO, differenceInCalendarDays } from 'date-fns'

/** Friday of the LBG work-week containing `date` (week runs Fri → Thu) */
export function getWeekStart(date: Date = new Date()): string {
  // weekStartsOn 5 = Friday  (0=Sun, 1=Mon, …, 5=Fri, 6=Sat)
  return format(startOfWeek(date, { weekStartsOn: 5 }), 'yyyy-MM-dd')
}

/** Friendly display: "Fri 21 Apr 2026" */
export function fmtDate(iso: string): string {
  return format(parseISO(iso), 'EEE d MMM yyyy')
}

/** "9:45 am" */
export function fmtTime(iso: string): string {
  return format(parseISO(iso), 'h:mm aaa')
}

/** "Fri 25 Apr – Thu 1 May" — week runs Friday to Thursday */
export function fmtWeekRange(weekStart: string): string {
  const start = parseISO(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${format(start, 'EEE d MMM')} – ${format(end, 'EEE d MMM')}`
}

/** Hours between two ISO timestamps, rounded to 2dp */
export function calcHours(clockIn: string, clockOut: string): number {
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  return Math.round((ms / 3_600_000) * 100) / 100
}

/** Auto break: deduct 0.5h if worked > 6h */
export function applyAutoBreak(rawHours: number): { total: number; lunchIncluded: boolean } {
  if (rawHours > 6) return { total: rawHours, lunchIncluded: true }
  return { total: rawHours, lunchIncluded: false }
}

/** Working days between two date strings (inclusive) */
export function workdaysBetween(start: string, end: string): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1
}

/** Download an array of objects as a CSV file */
export function exportCSV(rows: Record<string, unknown>[], filename: string): void {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map(r =>
      headers.map(h => {
        const v = r[h] ?? ''
        const s = String(v).replace(/"/g, '""')
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
      }).join(',')
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Get browser geolocation — returns null if denied */
export function getGPS(): Promise<{ lat: number; lng: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null),
      { timeout: 8000 }
    )
  })
}

/** Format hours as "7h 30m" — always shows minutes (e.g. "8h 0m") */
export function fmtHours(h: number): string {
  const totalMin = Math.round(h * 60)
  const hrs  = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return `${hrs}h ${mins}m`
}

/** Tailwind class helpers — LB sky-blue primary button */
export const btnPrimary =
  'inline-flex items-center justify-center rounded-xl bg-sky px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-skyDeep active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed'

export const btnSecondary =
  'inline-flex items-center justify-center rounded-xl border border-page bg-surface px-5 py-3 text-sm font-semibold text-ink shadow-sm hover:bg-page active:scale-95 transition-all disabled:opacity-50'

export const btnDanger =
  'inline-flex items-center justify-center rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-red-600 active:scale-95 transition-all disabled:opacity-50'

export const inputCls =
  'block w-full min-w-0 rounded-xl border border-page bg-surface px-4 py-3 text-sm text-ink placeholder-muted focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20'

export const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-muted mb-1'
