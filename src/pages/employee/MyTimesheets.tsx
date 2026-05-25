import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, type TimeEntry, type Timesheet, type JobAddress } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, splitHM, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'

/** Maps an entry_type to the label shown in the Notes column for leave rows */
function leaveLabel(t: TimeEntry['entry_type']): string {
  switch (t) {
    case 'annual_leave':   return 'Annual Leave'
    case 'personal_leave': return 'Personal/Sick Leave'
    case 'time_in_lieu':   return 'TIL'
    case 'public_holiday': return 'Public Holiday'
    default:               return ''
  }
}

type EditDraft = {
  entry: TimeEntry
  newClockIn:  string  // datetime-local format: YYYY-MM-DDTHH:mm
  newClockOut: string
  newJobId:    string  // job_address_id
  reason:      string
}

export default function MyTimesheets() {
  const { profile } = useProfile()
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [selected, setSelected] = useState<Timesheet | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<EditDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [jobAddresses, setJobAddresses] = useState<JobAddress[]>([])
  const [err, setErr] = useState('')

  // Export dialog
  const [showExport, setShowExport] = useState(false)
  const [expFrom, setExpFrom] = useState('')
  const [expTo,   setExpTo]   = useState('')
  const [exporting, setExporting] = useState(false)

  // Manual entry form
  const [showManualForm, setShowManualForm] = useState(false)
  const [manualSaving, setManualSaving] = useState(false)
  const [manual, setManual] = useState({
    date: '',
    clock_in: '07:00',
    clock_out: '15:00',
    job_address_id: '',
  })

  useEffect(() => {
    supabase.from('job_addresses').select('*').eq('is_active', true).order('address')
      .then(({ data }) => setJobAddresses(data ?? []))
  }, [])

  const loadTimesheets = () => {
    if (!profile) return
    supabase
      .from('timesheets')
      .select('*')
      .eq('employee_id', profile.id)
      .order('week_start', { ascending: false })
      .then(({ data }) => { setTimesheets((data as Timesheet[]) ?? []); setLoading(false) })
  }

  useEffect(loadTimesheets, [profile])

  const loadEntries = async (ts: Timesheet) => {
    setSelected(ts)
    if (!profile) return
    const { data } = await supabase
      .from('time_entries')
      .select('*, job_addresses(address), stages(name)')
      .eq('employee_id', profile.id)
      .eq('week_start', ts.week_start)
      .order('clock_in')
    setEntries((data as TimeEntry[]) ?? [])
  }

  const reloadEntries = async () => {
    if (!selected) return
    await loadEntries(selected)
    // Reload timesheet too (totals will have changed via trigger)
    const { data: t } = await supabase
      .from('timesheets').select('*').eq('id', selected.id).single()
    if (t) setSelected(t as Timesheet)
    loadTimesheets()
  }

  const isoToLocalInput = (iso: string | null) =>
    iso ? format(new Date(iso), "yyyy-MM-dd'T'HH:mm") : ''

  const localInputToIso = (local: string) =>
    local ? new Date(local).toISOString() : ''

  const openEdit = (e: TimeEntry) => {
    setEditing({
      entry: e,
      newClockIn:  isoToLocalInput(e.clock_in),
      newClockOut: isoToLocalInput(e.clock_out),
      newJobId:    e.job_address_id ?? '',
      reason:      '',
    })
    setErr('')
  }

  /** Fetch a TTF and base64-encode it for jsPDF.addFileToVFS. Returns null on failure. */
  const fetchTtfBase64 = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      return btoa(bin)
    } catch { return null }
  }

  /** Format an ISO timestamp as h:mm AM/PM (Australian style) */
  const fmtPdfTime = (iso: string) => format(new Date(iso), 'h:mm aaa')

  /** Capitalise first letter of a status word: 'submitted' -> 'Submitted' */
  const capStatus = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : ''

  /** Helper used by both PDF + XLSX exports: pull every timesheet + entries for the range */
  const loadRange = async () => {
    if (!profile || !expFrom || !expTo) { setErr('Pick a date range first.'); return null }
    const { data: tsRows } = await supabase
      .from('timesheets').select('*')
      .eq('employee_id', profile.id)
      .gte('week_start', expFrom).lte('week_start', expTo)
      .order('week_start')
    const sheets = (tsRows as Timesheet[]) ?? []
    if (sheets.length === 0) { setErr('No timesheets found in that range.'); return null }

    const weekStarts = sheets.map(s => s.week_start)
    const { data: entryRows } = await supabase
      .from('time_entries')
      .select('*, job_addresses(address), stages(name)')
      .eq('employee_id', profile.id)
      .in('week_start', weekStarts)
      .order('clock_in')
    const byWeek: Record<string, TimeEntry[]> = {}
    for (const e of (entryRows as TimeEntry[]) ?? []) {
      const k = e.week_start ?? ''
      ;(byWeek[k] ||= []).push(e)
    }
    return { sheets, byWeek }
  }

  /** Export every timesheet in [expFrom..expTo] as a multi-page PDF, one week per page.
   *  Layout follows the user's spec image: bold employee name, caps TIMESHEET/STATUS
   *  meta lines, a blue header band, 11pt body rows in black (or #1C8DBF for leave-only
   *  rows), and a stacked Regular/Overtime/Total summary with blue label cells and
   *  separate H + M number columns. */
  const exportPdf = async () => {
    if (!profile) return
    setExporting(true); setErr('')
    const loaded = await loadRange()
    if (!loaded) { setExporting(false); return }
    const { sheets, byWeek } = loaded

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' })

    // Embed Barlow (Semi Bold variant) from jsdelivr's Google Fonts mirror.
    // Falls back to Helvetica if the fetch fails (offline / CORS).
    let bodyFont = 'helvetica'
    const BARLOW_BASE = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/barlow'
    const [barlowReg, barlowBold, barlowIt] = await Promise.all([
      fetchTtfBase64(`${BARLOW_BASE}/Barlow-Regular.ttf`),
      fetchTtfBase64(`${BARLOW_BASE}/Barlow-SemiBold.ttf`),
      fetchTtfBase64(`${BARLOW_BASE}/Barlow-Italic.ttf`),
    ])
    if (barlowReg && barlowBold) {
      pdf.addFileToVFS('Barlow-Regular.ttf', barlowReg)
      pdf.addFont('Barlow-Regular.ttf', 'Barlow', 'normal')
      pdf.addFileToVFS('Barlow-SemiBold.ttf', barlowBold)
      pdf.addFont('Barlow-SemiBold.ttf', 'Barlow', 'bold')
      if (barlowIt) {
        pdf.addFileToVFS('Barlow-Italic.ttf', barlowIt)
        pdf.addFont('Barlow-Italic.ttf', 'Barlow', 'italic')
      }
      bodyFont = 'Barlow'
    }

    // Greys per user spec
    const HEAD_BG : [number, number, number] = [173, 173, 173]   // #ADADAD - column band
    const SUM_1   : [number, number, number] = [127, 127, 127]   // #7F7F7F - REGULAR
    const SUM_2   : [number, number, number] = [89, 89, 89]      // #595959 - OVERTIME
    const SUM_3   : [number, number, number] = [64, 64, 64]      // #404040 - TOTAL HOURS
    const LEAVE_FG: [number, number, number] = [28, 141, 191]    // #1C8DBF
    const RED     : [number, number, number] = [255, 40, 40]     // #FF2828 - flagged notes
    const BLACK   : [number, number, number] = [0, 0, 0]

    const isFlaggedNote = (n: string | null | undefined) =>
      !!n && (n.includes('Auto-closed') || n.includes('Added manually'))

    // 'Xh Ym' lowercase, no padding, no space between digits and units
    const fmtCellHours = (h: number) => {
      const hm = splitHM(h)
      return `${hm.h}h ${hm.m}m`
    }

    sheets.forEach((ts, idx) => {
      if (idx > 0) pdf.addPage()

      // ── Header ──
      pdf.setFont(bodyFont, 'bold'); pdf.setFontSize(13); pdf.setTextColor(...BLACK)
      pdf.text(profile.full_name || 'Employee', 40, 50)

      pdf.setFontSize(9)
      pdf.text('TIMESHEET:', 40, 72)
      pdf.text('STATUS:',    40, 86)
      pdf.setFont(bodyFont, 'normal')
      pdf.text(fmtWeekRange(ts.week_start), 120, 72)
      pdf.text(capStatus(ts.status),         120, 86)

      // ── Body rows ──
      const entryRows = (byWeek[ts.week_start] ?? []).map(e => {
        const isLeave = e.entry_type && e.entry_type !== 'regular'
        const hoursStr = fmtCellHours(Number(e.total_hours ?? 0))
        if (isLeave) {
          return {
            cells: [
              format(new Date(e.clock_in), 'EEE d MMM'),
              '', '', '', '',
              hoursStr,
              leaveLabel(e.entry_type),
            ],
            colour: LEAVE_FG, italic: false, isLeave: true, isFlagged: false,
          }
        }
        return {
          cells: [
            format(new Date(e.clock_in), 'EEE d MMM'),
            (e.job_addresses as { address: string })?.address ?? '',
            (e.stages as { name: string })?.name ?? '',
            fmtPdfTime(e.clock_in),
            e.clock_out ? fmtPdfTime(e.clock_out) : '',
            hoursStr,
            e.notes ?? '',
          ],
          colour: BLACK,
          italic: false,
          isLeave: false,
          isFlagged: isFlaggedNote(e.notes),
        }
      })

      // Reserve column widths so we can compute the HOURS column x position
      const HOURS_COL_WIDTH = 64
      const NOTES_COL_WIDTH = 200

      let hoursColX = 0
      let hoursColW = 0
      autoTable(pdf, {
        startY: 105,
        head: [['DATE', 'SITE', 'STAGE', 'IN', 'OUT', 'HOURS', 'NOTES']],
        body: entryRows.length > 0
          ? entryRows.map(r => r.cells)
          : [['No entries this week', '', '', '', '', '', '']],
        styles: { font: bodyFont, fontStyle: 'normal', fontSize: 9, cellPadding: 5, lineColor: [240,240,240], textColor: BLACK },
        headStyles: { font: bodyFont, fontStyle: 'bold', fontSize: 9, fillColor: HEAD_BG, textColor: BLACK, halign: 'left' },
        columnStyles: {
          5: { cellWidth: HOURS_COL_WIDTH, halign: 'left' },
          6: { cellWidth: NOTES_COL_WIDTH },
        },
        didParseCell: data => {
          if (data.section !== 'body') return
          const r = entryRows[data.row.index]
          if (!r) return
          if (r.isLeave) { data.cell.styles.textColor = r.colour; return }
          if (data.column.index === 6 && r.isFlagged) {
            data.cell.styles.textColor = RED
            data.cell.styles.fontStyle = 'italic'
          }
        },
        didDrawCell: data => {
          // Capture the HOURS column's x + width on the FIRST head draw so the
          // summary block below can align its hours value to the same x.
          if (data.section === 'head' && data.column.index === 5 && hoursColX === 0) {
            hoursColX = data.cell.x
            hoursColW = data.cell.width
          }
        },
      })

      // ── Stacked summary aligned to HOURS column ──
      const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
      const reg = splitHM(Number(ts.regular_hours  ?? 0))
      const ot  = splitHM(Number(ts.overtime_hours ?? 0))
      const tot = splitHM(Number(ts.total_hours    ?? 0))

      // Label cell sits to the LEFT of the HOURS column; HOURS value sits inside the HOURS column rect
      const LABEL_W = 120
      const ROW_H   = 18
      const labelX  = hoursColX - LABEL_W  // place label cell directly abutting HOURS column
      const valueX  = hoursColX + 6        // hours value text left-aligned inside HOURS column

      const drawSummaryRow = (y: number, label: string, h: number, m: number, bg: [number, number, number], bold: boolean) => {
        pdf.setFillColor(...bg)
        pdf.rect(labelX, y, LABEL_W, ROW_H, 'F')
        pdf.setTextColor(255, 255, 255)
        pdf.setFont(bodyFont, bold ? 'bold' : 'normal')
        pdf.setFontSize(9)
        pdf.text(label.toUpperCase(), labelX + LABEL_W - 6, y + ROW_H / 2 + 3, { align: 'right' })
        // Single 'Xh Ym' string — no gap between hours and minutes, aligned to table HOURS column
        pdf.setTextColor(...BLACK)
        pdf.setFont(bodyFont, bold ? 'bold' : 'normal')
        pdf.text(`${h}h ${m}m`, valueX, y + ROW_H / 2 + 3)
      }

      drawSummaryRow(finalY,             'Regular',     reg.h, reg.m, SUM_1, false)
      drawSummaryRow(finalY + ROW_H,     'Overtime',    ot.h,  ot.m,  SUM_2, false)
      drawSummaryRow(finalY + ROW_H * 2, 'Total Hours', tot.h, tot.m, SUM_3, true)

      // Keep linter happy
      void hoursColW

      if (ts.admin_notes) {
        pdf.setFont(bodyFont, 'normal')
        pdf.setFontSize(9)
        pdf.setTextColor(...BLACK)
        pdf.text(`Admin note: ${ts.admin_notes}`, 40, finalY + ROW_H * 3 + 24, { maxWidth: 700 })
      }
    })

    pdf.save(`${profile.full_name.replace(/\s+/g, '_')}_timesheets_${expFrom}_to_${expTo}.pdf`)
    setExporting(false)
    setShowExport(false)
  }

  /** Export the same date range as a styled XLSX, one row per entry,
   *  matching the PDF's column structure (H + M separated). */
  const exportXlsx = async () => {
    if (!profile) return
    setExporting(true); setErr('')
    const loaded = await loadRange()
    if (!loaded) { setExporting(false); return }
    const { sheets, byWeek } = loaded

    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Timesheets', { views: [{ state: 'frozen', ySplit: 1 }] })

    ws.columns = [
      { header: 'EMPLOYEE',  key: 'employee',  width: 22 },
      { header: 'WEEK',      key: 'week',      width: 22 },
      { header: 'STATUS',    key: 'status',    width: 12 },
      { header: 'DATE',      key: 'date',      width: 14 },
      { header: 'SITE',      key: 'site',      width: 30 },
      { header: 'STAGE',     key: 'stage',     width: 14 },
      { header: 'IN',        key: 'in',        width: 10 },
      { header: 'OUT',       key: 'out',       width: 10 },
      { header: 'HOURS',     key: 'hours',     width: 10 },
      { header: 'NOTES',     key: 'notes',     width: 32 },
    ]
    const hdr = ws.getRow(1)
    hdr.height = 22
    hdr.eachCell(c => {
      c.font = { name: 'Barlow', size: 9, bold: true, color: { argb: 'FF000000' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFADADAD' } }
      c.alignment = { vertical: 'middle', horizontal: 'left' }
    })

    const isFlaggedNoteExcel = (n: string | null | undefined) =>
      !!n && (n.includes('Auto-closed') || n.includes('Added manually'))

    sheets.forEach(ts => {
      const entries = byWeek[ts.week_start] ?? []
      const writeRow = (row: Record<string, unknown>, opts: { isLeave: boolean; flaggedCol?: string }) => {
        const r = ws.addRow(row)
        const colour = opts.isLeave ? 'FF1C8DBF' : 'FF000000'
        r.eachCell((c, colNumber) => {
          c.font = { name: 'Barlow', size: 9, color: { argb: colour } }
          c.alignment = { vertical: 'middle', horizontal: 'left' }
          // Notes column auto-flag: Auto-closed / Added manually -> red italic
          const colKey = (ws.columns[colNumber - 1] as { key?: string }).key
          if (colKey === 'notes' && opts.flaggedCol === 'notes') {
            c.font = { name: 'Barlow', size: 9, italic: true, color: { argb: 'FFFF2828' } }
          }
        })
      }
      if (entries.length === 0) {
        writeRow({
          employee: profile.full_name, week: fmtWeekRange(ts.week_start), status: capStatus(ts.status),
          date: 'No entries this week', site: '', stage: '', in: '', out: '', hours: '', notes: '',
        }, { isLeave: false })
      } else {
        for (const e of entries) {
          const isLeave = e.entry_type && e.entry_type !== 'regular'
          const hm = splitHM(Number(e.total_hours ?? 0))
          const hoursStr = `${hm.h}h ${hm.m}m`
          if (isLeave) {
            writeRow({
              employee: profile.full_name,
              week: fmtWeekRange(ts.week_start),
              status: capStatus(ts.status),
              date: format(new Date(e.clock_in), 'EEE d MMM'),
              site: '', stage: '', in: '', out: '',
              hours: hoursStr,
              notes: leaveLabel(e.entry_type),
            }, { isLeave: true })
          } else {
            writeRow({
              employee: profile.full_name,
              week: fmtWeekRange(ts.week_start),
              status: capStatus(ts.status),
              date: format(new Date(e.clock_in), 'EEE d MMM'),
              site: (e.job_addresses as { address: string })?.address ?? '',
              stage: (e.stages as { name: string })?.name ?? '',
              in: format(new Date(e.clock_in), 'h:mm aaa'),
              out: e.clock_out ? format(new Date(e.clock_out), 'h:mm aaa') : '',
              hours: hoursStr,
              notes: e.notes ?? '',
            }, { isLeave: false, flaggedCol: isFlaggedNoteExcel(e.notes) ? 'notes' : undefined })
          }
        }
      }

      // Summary rows: Regular, Overtime, Total — coloured cell backgrounds per spec
      const reg = splitHM(Number(ts.regular_hours ?? 0))
      const ot  = splitHM(Number(ts.overtime_hours ?? 0))
      const tot = splitHM(Number(ts.total_hours ?? 0))
      const addSummary = (label: string, h: number, m: number, bgHex: string, bold: boolean) => {
        const hoursStr = `${h}h ${m}m`
        const r = ws.addRow({ employee: '', week: '', status: '', date: '', site: '', stage: '', in: '', out: label.toUpperCase(), hours: hoursStr, notes: '' })
        r.getCell('out').font = { name: 'Barlow', size: 9, bold, color: { argb: 'FFFFFFFF' } }
        r.getCell('out').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgHex } }
        r.getCell('out').alignment = { horizontal: 'right', vertical: 'middle' }
        r.getCell('hours').font = { name: 'Barlow', size: 9, bold, color: { argb: 'FF000000' } }
      }
      addSummary('Regular',     reg.h, reg.m, 'FF7F7F7F', false)
      addSummary('Overtime',    ot.h,  ot.m,  'FF595959', false)
      addSummary('Total Hours', tot.h, tot.m, 'FF404040', true)
      ws.addRow({})  // blank separator
    })

    const buf = await wb.xlsx.writeBuffer()
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${profile.full_name.replace(/\s+/g, '_')}_timesheets_${expFrom}_to_${expTo}.xlsx`
    a.click()
    URL.revokeObjectURL(url)

    setExporting(false)
    setShowExport(false)
  }

  const submitManualEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !selected) return
    if (!manual.date || !manual.clock_in || !manual.clock_out) { setErr('Date and times are required.'); return }
    setManualSaving(true); setErr('')

    const startIso = new Date(`${manual.date}T${manual.clock_in}:00`).toISOString()
    const endIso   = new Date(`${manual.date}T${manual.clock_out}:00`).toISOString()
    if (new Date(endIso) <= new Date(startIso)) {
      setErr('Clock-out must be after clock-in.')
      setManualSaving(false); return
    }
    const hrs = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000 * 100) / 100

    const { error: insErr } = await supabase.from('time_entries').insert({
      employee_id:    profile.id,
      clock_in:       startIso,
      clock_out:      endIso,
      job_address_id: manual.job_address_id || null,
      total_hours:    hrs,
      status:         'completed',
      week_start:     selected.week_start,
      notes:          'Added manually',
    })
    setManualSaving(false)
    if (insErr) { setErr(insErr.message); return }
    setShowManualForm(false)
    setManual({ date: '', clock_in: '07:00', clock_out: '15:00', job_address_id: '' })
    await reloadEntries()
  }

  const deleteEntry = async () => {
    if (!editing) return
    if (!confirm('Delete this time entry? This cannot be undone.')) return
    setDeleting(true)
    // Audit cascade-deletes via FK ON DELETE CASCADE on time_entry_edits
    const { error } = await supabase.from('time_entries').delete().eq('id', editing.entry.id)
    setDeleting(false)
    if (error) { setErr(error.message); return }
    setEditing(null)
    await reloadEntries()
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing || !profile) return

    const oldIn  = editing.entry.clock_in
    const oldOut = editing.entry.clock_out
    const oldJob = editing.entry.job_address_id ?? ''
    const newIn  = localInputToIso(editing.newClockIn)
    const newOut = editing.newClockOut ? localInputToIso(editing.newClockOut) : null
    const newJob = editing.newJobId

    const inChanged  = newIn !== oldIn
    const outChanged = newOut !== (oldOut ?? null)
    const jobChanged = newJob !== oldJob

    if (!inChanged && !outChanged && !jobChanged) {
      setErr('Nothing changed — close the dialog or adjust a field first.')
      return
    }

    // Reason is only required when clock_in or clock_out is edited
    if ((inChanged || outChanged) && !editing.reason.trim()) {
      setErr('Reason is required when changing clock-in or clock-out times.')
      return
    }

    setSaving(true)
    setErr('')

    if (newOut && new Date(newOut) <= new Date(newIn)) {
      setErr('Clock-out must be after clock-in.')
      setSaving(false)
      return
    }

    // Recalculate hours
    let totalH: number | null = null
    if (newOut) {
      totalH = Math.round(((new Date(newOut).getTime() - new Date(newIn).getTime()) / 3_600_000) * 100) / 100
    }

    // 1. Insert audit row (RLS requires edited_by = auth.uid())
    if (inChanged || outChanged) {
      const { error: editErr } = await supabase.from('time_entry_edits').insert({
        time_entry_id: editing.entry.id,
        edited_by:     profile.id,
        field_changed: inChanged && outChanged ? 'both' : (inChanged ? 'clock_in' : 'clock_out'),
        old_clock_in:  inChanged ? oldIn  : null,
        new_clock_in:  inChanged ? newIn  : null,
        old_clock_out: outChanged ? oldOut : null,
        new_clock_out: outChanged ? newOut : null,
        reason:        editing.reason.trim(),
      })
      if (editErr) { setErr(editErr.message); setSaving(false); return }
    }

    // 2. Update the entry itself
    const updates: Partial<TimeEntry> = {
      clock_in:       newIn,
      clock_out:      newOut,
      total_hours:    totalH,
      job_address_id: newJob || null,
      status:         'edited',
    }
    const { error: updErr } = await supabase
      .from('time_entries').update(updates).eq('id', editing.entry.id)
    if (updErr) { setErr(updErr.message); setSaving(false); return }

    setSaving(false)
    setEditing(null)
    await reloadEntries()
  }

  const submitTimesheet = async () => {
    if (!selected) return
    setSubmitting(true)
    const { error } = await supabase
      .from('timesheets')
      .update({ status: 'submitted' })
      .eq('id', selected.id)
    setSubmitting(false)
    if (error) { setErr(error.message); return }

    // Also flag all entries as submitted
    await supabase
      .from('time_entries')
      .update({ status: 'submitted' })
      .eq('employee_id', profile!.id)
      .eq('week_start', selected.week_start)
      .in('status', ['completed', 'edited'])

    setSelected(prev => prev ? { ...prev, status: 'submitted' } : prev)
    setTimesheets(prev => prev.map(t => t.id === selected.id ? { ...t, status: 'submitted' } : t))
    await reloadEntries()
  }

  const badgeCls = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize'
  const statusStyle = (s: string): React.CSSProperties => {
    if (s === 'submitted' || s === 'pending') return { backgroundColor: 'rgba(249,151,2,0.10)', color: '#F99702' }
    if (s === 'approved')                     return { backgroundColor: 'rgba(174,224,1,0.10)', color: '#AEE001' }
    if (s === 'rejected')                     return { backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' }
    return { backgroundColor: '#D9D9D9', color: '#666666' }   // draft (default)
  }

  if (loading) return <div className="text-center py-16 text-muted">Loading…</div>

  // Edit dialog
  const editDialog = editing && (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6">
      <form onSubmit={saveEdit} className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Edit Time Entry</p>
          <button type="button" onClick={() => { setEditing(null); setErr('') }} className="text-muted hover:text-muted">✕</button>
        </div>
        <p className="text-xs text-muted">{fmtDate(editing.entry.clock_in)} · {(editing.entry.job_addresses as { address: string })?.address}</p>

        <div>
          <label className={labelCls}>Job Site</label>
          <select
            value={editing.newJobId}
            onChange={e => setEditing(d => d ? { ...d, newJobId: e.target.value } : d)}
            className={inputCls}
          >
            <option value="">— None —</option>
            {jobAddresses.map(j => (
              <option key={j.id} value={j.id}>{j.address}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Clock-In</label>
          <input
            type="datetime-local"
            value={editing.newClockIn}
            onChange={e => setEditing(d => d ? { ...d, newClockIn: e.target.value } : d)}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Clock-Out</label>
          <input
            type="datetime-local"
            value={editing.newClockOut}
            onChange={e => setEditing(d => d ? { ...d, newClockOut: e.target.value } : d)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Reason for Edit <span className="text-red-500">*</span></label>
          <textarea
            value={editing.reason}
            onChange={e => setEditing(d => d ? { ...d, reason: e.target.value } : d)}
            className={`${inputCls} resize-none`}
            rows={3}
            placeholder="Forgot to clock out at end of day…"
          />
          <p className="text-[11px] text-muted mt-1">Required when changing clock-in/out times.</p>
        </div>

        {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => { setEditing(null); setErr('') }}
            style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
            className={`${btnSecondary} flex-1 h-11`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || deleting}
            style={{ backgroundColor: '#D7E363', color: '#141414' }}
            className={`${btnPrimary} flex-1 h-11`}
          >
            {saving ? 'Saving…' : 'Save Edit'}
          </button>
        </div>
        <button
          type="button"
          onClick={deleteEntry}
          disabled={saving || deleting}
          style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
          className={`${btnDanger} w-full h-11 mt-2`}
        >
          {deleting ? 'Deleting…' : 'Delete This Entry'}
        </button>
      </form>
    </div>
  )

  // Manual-entry dialog
  const manualDialog = showManualForm && selected && (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6">
      <form onSubmit={submitManualEntry} className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Add Manual Time Entry</p>
          <button type="button" onClick={() => { setShowManualForm(false); setErr('') }} className="text-muted hover:text-ink">✕</button>
        </div>
        <p className="text-[11px] italic" style={{ color: '#FF2828' }}>
          This entry will be flagged "Added manually" on your timesheet for admin visibility.
        </p>
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" value={manual.date}
                 min={selected.week_start}
                 onChange={e => setManual(m => ({ ...m, date: e.target.value }))}
                 className={inputCls} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Start Time</label>
            <input type="time" value={manual.clock_in}
                   onChange={e => setManual(m => ({ ...m, clock_in: e.target.value }))}
                   className={inputCls} required />
          </div>
          <div>
            <label className={labelCls}>End Time</label>
            <input type="time" value={manual.clock_out}
                   onChange={e => setManual(m => ({ ...m, clock_out: e.target.value }))}
                   className={inputCls} required />
          </div>
        </div>
        <div>
          <label className={labelCls}>Job Site</label>
          <select value={manual.job_address_id}
                  onChange={e => setManual(m => ({ ...m, job_address_id: e.target.value }))}
                  className={inputCls}>
            <option value="">— None —</option>
            {jobAddresses.map(j => <option key={j.id} value={j.id}>{j.address}</option>)}
          </select>
        </div>
        {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => { setShowManualForm(false); setErr('') }}
            style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
            className={`${btnSecondary} flex-1 h-11`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={manualSaving}
            style={{ backgroundColor: '#D7E363', color: '#141414' }}
            className={`${btnPrimary} flex-1 h-11`}
          >
            {manualSaving ? 'Adding…' : 'Add Entry'}
          </button>
        </div>
      </form>
    </div>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">My Timesheets</h1>

      {selected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelected(null)}
              style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
              className={btnSecondary}
            >
              ← Back
            </button>
            <div>
              <p className="font-semibold">{fmtWeekRange(selected.week_start)}</p>
              <span className={badgeCls} style={statusStyle(selected.status)}>{selected.status}</span>
            </div>
          </div>

          {selected.status === 'draft' && (
            <button
              onClick={() => { setShowManualForm(true); setErr('') }}
              style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
              className={`${btnPrimary} w-full h-11`}
            >
              + Add Manual Entry
            </button>
          )}

          <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
            {entries.length === 0 && (
              <p className="p-6 text-center text-muted">No Entries This Week</p>
            )}
            {entries.map(e => {
              const isSystem  = e.entry_type && e.entry_type !== 'regular'
              return (
                <div key={e.id} className="px-5 py-4 flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink">{fmtDate(e.clock_in)}</p>
                    {isSystem ? (
                      <p
                        className="text-[12px] italic mt-0.5"
                        style={{ color: '#15739D' }}
                      >
                        {e.notes /* 'Annual Leave', 'Personal/Sick Leave', 'TIL', or 'Public Holiday — <name>' */}
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted mt-0.5">
                          {fmtTime(e.clock_in)} → {e.clock_out ? fmtTime(e.clock_out) : 'Active'}
                        </p>
                        {(e.job_addresses as { address: string })?.address && (
                          <p className="text-xs text-muted mt-0.5 truncate">{(e.job_addresses as { address: string }).address}</p>
                        )}
                        {e.notes && (() => {
                          const isAuto    = e.notes.includes('Auto-closed')
                          const isManual  = e.notes.includes('Added manually')
                          const isRedItalic = isAuto || isManual
                          return (
                            <p
                              className={`text-[11px] mt-1 ${isRedItalic ? 'italic' : ''}`}
                              style={{ color: isRedItalic ? '#FF2828' : '#000000' }}
                            >
                              {e.notes}
                            </p>
                          )
                        })()}
                        {e.status === 'edited' && (
                          <span className="inline-flex items-center text-[10px] uppercase font-semibold mt-1" style={{ color: '#1C9FDA' }}>Edited</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <p className="text-sm font-bold text-ink">{e.total_hours ? fmtHours(e.total_hours) : '—'}</p>
                    {e.is_overtime && !isSystem && <span className="text-xs font-medium" style={{ color: '#1C9FDA' }}>OT</span>}
                    {selected.status === 'draft' && !isSystem && (
                      <button onClick={() => openEdit(e)} className="block mt-1 text-xs text-sky hover:underline">
                        Edit
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bg-surface rounded-2xl border border-page shadow-sm p-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-muted">Regular Hours</span>
              <span className="font-semibold">{fmtHours(selected.regular_hours ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm mb-4">
              <span className="text-muted">Overtime Hours</span>
              <span className="font-semibold" style={{ color: '#1C9FDA' }}>{fmtHours(selected.overtime_hours ?? 0)}</span>
            </div>
            <div className="flex justify-between font-bold border-t pt-3">
              <span>Total</span>
              <span>{fmtHours(selected.total_hours ?? 0)}</span>
            </div>
          </div>

          {selected.status === 'draft' && entries.length > 0 && (() => {
            const needClockOut = entries.some(e => !e.clock_out)
            // Prompt stays light-grey while any entry is open; once everything
            // is closed the CTA flips to the lime Submit For Approval colour.
            const bg = needClockOut ? '#A4A3A3' : '#D7E363'
            const fg = needClockOut ? '#FAFAFA' : '#141414'
            return (
              <button
                onClick={submitTimesheet}
                disabled={submitting || needClockOut}
                style={{ backgroundColor: bg, color: fg }}
                className="inline-flex items-center justify-center w-full h-12 text-sm font-semibold active:scale-95 transition-all disabled:opacity-60"
              >
                {submitting ? 'Submitting…' : needClockOut ? 'Clock-Out Of All Entries First' : 'Submit For Approval'}
              </button>
            )
          })()}
          {selected.status === 'rejected' && (
            <button
              onClick={async () => {
                await supabase.from('timesheets').update({ status: 'draft' }).eq('id', selected.id)
                setSelected(prev => prev ? { ...prev, status: 'draft' } : prev)
                loadTimesheets()
              }}
              className={`${btnPrimary} w-full h-12`}
            >
              Reopen for editing
            </button>
          )}

          {/* Permanent delete — uses the SECURITY DEFINER RPC so it can disable the
              recalc trigger atomically (otherwise sync_timesheet_on_entry_change
              re-INSERTs the timesheet via ON CONFLICT while entries are deleted,
              leaving an orphan row that re-appears in the list). */}
          <button
            onClick={async () => {
              if (!profile) return
              if (!confirm(`Remove Timesheet?\n\n${fmtWeekRange(selected.week_start)} — ${fmtHours(selected.total_hours ?? 0)} total\n\nThis permanently deletes the timesheet and every entry inside it. This cannot be undone.`)) return
              const { error } = await supabase.rpc('employee_delete_own_timesheet', { timesheet_id: selected.id })
              if (error) { alert(`Could not delete timesheet:\n${error.message}`); return }
              setSelected(null)
              loadTimesheets()
            }}
            style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
            className="inline-flex items-center justify-center w-full h-12 text-sm font-semibold active:scale-95 transition-all"
          >
            Delete Timesheet
          </button>

          {selected.admin_notes && (
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-700">
              💬 Admin note: {selected.admin_notes}
            </div>
          )}
        </div>
      ) : (
        <>
          <button
            onClick={() => {
              // Per spec: open with the date pickers BLANK so the user picks a
              // deliberate range every time rather than re-exporting whatever
              // happens to fall in the default window.
              setExpFrom(''); setExpTo(''); setShowExport(true); setErr('')
            }}
            style={{ backgroundColor: '#A4A3A3', color: '#141414' }}
            className={`${btnSecondary} w-full h-11`}
          >
            ↓ Export Timesheets
          </button>

          {timesheets.length === 0 && (
            <div className="text-center py-16 text-muted">No Timesheets Yet — Clock In Once To Start One.</div>
          )}
          <div className="space-y-3">
            {timesheets.map(ts => (
              <button
                key={ts.id}
                onClick={() => loadEntries(ts)}
                /* normal-case overrides the global `button { uppercase }`
                   so the week range renders "Fri 25 Apr – Thu 1 May" and the
                   total renders "38h 30m" exactly as fmt* emit them. */
                className="w-full text-left bg-surface border border-page px-5 py-4 flex justify-between items-center hover:border-sky/40 transition-colors normal-case"
              >
                <div>
                  <p className="text-sm font-semibold">{fmtWeekRange(ts.week_start)}</p>
                  <span className={badgeCls} style={statusStyle(ts.status)}>{ts.status}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-ink">{fmtHours(ts.total_hours ?? 0)}</p>
                  <p className="text-xs text-muted">→</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {showExport && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6">
          <div className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-semibold">Export Timesheets</p>
              <button onClick={() => { setShowExport(false); setErr('') }} className="text-muted hover:text-ink">✕</button>
            </div>
            <p className="text-xs text-muted">Select a date range for export.</p>
            {/* CSS grid (not flex) gives each cell a fixed 50% width that the
                native iOS date chrome cannot overflow. `overflow-hidden` on each
                cell clips any rogue picker UI, and `appearance:none` on the input
                neutralises Safari's intrinsic min-width from the dd/mm/yyyy
                placeholder so blank inputs sit nicely side-by-side. */}
            <div className="grid grid-cols-2 gap-4">
              <label className="min-w-0 overflow-hidden">
                <span className={labelCls}>From</span>
                <input
                  type="date"
                  value={expFrom}
                  onChange={e => setExpFrom(e.target.value)}
                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                  className="block rounded-xl border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                />
              </label>
              <label className="min-w-0 overflow-hidden">
                <span className={labelCls}>To</span>
                <input
                  type="date"
                  value={expTo}
                  onChange={e => setExpTo(e.target.value)}
                  style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                  className="block rounded-xl border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                />
              </label>
            </div>
            {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { setShowExport(false); setErr('') }}
                style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
                className={`${btnSecondary} flex-1 h-11`}
              >
                Cancel
              </button>
              <button
                onClick={exportPdf}
                disabled={exporting}
                style={{ backgroundColor: '#D7E363', color: '#141414' }}
                className={`${btnPrimary} flex-1 h-11`}
              >
                {exporting ? 'Generating…' : 'PDF'}
              </button>
              <button
                onClick={exportXlsx}
                disabled={exporting}
                style={{ backgroundColor: '#D7E363', color: '#141414' }}
                className={`${btnPrimary} flex-1 h-11`}
              >
                {exporting ? 'Generating…' : 'Excel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editDialog}
      {manualDialog}
    </div>
  )
}
