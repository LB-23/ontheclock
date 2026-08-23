import { useEffect, useState } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, type Profile } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { exportXLSX, fmtHours, fmtDateLong, fmtWeekRangeLong, getWeekStart, timesheetSubmissionStatus, btnPrimary, btnDanger, labelCls, textLinkCls, reportHeadingCls, reportTableCls } from '../../lib/utils'
import { format, parseISO } from 'date-fns'
import { useEscapeKey } from '../../hooks/useEscapeKey'

type ReportTab = 'employee' | 'job' | 'weekly'
type WeeklyVariant = 'simple' | 'detailed'
type EmployeeSort = 'employee' | 'date' | 'site' | 'stage'
type Row = Record<string, unknown>

/** Embed the self-hosted Cerebri Sans Pro TTFs into a jsPDF doc and return the
 *  font name to use (falls back to Helvetica if the fetch fails). Same-origin
 *  fetch — no CDN, works offline once the SW has cached the assets. */
async function loadPdfFont(pdf: jsPDF): Promise<string> {
  try {
    const [reg, bold] = await Promise.all([
      fetch('/fonts/CerebriSansPro-Regular.ttf').then(r => r.ok ? r.arrayBuffer() : null),
      fetch('/fonts/CerebriSansPro-SemiBold.ttf').then(r => r.ok ? r.arrayBuffer() : null),
    ])
    if (reg && bold) {
      const b64 = (buf: ArrayBuffer) => {
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
        return btoa(bin)
      }
      pdf.addFileToVFS('CerebriSansPro-Regular.ttf', b64(reg))
      pdf.addFont('CerebriSansPro-Regular.ttf', 'Cerebri', 'normal')
      pdf.addFileToVFS('CerebriSansPro-SemiBold.ttf', b64(bold))
      pdf.addFont('CerebriSansPro-SemiBold.ttf', 'Cerebri', 'bold')
      return 'Cerebri'
    }
  } catch { /* fall back to Helvetica */ }
  return 'helvetica'
}

/** Weekly-Detailed PDF — mirrors the approved Excel template: a bold report
 *  title, grey header band, per-employee grey "WEEK TOTAL" rows with summed
 *  hours, and LEAVE TAKEN cells filled with the admin-calendar leave colour. */
async function weeklyDetailedRowsToPdf(rows: Row[], weekStart: string, filename: string) {
  if (rows.length === 0) return
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const bodyFont = await loadPdfFont(pdf)

  const weekLabel = format(parseISO(weekStart), 'd MMM yyyy').toUpperCase()
  pdf.setFont(bodyFont, 'bold'); pdf.setFontSize(13); pdf.setTextColor(0, 0, 0)
  pdf.text(`TIMESHEET REPORT - WEEK STARTING ${weekLabel}`, 40, 50)

  const headers = ['EMPLOYEE', 'DATE', 'DAY', 'SITE', 'STAGE', 'START TIME', 'END TIME', 'TOTAL HOURS', 'LEAVE TAKEN']
  const parseHM = (s: unknown): number => {
    const m = /(\d+)\s*h\s*(\d+)\s*m/.exec(String(s ?? ''))
    return m ? (+m[1] * 60 + +m[2]) : 0
  }
  const fmtHM = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`
  // Leave-type colour (RGB) by the LEAVE TAKEN label — matches the calendar.
  const leaveColour = (label: string): [number, number, number] | null => {
    if (label.startsWith('Annual Leave'))   return [215, 184, 244] // #D7B8F4
    if (label.startsWith('Personal'))        return [255, 191, 235] // #FFBFEB
    if (label.startsWith('TIL'))             return [255, 248, 159] // #FFF89F
    if (label.startsWith('Unpaid'))          return [254, 220, 182] // #fedcb6
    return null
  }

  // Group rows by employee; append a grey WEEK TOTAL row after each group.
  const body: string[][] = []
  const totalRows = new Set<number>()
  let i = 0
  while (i < rows.length) {
    const emp = rows[i].Employee
    let groupMin = 0
    while (i < rows.length && rows[i].Employee === emp) {
      const r = rows[i]
      body.push([
        String(r.Employee ?? ''), String(r.Date ?? ''), String(r.Day ?? ''), String(r.Site ?? ''),
        String(r.Stage ?? ''), String(r['Start Time'] ?? ''), String(r['End Time'] ?? ''),
        String(r['Total Hours'] ?? ''), String(r['Leave Taken'] ?? ''),
      ])
      groupMin += parseHM(r['Total Hours'])
      i++
    }
    totalRows.add(body.length)
    body.push(['', '', '', '', '', '', 'WEEK TOTAL', fmtHM(groupMin), ''])
  }

  autoTable(pdf, {
    startY: 70,
    head: [headers],
    body,
    styles: { font: bodyFont, fontStyle: 'normal', fontSize: 9, cellPadding: 5, lineColor: [240, 240, 240], textColor: [0, 0, 0] },
    headStyles: { font: bodyFont, fontStyle: 'bold', fontSize: 9, fillColor: [173, 173, 173], textColor: [0, 0, 0], halign: 'left' },
    didParseCell: data => {
      if (data.section !== 'body') return
      if (totalRows.has(data.row.index)) {
        // Grey + bold the "WEEK TOTAL" label and the summed-hours cell (as in Excel).
        if (data.column.index === 6 || data.column.index === 7) {
          data.cell.styles.fillColor = [173, 173, 173]
          data.cell.styles.fontStyle = 'bold'
        }
      } else if (data.column.index === 8) {
        const col = leaveColour(String(data.cell.raw ?? ''))
        if (col) data.cell.styles.fillColor = col
      }
    },
  })

  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

/** Render a Row[] as a branded PDF — generic table used by non-weekly-detailed reports. */
async function reportRowsToPdf(title: string, rows: Row[], filename: string, groupBy?: string) {
  if (rows.length === 0) return
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })
  const bodyFont = await loadPdfFont(pdf)

  pdf.setFont(bodyFont, 'bold'); pdf.setFontSize(13); pdf.setTextColor(0, 0, 0)
  pdf.text(title, 40, 50)

  const headers = Object.keys(rows[0]).map(h => h.toUpperCase())
  const body    = rows.map(r => Object.values(r).map(v => v == null ? '' : String(v)))

  // If grouped, insert a thicker bottom border between group changes
  let prevGroup = ''
  const groupBoundaries = new Set<number>()
  if (groupBy) {
    rows.forEach((r, i) => {
      const g = String(r[groupBy] ?? '')
      if (i > 0 && g !== prevGroup) groupBoundaries.add(i)
      prevGroup = g
    })
  }

  autoTable(pdf, {
    startY: 70,
    head: [headers],
    body,
    styles: { font: bodyFont, fontStyle: 'normal', fontSize: 9, cellPadding: 5, lineColor: [240, 240, 240], textColor: [0, 0, 0] },
    headStyles: { font: bodyFont, fontStyle: 'bold', fontSize: 9, fillColor: [173, 173, 173], textColor: [0, 0, 0], halign: 'left' },
    willDrawCell: data => {
      if (data.section === 'body' && groupBoundaries.has(data.row.index)) {
        // Draw a thick top border on the first row of each new group
        pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(1.4)
        pdf.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y)
      }
    },
  })

  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`)
}

/** Weekly-Detailed Excel export — matches the approved template exactly:
 *  bold Calibri-11 title, grey Calibri-9 header (height 21.95), a blank
 *  separator row, Calibri-9 body rows, a per-employee grey "WEEK TOTAL" row,
 *  and leave cells (LEAVE TAKEN column) filled with the leave-type colour used
 *  on the admin calendar. */
async function exportWeeklyDetailedXLSX(rows: Row[], weekStart: string, filename: string) {
  if (rows.length === 0) return
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Report')
  const GREY = 'FFADADAD'
  const BLACK = 'FF000000'

  ws.columns = [18, 13, 10, 31, 12, 12, 11.85546875, 13, 30].map(w => ({ width: w }))

  // Row 1 — title
  const weekLabel = format(parseISO(weekStart), 'd MMM yyyy').toUpperCase()
  const title = ws.addRow([`TIMESHEET REPORT - WEEK STARTING ${weekLabel}`])
  title.getCell(1).font = { name: 'Calibri', size: 11, bold: true }

  // Row 2 — header band
  const headers = ['EMPLOYEE', 'DATE', 'DAY', 'SITE', 'STAGE', 'START TIME', 'END TIME', 'TOTAL HOURS', 'LEAVE TAKEN']
  const hdr = ws.addRow(headers)
  hdr.height = 21.95
  hdr.eachCell(c => {
    c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: BLACK } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }
    c.alignment = { horizontal: 'left', vertical: 'middle' }
  })

  // Row 3 — blank separator
  ws.addRow([]).height = 15

  // Leave-type colour by the LEAVE TAKEN label prefix (matches admin calendar).
  const leaveFill = (label: string): string | null => {
    if (!label) return null
    if (label.startsWith('Annual Leave'))   return 'FFD7B8F4'
    if (label.startsWith('Personal'))       return 'FFFFBFEB'
    if (label.startsWith('TIL'))            return 'FFFFF89F'
    return null   // public holiday / unknown — no calendar colour
  }
  const parseHM = (s: unknown): number => {
    const m = /(\d+)\s*h\s*(\d+)\s*m/.exec(String(s ?? ''))
    return m ? (+m[1] * 60 + +m[2]) : 0
  }
  const fmtHM = (mins: number) => `${Math.floor(mins / 60)}h ${mins % 60}m`

  let i = 0
  while (i < rows.length) {
    const emp = rows[i].Employee
    let groupMin = 0
    while (i < rows.length && rows[i].Employee === emp) {
      const r = rows[i]
      const dataRow = ws.addRow([
        r.Employee, r.Date, r.Day, r.Site, r.Stage, r['Start Time'], r['End Time'], r['Total Hours'], r['Leave Taken'],
      ])
      dataRow.eachCell(c => {
        c.font = { name: 'Calibri', size: 9, color: { argb: BLACK } }
        c.alignment = { horizontal: 'left' }
      })
      const lf = leaveFill(String(r['Leave Taken'] ?? ''))
      if (lf) dataRow.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: lf } }
      groupMin += parseHM(r['Total Hours'])
      i++
    }
    // Per-employee WEEK TOTAL row (grey, bold) — label in G, sum in H.
    const tot = ws.addRow([])
    tot.height = 15
    for (const col of [7, 8]) {
      const c = tot.getCell(col)
      c.font = { name: 'Calibri', size: 9, bold: true, color: { argb: BLACK } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }
    }
    tot.getCell(7).value = 'WEEK TOTAL'
    tot.getCell(8).value = fmtHM(groupMin)
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

interface SavedReport {
  id: string
  name: string
  report_type: string
  date_from: string | null
  date_to: string | null
  generated_at: string
  data: Row[]
  generated_by: string
  generated_by_name?: string
}

export default function Reports() {
  const { profile: me } = useProfile()
  const [tab, setTab] = useState<ReportTab>('employee')
  const [employees, setEmployees] = useState<Profile[]>([])
  const [jobs, setJobs] = useState<{ id: string; address: string }[]>([])
  const [filterEmp, setFilterEmp] = useState('')
  const [filterJob, setFilterJob] = useState('')
  const [filterWeek, setFilterWeek] = useState(getWeekStart())
  const [dateFrom, setDateFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [weeklyVariant, setWeeklyVariant] = useState<WeeklyVariant>('simple')
  const [empSort, setEmpSort] = useState<EmployeeSort>('employee')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [savedList, setSavedList] = useState<SavedReport[]>([])
  const [openSaved, setOpenSaved] = useState<SavedReport | null>(null)

  // Esc closes the saved-report viewer dialog
  useEscapeKey(!!openSaved, () => setOpenSaved(null))

  useEffect(() => {
    // Filter to employees only — admin accounts shouldn't clutter the report-builder picker
    supabase.from('profiles').select('id, full_name').eq('app_role', 'employee').order('full_name').then(({ data }) => setEmployees((data as Profile[]) ?? []))
    supabase.from('job_addresses').select('id, address').eq('is_active', true).order('address').then(({ data }) => setJobs(data ?? []))
    loadSaved()
  }, [])

  const loadSaved = async () => {
    const { data } = await supabase
      .from('saved_reports')
      .select('*, profiles!saved_reports_generated_by_fkey(full_name)')
      .order('generated_at', { ascending: false })
    const enriched = (data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as unknown as SavedReport),
      generated_by_name: (r.profiles as { full_name?: string } | undefined)?.full_name,
    })) as SavedReport[]
    setSavedList(enriched)
  }

  // Helper: type label for an entry_type
  const entryTypeLabel = (t: string | null | undefined): string => {
    if (!t || t === 'regular') return ''
    if (t === 'annual_leave')   return 'Annual Leave'
    if (t === 'personal_leave') return 'Personal/Sick Leave'
    if (t === 'time_in_lieu')   return 'TIL'
    if (t === 'public_holiday') return 'Public Holiday'
    return t
  }

  const runReport = async () => {
    setLoading(true)
    let nextRows: Row[] = []
    if (tab === 'employee') {
      let q = supabase.from('time_entries').select('*, profiles!time_entries_employee_id_fkey(full_name), job_addresses(address), stages(name)')
        .gte('clock_in', dateFrom).lte('clock_in', dateTo + 'T23:59:59')
      if (filterEmp) q = q.eq('employee_id', filterEmp)
      const { data } = await q
      const entryRows = (data ?? []) as Record<string, unknown>[]

      // Timesheet submission timeliness + approver, keyed by employee|week_start,
      // for the weeks present in this result set.
      const weeks = [...new Set(entryRows.map(e => e.week_start as string).filter(Boolean))]
      const tsMap: Record<string, { status: 'on-time' | 'late' | null; approver: string }> = {}
      let onTimeTotal = 0, lateTotal = 0
      if (weeks.length) {
        let tq = supabase.from('timesheets')
          .select('employee_id, week_start, submitted_at, approver:profiles!timesheets_approved_by_fkey(full_name)')
          .in('week_start', weeks)
        if (filterEmp) tq = tq.eq('employee_id', filterEmp)
        const { data: tsData } = await tq
        for (const t of (tsData ?? []) as unknown as Array<{ employee_id: string; week_start: string; submitted_at: string | null; approver?: { full_name: string } | null }>) {
          const st = timesheetSubmissionStatus(t.week_start, t.submitted_at)
          tsMap[`${t.employee_id}|${t.week_start}`] = { status: st, approver: t.approver?.full_name ?? '' }
          if (st === 'on-time') onTimeTotal++
          else if (st === 'late') lateTotal++
        }
      }

      // Map first, then sort per user-selected key (Employee by default)
      const mapped = entryRows.map((e) => {
        const isLeave = e.entry_type && e.entry_type !== 'regular'
        const leaveLabel = entryTypeLabel(e.entry_type as string)
        const ts = tsMap[`${e.employee_id as string}|${e.week_start as string}`]
        return {
          Employee:   (e.profiles as { full_name: string })?.full_name ?? '',
          Date:       e.clock_in ? fmtDateLong(e.clock_in as string) : '',
          Site:       (e.job_addresses as { address: string })?.address ?? '',
          Stage:      (e.stages as { name: string })?.name ?? '',
          'Clock-In':  e.clock_in  ? format(new Date(e.clock_in  as string), 'h:mm aaa') : '',
          'Clock-Out': e.clock_out ? format(new Date(e.clock_out as string), 'h:mm aaa') : '',
          Hours:      fmtHours(Number(e.total_hours ?? 0)),
          'Additional Hrs': e.is_overtime ? 'Yes' : 'No',
          'Leave Taken': isLeave ? `${leaveLabel} (${fmtHours(Number(e.total_hours ?? 0))})` : '',
          Submission: ts?.status ? ts.status.toUpperCase() : '',
          'Approved By': ts?.approver ?? '',
          Notes:      (e.notes as string) ?? '',
          // Hidden sort keys (stripped before export below)
          __date: e.clock_in as string,
        }
      })
      const sortKey: Record<EmployeeSort, (r: Record<string, unknown>) => string> = {
        employee: r => String(r.Employee) + '_' + String(r.__date),
        date:     r => String(r.__date),
        site:     r => String(r.Site) + '_' + String(r.__date),
        stage:    r => String(r.Stage) + '_' + String(r.__date),
      }
      mapped.sort((a, b) => sortKey[empSort](a).localeCompare(sortKey[empSort](b)))
      nextRows = mapped.map(({ __date, ...rest }) => { void __date; return rest })
      // Totals line at the end: timesheets submitted on-time vs late.
      if (nextRows.length) {
        nextRows.push({
          Employee: 'TOTALS', Date: '', Site: '', Stage: '', 'Clock-In': '', 'Clock-Out': '',
          Hours: '', 'Additional Hrs': '', 'Leave Taken': '',
          Submission: `ON-TIME: ${onTimeTotal} · LATE: ${lateTotal}`, 'Approved By': '',
          Notes: `Timesheets submitted on-time: ${onTimeTotal} · late: ${lateTotal}`,
        })
      }
    } else if (tab === 'job') {
      let q = supabase.from('time_entries').select('*, profiles!time_entries_employee_id_fkey(full_name), job_addresses(address), stages(name)')
        .gte('clock_in', dateFrom).lte('clock_in', dateTo + 'T23:59:59')
        .neq('entry_type', 'annual_leave').neq('entry_type', 'personal_leave')
        .neq('entry_type', 'time_in_lieu').neq('entry_type', 'public_holiday')
      if (filterJob) q = q.eq('job_address_id', filterJob)
      const { data } = await q.order('clock_in')
      const jobRows = (data ?? []) as Record<string, unknown>[]
      // By-job columns: Date, Site, Employee, Stage, Hours (Clock-In/Out dropped).
      nextRows = jobRows.map((e) => ({
        Date:      e.clock_in ? fmtDateLong(e.clock_in as string) : '',
        Site:      (e.job_addresses as { address: string })?.address ?? '',
        Employee:  (e.profiles as { full_name: string })?.full_name ?? '',
        Stage:     (e.stages as { name: string })?.name ?? '',
        Hours:     fmtHours(Number(e.total_hours ?? 0)),
      }))
      // Total-hours row beneath the Hours column.
      if (nextRows.length) {
        const totalH = jobRows.reduce((s, e) => s + Number(e.total_hours ?? 0), 0)
        nextRows.push({ Date: '', Site: '', Employee: '', Stage: 'TOTAL', Hours: fmtHours(totalH) })
      }
    } else {
      // Weekly All-Staff — simple OR detailed
      const ws = filterWeek || getWeekStart()
      if (weeklyVariant === 'simple') {
        const { data } = await supabase
          .from('timesheets')
          .select('*, profiles!timesheets_employee_id_fkey(full_name)')
          .eq('week_start', ws)
        // Pull leave-taken hours per employee for that week, by entry_type (excluding regular)
        const employeeIds = (data ?? []).map(t => (t as { employee_id: string }).employee_id)
        const { data: leaves } = await supabase
          .from('time_entries')
          .select('employee_id, entry_type, total_hours')
          .in('employee_id', employeeIds.length ? employeeIds : ['00000000-0000-0000-0000-000000000000'])
          .eq('week_start', ws)
          .neq('entry_type', 'regular')
        const byEmp: Record<string, Record<string, number>> = {}
        for (const lr of (leaves ?? []) as Array<{ employee_id: string; entry_type: string; total_hours: number }>) {
          byEmp[lr.employee_id] = byEmp[lr.employee_id] ?? {}
          const k = entryTypeLabel(lr.entry_type)
          byEmp[lr.employee_id][k] = (byEmp[lr.employee_id][k] ?? 0) + Number(lr.total_hours ?? 0)
        }
        nextRows = (data ?? []).map((t: Record<string, unknown>) => {
          const eid = t.employee_id as string
          const leaveStr = byEmp[eid]
            ? Object.entries(byEmp[eid]).map(([k, v]) => `${k} ${fmtHours(v)}`).join(' · ')
            : ''
          return {
            Employee:    (t.profiles as Profile)?.full_name ?? '',
            'Week Ending': fmtWeekRangeLong(t.week_start as string),
            'Total Hours': fmtHours(Number(t.total_hours ?? 0)),
            'Leave Taken': leaveStr,
          }
        })
      } else {
        // Detailed: every entry across every employee for the week, separated by employee
        const { data } = await supabase
          .from('time_entries')
          .select('*, profiles!time_entries_employee_id_fkey(full_name), job_addresses(address), stages(name)')
          .eq('week_start', ws)
          .order('employee_id')
          .order('clock_in')
        nextRows = (data ?? []).map((e: Record<string, unknown>) => {
          const isLeave = e.entry_type && e.entry_type !== 'regular'
          const leaveLabel = entryTypeLabel(e.entry_type as string)
          return {
            Employee:     (e.profiles as { full_name: string })?.full_name ?? '',
            Date:         e.clock_in ? fmtDateLong(e.clock_in as string) : '',
            Day:          e.clock_in ? format(new Date(e.clock_in as string), 'EEE') : '',
            Site:         (e.job_addresses as { address: string })?.address ?? '',
            Stage:        (e.stages as { name: string })?.name ?? '',
            'Start Time': e.clock_in  ? format(new Date(e.clock_in  as string), 'h:mm aaa') : '',
            'End Time':   e.clock_out ? format(new Date(e.clock_out as string), 'h:mm aaa') : '',
            'Total Hours': fmtHours(Number(e.total_hours ?? 0)),
            'Leave Taken': isLeave ? `${leaveLabel} (${fmtHours(Number(e.total_hours ?? 0))})` : '',
          }
        })
      }
    }
    setRows(nextRows)
    setLoading(false)
  }

  const inputCls = 'block min-w-0 rounded-xl border border-page bg-surface px-3 py-2 text-sm focus:border-sky focus:outline-none'

  // Save the currently-displayed report into the saved_reports archive
  const saveReport = async () => {
    if (!me || rows.length === 0) return
    const today = format(new Date(), 'd MMM yyyy')
    const name =
      tab === 'employee' ? `By Employee — ${dateFrom} → ${dateTo}` :
      tab === 'job'      ? `By Job Site — ${dateFrom} → ${dateTo}` :
      weeklyVariant === 'simple'
        ? `Weekly Simple — ${fmtWeekRangeLong(filterWeek)}`
        : `Weekly Detailed — ${fmtWeekRangeLong(filterWeek)}`
    const reportType = tab === 'weekly' ? `weekly_${weeklyVariant}` : tab
    const { error } = await supabase.from('saved_reports').insert({
      name,
      report_type: reportType,
      date_from: tab === 'weekly' ? filterWeek : dateFrom,
      date_to:   tab === 'weekly' ? filterWeek : dateTo,
      generated_by: me.id,
      data: rows,
    })
    if (error) { alert('Save failed: ' + error.message); return }
    alert(`Report saved: ${name} (generated ${today})`)
    loadSaved()
  }

  const deleteSaved = async (sr: SavedReport) => {
    if (!confirm(`Delete saved report "${sr.name}"?`)) return
    await supabase.from('saved_reports').delete().eq('id', sr.id)
    setOpenSaved(null)
    loadSaved()
  }

  // Render a Row[] as an HTML table — used for both live and saved-report viewing
  const renderTable = (data: Row[], opts?: { groupBy?: string }) => {
    if (data.length === 0) return null
    const headers = Object.keys(data[0])
    let lastGroupKey = ''
    return (
      <div className="bg-surface rounded-2xl border border-page shadow-sm overflow-x-auto">
        <table className={`w-full text-sm ${reportTableCls}`}>
          <thead className="bg-page">
            <tr>
              {headers.map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-page">
            {data.map((r, i) => {
              const groupKey = opts?.groupBy ? String(r[opts.groupBy] ?? '') : ''
              const showSeparator = !!opts?.groupBy && groupKey && groupKey !== lastGroupKey && i > 0
              if (opts?.groupBy) lastGroupKey = groupKey
              return (
                <tr key={i} className={`hover:bg-page ${showSeparator ? 'border-t-4 border-t-ink' : ''}`}>
                  {Object.values(r).map((v, j) => (
                    <td key={j} className="px-4 py-3 text-ink whitespace-nowrap font-[Mona_Sans_SemiCondensed]">{String(v ?? '—') || '—'}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 py-3 text-xs text-muted">{data.length} rows</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className={reportHeadingCls}>Reports</h1>

      <div className="flex gap-2 flex-wrap">
        {([['employee','By Employee'],['job','By Job Site'],['weekly','Weekly All-Staff']] as const).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); setRows([]) }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === t ? 'bg-sky text-white' : 'bg-surface border border-page text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
        {(tab === 'employee' || tab === 'job') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <label className={labelCls}>From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div className="min-w-0">
              <label className={labelCls}>To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}
        {tab === 'employee' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className={labelCls}>Filter Employee</label>
              <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className={inputCls}>
                <option value="">All employees</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div className="min-w-0">
              <label className={labelCls}>Sort By</label>
              <select value={empSort} onChange={e => setEmpSort(e.target.value as EmployeeSort)} className={inputCls}>
                <option value="employee">Employee</option>
                <option value="date">Date</option>
                <option value="site">Job Site</option>
                <option value="stage">Stage</option>
              </select>
            </div>
          </div>
        )}
        {tab === 'job' && (
          <select value={filterJob} onChange={e => setFilterJob(e.target.value)} className={inputCls}>
            <option value="">All sites</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.address}</option>)}
          </select>
        )}
        {tab === 'weekly' && (
          <>
            <div>
              <label className={labelCls}>Week Starting (Friday)</label>
              <input type="date" value={filterWeek} onChange={e => setFilterWeek(e.target.value)} className={inputCls} />
            </div>
            <fieldset className="border border-page rounded-xl p-3">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted px-2">Report variant</legend>
              <label className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                <input type="radio" name="weeklyVariant" checked={weeklyVariant === 'simple'}
                       onChange={() => setWeeklyVariant('simple')} className="accent-sky" />
                <span><strong>Simple</strong> — Employee, Week Ending, Total Hours, Leave Taken</span>
              </label>
              <label className="flex items-center gap-2 text-sm py-1 cursor-pointer">
                <input type="radio" name="weeklyVariant" checked={weeklyVariant === 'detailed'}
                       onChange={() => setWeeklyVariant('detailed')} className="accent-sky" />
                <span><strong>Detailed</strong> — Date, Day, Site, Stage, Start Time, End Time, Total Hours, Leave Taken</span>
              </label>
            </fieldset>
          </>
        )}
        <div className="flex gap-3 flex-wrap items-end">
          <button
            onClick={runReport}
            disabled={loading}
            style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
            className={btnPrimary}
          >
            {loading ? 'Loading…' : 'Run Report'}
          </button>
          {rows.length > 0 && (
            <>
              <div className="relative">
                <details className="group">
                  <summary className={`${textLinkCls} cursor-pointer list-none select-none`}>↓ Export</summary>
                  <div className="absolute right-0 mt-2 z-10 bg-surface border border-page rounded-xl shadow-lg min-w-[160px] overflow-hidden">
                    <button onClick={() => (tab === 'weekly' && weeklyVariant === 'detailed')
                              ? exportWeeklyDetailedXLSX(rows, filterWeek, `ontheclock-weekly_detailed-report.xlsx`)
                              : exportXLSX(rows, `ontheclock-${tab === 'weekly' ? 'weekly_' + weeklyVariant : tab}-report.xlsx`)}
                            className="block w-full px-4 py-2 text-left text-sm hover:bg-page">Excel (.xlsx)</button>
                    <button onClick={() => (tab === 'weekly' && weeklyVariant === 'detailed')
                              ? weeklyDetailedRowsToPdf(rows, filterWeek, `ontheclock-weekly_detailed-report.pdf`)
                              : reportRowsToPdf(`${tab === 'weekly' ? 'Weekly ' + weeklyVariant : tab === 'employee' ? 'By Employee' : 'By Job Site'} report`, rows, `ontheclock-${tab === 'weekly' ? 'weekly_' + weeklyVariant : tab}-report.pdf`, tab === 'employee' ? 'Employee' : undefined)}
                            className="block w-full px-4 py-2 text-left text-sm hover:bg-page">PDF (.pdf)</button>
                  </div>
                </details>
              </div>
              <button onClick={saveReport} className={textLinkCls}>Save Report</button>
            </>
          )}
        </div>
      </div>

      {/* Live result */}
      {rows.length > 0 && renderTable(
        rows,
        (tab === 'weekly' && weeklyVariant === 'detailed')                ? { groupBy: 'Employee' }
        : (tab === 'employee' && empSort === 'employee' && !filterEmp)    ? { groupBy: 'Employee' }
        : undefined,
      )}

      {/* Saved reports archive */}
      <div className="bg-surface rounded-2xl border border-page shadow-sm">
        <div className="px-5 py-4 border-b border-page">
          <h2 className="font-semibold text-ink">Saved Reports</h2>
          <p className="text-xs text-muted mt-0.5">All reports generated by any admin. Click to open or delete.</p>
        </div>
        {savedList.length === 0 ? (
          <div className="px-5 py-6 text-center text-sm" style={{ color: '#D9D9D9' }}>
            <p>No Saved Reports Yet</p>
            <p className="text-xs mt-1">Generate one from the Reports tab above.</p>
          </div>
        ) : (
          <div className="divide-y divide-page">
            {savedList.map(sr => (
              <button key={sr.id} onClick={() => setOpenSaved(sr)}
                      className="w-full px-5 py-3 flex justify-between items-center text-left hover:bg-page transition-colors">
                <div>
                  <p className="text-sm font-medium text-ink">{sr.name}</p>
                  <p className="text-xs text-muted">
                    {sr.report_type.replace('_', ' ')} · generated {fmtDateLong(sr.generated_at)}
                    {sr.generated_by_name ? ` · by ${sr.generated_by_name}` : ''}
                  </p>
                </div>
                <span className="text-xs text-muted">View ▸</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Saved-report viewer dialog */}
      {openSaved && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6"
             onClick={() => setOpenSaved(null)}>
          <div className="bg-surface rounded-2xl shadow-lg w-full max-w-5xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">{openSaved.name}</p>
                <p className="text-xs text-muted">
                  {openSaved.report_type.replace('_', ' ')} · generated {fmtDateLong(openSaved.generated_at)}
                  {openSaved.generated_by_name ? ` · by ${openSaved.generated_by_name}` : ''}
                </p>
              </div>
              <button onClick={() => setOpenSaved(null)} className="text-muted hover:text-ink">✕</button>
            </div>
            {renderTable(openSaved.data, openSaved.report_type === 'weekly_detailed' ? { groupBy: 'Employee' } : undefined)}
            <div className="flex gap-3 pt-2">
              <button onClick={() => openSaved.report_type === 'weekly_detailed'
                        ? exportWeeklyDetailedXLSX(openSaved.data, openSaved.date_from ?? '', `${openSaved.name.replace(/[^a-z0-9]+/gi, '_')}.xlsx`)
                        : exportXLSX(openSaved.data, `${openSaved.name.replace(/[^a-z0-9]+/gi, '_')}.xlsx`)} className={textLinkCls}>↓ Excel</button>
              <button onClick={() => openSaved.report_type === 'weekly_detailed'
                        ? weeklyDetailedRowsToPdf(openSaved.data, openSaved.date_from ?? '', `${openSaved.name.replace(/[^a-z0-9]+/gi, '_')}.pdf`)
                        : reportRowsToPdf(openSaved.name, openSaved.data, `${openSaved.name.replace(/[^a-z0-9]+/gi, '_')}.pdf`, openSaved.report_type === 'employee' ? 'Employee' : undefined)} className={textLinkCls}>↓ PDF</button>
              <button onClick={() => deleteSaved(openSaved)} className={btnDanger}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
