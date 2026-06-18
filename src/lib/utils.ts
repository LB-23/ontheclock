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
    cell.font = { name: 'Cerebri Sans Pro', size: 9, bold: true, color: { argb: 'FF000000' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFADADAD' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
  })

  // Body — Calibri 9pt black
  for (const r of rows) {
    const row = ws.addRow(r)
    row.eachCell(cell => {
      cell.font = { name: 'Cerebri Sans Pro', size: 9, color: { argb: 'FF000000' } }
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

/** Tailwind class helpers — May 2026 design system button buckets.
 *  Three roles, every label uppercase with 0.02em tracking:
 *    primary    #D7E363 / #000000 — save, submit for approval, save changes,
 *                                    clock-in, save edit, add entry
 *    secondary  #B4B3B3 / #FFFFFF — cancel, export, add manual entry,
 *                                    enable push reminders
 *    danger     #666666 / #FFFFFF — clock-out, delete, disable push, exit
 *  Per-page overrides via inline `style` still win when needed (e.g. a few
 *  background/text colours can ride on top via the `style` prop. */
/* All three helpers carry a keyboard-visible focus ring (sky 2px outline,
 * 2px offset) so tab-only users can always see where they are.            */
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky'

export const btnPrimary =
  `inline-flex items-center justify-center bg-[#D7E363] px-5 py-3 text-sm font-semibold font-forma uppercase tracking-[0.04em] text-black hover:opacity-90 active:scale-95 transition-colors ${FOCUS} disabled:opacity-50 disabled:cursor-not-allowed`

/* btnSecondary text flipped white → black: the previous #B4B3B3 + #FFFFFF
 * pair was ~2:1 (failing WCAG AA). Black on #B4B3B3 is ~9:1 — safe at any
 * brightness, including outdoor / job-site use.                            */
export const btnSecondary =
  `inline-flex items-center justify-center bg-[#B4B3B3] px-5 py-3 text-sm font-semibold font-forma uppercase tracking-[0.04em] text-black hover:opacity-90 active:scale-95 transition-colors ${FOCUS} disabled:opacity-50`

export const btnDanger =
  `inline-flex items-center justify-center bg-[#666666] px-5 py-3 text-sm font-semibold font-forma uppercase tracking-[0.04em] text-white hover:opacity-90 active:scale-95 transition-colors ${FOCUS} disabled:opacity-50`

/** Brand button colour tokens — referenced by inline style on per-page
 *  buttons so the colour intent is explicit at the call site. */
export const BTN = {
  actionBg:   '#D7E363', // lime — primary positive (Save, Submit, Clock-in)
  actionFg:   '#000000',
  mutedBg:    '#B4B3B3', // light-grey — secondary / neutral (Cancel, Export, Add Manual)
  mutedFg:    '#000000', // black on #B4B3B3 hits ~9:1 — passes WCAG AA easily
  mutedFgDk:  '#000000', // alias kept for back-compat; same value as mutedFg now
  darkBg:     '#666666', // mid-grey — destructive / exit (Clock-out, Delete, Disable push)
  darkFg:     '#FFFFFF',
  charcoalBg: '#666666', // admin delete actions — same bucket as `darkBg`
  charcoalFg: '#FFFFFF',
} as const

/** Text inputs / selects / textareas — square, 2px border, sky focus ring,
 *  faint placeholder so an empty field doesn't read as data. Focus uses an
 *  outline (not just border colour) so hue-only colour-blind users still see
 *  a perceptible state change. */
export const inputCls =
  'block w-full min-w-0 border-2 border-page bg-surface px-4 py-3 text-sm text-ink placeholder:text-[#D9D9D9] focus:border-sky focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-sky'

export const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-muted mb-1'
