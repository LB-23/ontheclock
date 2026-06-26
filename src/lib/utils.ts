import { startOfWeek, format, parseISO, differenceInCalendarDays } from 'date-fns'
import { holidayFor } from './holidays'

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

/** Timesheet submission timeliness. On-time if submitted by 5:00 pm the day
 *  after the Fri–Thu pay week ends (i.e. the Friday after `weekStart`,
 *  weekStart + 7 days, 17:00). Returns null when there is no submission
 *  timestamp — historical timesheets predate submitted_at tracking.
 *  NOTE: uses the viewer's local clock for the 5pm cutoff; correct for
 *  Melbourne-based users (the app's timezone elsewhere). */
export function timesheetSubmissionStatus(
  weekStart: string,
  submittedAt: string | null | undefined,
): 'on-time' | 'late' | null {
  if (!submittedAt) return null
  const cutoff = new Date(`${weekStart}T00:00:00`)
  cutoff.setDate(cutoff.getDate() + 7)
  cutoff.setHours(17, 0, 0, 0)
  return new Date(submittedAt).getTime() <= cutoff.getTime() ? 'on-time' : 'late'
}

/** On-time / late flag style: ALL CAPS, Forma DJR Text Regular, 10px, grey. */
export const onTimeFlagCls = 'text-[10px] font-forma font-normal uppercase text-muted'

/** Format a 'HH:MM[:SS]' time-of-day string as 12-hour am/pm (e.g. '7:00 am').
 *  Used for leave start/end times and the admin calendar (stored as `time`,
 *  not full timestamps, so `fmtTime` / parseISO don't apply). */
export function fmtClock(t: string | null | undefined): string {
  if (!t) return ''
  const [hStr, mStr] = t.split(':')
  const h = Number(hStr)
  const m = mStr ?? '00'
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = ((h + 11) % 12) + 1
  return `${h12}:${m} ${period}`
}

/** "Fri 25 Apr – Thu 1 May" — week runs Friday to Thursday */
export function fmtWeekRange(weekStart: string): string {
  const start = parseISO(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${format(start, 'EEE d MMM')} – ${format(end, 'EEE d MMM')}`
}

/** "8 Mar 2026 – 14 Mar 2026" — no weekday, includes year. Used by reports and dashboard. */
export function fmtWeekRangeLong(weekStart: string): string {
  const start = parseISO(weekStart)
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  return `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`
}

/** "8 Mar 2026" — single-day variant matching the same style */
export function fmtDateLong(iso: string): string {
  return format(parseISO(iso), 'd MMM yyyy')
}

/** Hours between two ISO timestamps, rounded to 2dp */
export function calcHours(clockIn: string, clockOut: string): number {
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  return Math.round((ms / 3_600_000) * 100) / 100
}

/** Working days between two date strings (inclusive) */
export function workdaysBetween(start: string, end: string): number {
  return differenceInCalendarDays(parseISO(end), parseISO(start)) + 1
}

/** True for Mon–Fri that are NOT VIC public holidays. */
export function isWorkday(d: Date): boolean {
  const dow = d.getDay()
  if (dow === 0 || dow === 6) return false   // Sun / Sat
  return holidayFor(d) === null
}

/** Hours of leave to deduct over [startDate, endDate] counting ONLY workdays
 *  (excludes Sat/Sun and VIC public holidays — those aren't deducted from a
 *  leave balance). First/last partial days use the supplied times capped at the
 *  daily figure; full middle workdays count `dailyHrs`. Mirrors the per-day
 *  shape the DB uses, so the deducted total matches the timesheet entries. */
export function computeLeaveHours(
  startDate: string, startTime: string, endDate: string, endTime: string, dailyHrs: number,
): number {
  if (!startDate || !endDate) return 0
  const start = new Date(`${startDate}T00:00:00`)
  const end   = new Date(`${endDate}T00:00:00`)
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)

  if (startDate === endDate) {
    if (!isWorkday(start)) return 0
    const hrs = ((eh * 60 + em) - (sh * 60 + sm)) / 60
    // Round to the nearest MINUTE (1/60 h), not 0.1 h. The old 0.1-h rounding
    // turned a real 5 h 51 m span (5.85 h) into 5.9 h (5 h 54 m), which both
    // mis-displayed the duration and falsely tripped "request exceeds balance".
    return Math.round(Math.min(Math.max(0, hrs), dailyHrs) * 60) / 60
  }

  let total = 0
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (!isWorkday(d)) continue
    let dayHrs = dailyHrs
    if (d.getTime() === start.getTime()) {
      // from start_time to the end of a 7am-anchored workday, capped at dailyHrs
      dayHrs = Math.max(0, Math.min((7 * 60 + dailyHrs * 60 - (sh * 60 + sm)) / 60, dailyHrs))
    } else if (d.getTime() === end.getTime()) {
      dayHrs = Math.max(0, Math.min(((eh * 60 + em) - 7 * 60) / 60, dailyHrs))
    }
    total += dayHrs
  }
  // Nearest minute, matching the single-day branch above.
  return Math.round(total * 60) / 60
}

/** Download an array of objects as a CSV file (kept for legacy callers) */
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

/** Download an array of row-objects as a branded .xlsx file.
 *  Header row gets the LB brand blue band (#1B89BB) with bold white caps
 *  text; body rows use Calibri 11pt black. Column widths auto-size to
 *  the widest value in each column.
 */
export async function exportXLSX(rows: Record<string, unknown>[], filename: string, sheetName = 'Report'): Promise<void> {
  if (!rows.length) return
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] })

  const headers = Object.keys(rows[0])
  ws.columns = headers.map(h => ({ header: h.toUpperCase(), key: h, width: Math.max(12, h.length + 2) }))

  // Style the header row — Calibri 9pt bold black on #ADADAD grey
  const headerRow = ws.getRow(1)
  headerRow.height = 22
  headerRow.eachCell(cell => {
    cell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF000000' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFADADAD' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })

  // Body — Calibri 9pt black
  for (const r of rows) {
    const row = ws.addRow(r)
    row.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } }
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
    })
  }

  // Auto-width to max content
  ws.columns.forEach(col => {
    let max = (col.header as string | undefined)?.length ?? 8
    col.eachCell?.({ includeEmpty: false }, cell => {
      const v = cell.value == null ? '' : String(cell.value)
      if (v.length > max) max = v.length
    })
    col.width = Math.min(60, Math.max(10, max + 2))
  })

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

/** Split hours decimal into integer hours and rounded minutes */
export function splitHM(h: number): { h: number; m: number } {
  const totalMin = Math.round(Number(h ?? 0) * 60)
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 }
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

/** Format hours as "Xh Ym" — never zero-padded (e.g. '1h 5m', '38h 41m') */
export function fmtHours(h: number): string {
  const totalMin = Math.round(Number(h ?? 0) * 60)
  const hrs  = Math.floor(totalMin / 60)
  const mins = totalMin % 60
  return `${hrs}h ${mins}m`
}

/** Gallery action-button style (Jun 2026): every action button — Submit, Save,
 *  Add, Approve, Reject, Export, Back, Cancel, Delete, etc. — renders the SAME
 *  way per the design gallery: #0352fb underlined text, Forma DJR Text,
 *  uppercase, on the grey #e8e8e8 fill, square corners. The old lime/grey/dark
 *  buckets are collapsed into one look; primary/secondary/danger are aliases.
 *  Keeps a keyboard-visible focus ring for tab-only users. */
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky'

const btnAction =
  `inline-flex items-center justify-center bg-[#e8e8e8] px-5 py-3 text-[10px] font-semibold font-forma uppercase tracking-[0.02em] underline text-[#0352fb] hover:opacity-80 transition-opacity ${FOCUS} disabled:opacity-50 disabled:cursor-not-allowed`

export const btnPrimary   = btnAction
export const btnSecondary = btnAction
export const btnDanger    = btnAction

/** Brand button colour tokens — now all the gallery action style (grey fill,
 *  #0352fb text) so per-page inline-styled buttons match the helpers. */
export const BTN = {
  actionBg:   '#e8e8e8',
  actionFg:   '#0352fb',
  mutedBg:    '#e8e8e8',
  mutedFg:    '#0352fb',
  mutedFgDk:  '#0352fb',
  darkBg:     '#e8e8e8',
  darkFg:     '#0352fb',
  charcoalBg: '#e8e8e8',
  charcoalFg: '#0352fb',
} as const

/** Text inputs / selects / textareas — square, 2px border, sky focus ring,
 *  faint placeholder so an empty field doesn't read as data. Focus uses an
 *  outline (not just border colour) so hue-only colour-blind users still see
 *  a perceptible state change. */
export const inputCls =
  'block w-full min-w-0 border-2 border-page bg-surface px-4 py-3 text-sm text-ink font-[Mona_Sans_SemiCondensed] placeholder:text-[#D9D9D9] focus:border-sky focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-sky'

/* Field labels (EMAIL / PASSWORD / form labels) — Forma DJR Text, 10px,
 * uppercase, .04em tracking, muted grey. Matches the gallery exactly. */
export const labelCls = 'block text-[10px] font-semibold font-forma uppercase tracking-[0.04em] text-muted mb-1'
