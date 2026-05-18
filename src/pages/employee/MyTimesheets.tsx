import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase, type TimeEntry, type Timesheet, type JobAddress } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'

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

  /** Export every timesheet in [expFrom..expTo] as a multi-page PDF, one week per page. */
  const exportPdf = async () => {
    if (!profile || !expFrom || !expTo) { setErr('Pick a date range first.'); return }
    setExporting(true); setErr('')

    // 1. Find every timesheet whose week_start falls in [expFrom..expTo]
    const { data: tsRows } = await supabase
      .from('timesheets')
      .select('*')
      .eq('employee_id', profile.id)
      .gte('week_start', expFrom)
      .lte('week_start', expTo)
      .order('week_start')

    const sheets = (tsRows as Timesheet[]) ?? []
    if (sheets.length === 0) {
      setErr('No timesheets found in that range.')
      setExporting(false)
      return
    }

    // 2. Pull every entry across those weeks in one query
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

    // 3. Build the PDF — one timesheet per page
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })

    sheets.forEach((ts, idx) => {
      if (idx > 0) pdf.addPage()

      pdf.setFontSize(16)
      pdf.setFont('helvetica', 'bold')
      pdf.text(profile.full_name || 'Employee', 40, 50)
      pdf.setFontSize(11)
      pdf.setFont('helvetica', 'normal')
      pdf.text(`Timesheet · ${fmtWeekRange(ts.week_start)}`, 40, 70)
      pdf.text(`Status: ${ts.status}`, 40, 86)

      const rows = (byWeek[ts.week_start] ?? []).map(e => [
        format(new Date(e.clock_in), 'EEE dd MMM'),
        (e.job_addresses as { address: string })?.address ?? '—',
        (e.stages as { name: string })?.name ?? '—',
        format(new Date(e.clock_in), 'HH:mm'),
        e.clock_out ? format(new Date(e.clock_out), 'HH:mm') : '—',
        e.total_hours ? fmtHours(Number(e.total_hours)) : '—',
        e.notes ?? '',
      ])

      autoTable(pdf, {
        startY: 105,
        head: [['Date', 'Site', 'Stage', 'In', 'Out', 'Hours', 'Notes']],
        body: rows.length > 0 ? rows : [['No entries this week', '', '', '', '', '', '']],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [28, 159, 218], textColor: 250 },
        columnStyles: { 6: { cellWidth: 120 } },
      })

      // Footer totals
      const finalY = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
      pdf.setFont('helvetica', 'bold')
      pdf.text(`Regular: ${fmtHours(Number(ts.regular_hours ?? 0))}`,  40, finalY)
      pdf.text(`Overtime: ${fmtHours(Number(ts.overtime_hours ?? 0))}`, 180, finalY)
      pdf.text(`Total: ${fmtHours(Number(ts.total_hours ?? 0))}`,       340, finalY)
      if (ts.admin_notes) {
        pdf.setFont('helvetica', 'italic')
        pdf.setFontSize(9)
        pdf.text(`Admin note: ${ts.admin_notes}`, 40, finalY + 18, { maxWidth: 510 })
      }
    })

    pdf.save(`${profile.full_name.replace(/\s+/g, '_')}_timesheets_${expFrom}_to_${expTo}.pdf`)
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
    if (s === 'submitted' || s === 'pending') return { backgroundColor: 'rgba(249,151,2,0.20)', color: '#F99702' }
    if (s === 'approved')                     return { backgroundColor: 'rgba(174,224,1,0.20)', color: '#AEE001' }
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
          <label className={labelCls}>Clock In</label>
          <input
            type="datetime-local"
            value={editing.newClockIn}
            onChange={e => setEditing(d => d ? { ...d, newClockIn: e.target.value } : d)}
            className={inputCls}
            required
          />
        </div>
        <div>
          <label className={labelCls}>Clock Out</label>
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
          <button type="submit" disabled={saving || deleting} className={`${btnPrimary} flex-1 h-11`}>
            {saving ? 'Saving…' : 'Save Edit'}
          </button>
          <button type="button" onClick={() => { setEditing(null); setErr('') }} className={`${btnSecondary} flex-1 h-11`}>
            Cancel
          </button>
        </div>
        <button type="button" onClick={deleteEntry} disabled={saving || deleting} className={`${btnDanger} w-full h-11 mt-2`}>
          {deleting ? 'Deleting…' : 'Delete this entry'}
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
          <button type="submit" disabled={manualSaving} className={`${btnPrimary} flex-1 h-11`}>
            {manualSaving ? 'Adding…' : 'Add Entry'}
          </button>
          <button type="button" onClick={() => { setShowManualForm(false); setErr('') }} className={`${btnSecondary} flex-1 h-11`}>
            Cancel
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
            <button onClick={() => setSelected(null)} className={btnSecondary}>← Back</button>
            <div>
              <p className="font-semibold">{fmtWeekRange(selected.week_start)}</p>
              <span className={badgeCls} style={statusStyle(selected.status)}>{selected.status}</span>
            </div>
          </div>

          {selected.status === 'draft' && (
            <button
              onClick={() => { setShowManualForm(true); setErr('') }}
              className={`${btnPrimary} w-full h-11`}
            >
              + Add Manual Entry
            </button>
          )}

          <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
            {entries.length === 0 && (
              <p className="p-6 text-center text-muted">No entries this week</p>
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
                          <span className="inline-flex items-center text-[10px] uppercase font-semibold text-blue-600 mt-1">edited</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="text-right ml-3 flex-shrink-0">
                    <p className="text-sm font-bold text-ink">{e.total_hours ? fmtHours(e.total_hours) : '—'}</p>
                    {e.is_overtime && !isSystem && <span className="text-xs text-orange-600 font-medium">OT</span>}
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
              <span className="text-muted">Regular hours</span>
              <span className="font-semibold">{fmtHours(selected.regular_hours ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm mb-4">
              <span className="text-muted">Overtime hours</span>
              <span className="font-semibold text-orange-600">{fmtHours(selected.overtime_hours ?? 0)}</span>
            </div>
            <div className="flex justify-between font-bold border-t pt-3">
              <span>Total</span>
              <span>{fmtHours(selected.total_hours ?? 0)}</span>
            </div>
          </div>

          {selected.status === 'draft' && entries.length > 0 && (
            <button
              onClick={submitTimesheet}
              disabled={submitting || entries.some(e => !e.clock_out)}
              className={`${btnPrimary} w-full h-12`}
            >
              {submitting ? 'Submitting…' : entries.some(e => !e.clock_out) ? 'Clock out of all entries first' : 'Submit for Approval'}
            </button>
          )}
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
              const today = format(new Date(), 'yyyy-MM-dd')
              const monthAgo = format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd')
              setExpFrom(monthAgo); setExpTo(today); setShowExport(true); setErr('')
            }}
            className={`${btnSecondary} w-full h-11`}
          >
            ↓ Export Timesheets (PDF)
          </button>

          {timesheets.length === 0 && (
            <div className="text-center py-16 text-muted">No timesheets yet — clock in once to start one.</div>
          )}
          <div className="space-y-3">
            {timesheets.map(ts => (
              <button
                key={ts.id}
                onClick={() => loadEntries(ts)}
                className="w-full text-left bg-surface rounded-2xl border border-page shadow-sm px-5 py-4 flex justify-between items-center hover:border-sky/40 transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold">{fmtWeekRange(ts.week_start)}</p>
                  <span className={badgeCls} style={statusStyle(ts.status)}>{ts.status}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-sky">{fmtHours(ts.total_hours ?? 0)}</p>
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
            <p className="text-xs text-muted">One PDF, one page per timesheet within the selected date range.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>From</label>
                <input type="date" value={expFrom} onChange={e => setExpFrom(e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>To</label>
                <input type="date" value={expTo} onChange={e => setExpTo(e.target.value)} className={inputCls} /></div>
            </div>
            {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
            <div className="flex gap-3 pt-2">
              <button onClick={exportPdf} disabled={exporting} className={`${btnPrimary} flex-1 h-11`}>
                {exporting ? 'Generating…' : 'Generate PDF'}
              </button>
              <button onClick={() => { setShowExport(false); setErr('') }} className={`${btnSecondary} flex-1 h-11`}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editDialog}
      {manualDialog}
    </div>
  )
}
