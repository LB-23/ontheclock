import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase, type TimeEntry, type Timesheet } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, btnPrimary, btnSecondary, inputCls, labelCls } from '../../lib/utils'

type EditDraft = {
  entry: TimeEntry
  newClockIn:  string  // datetime-local format: YYYY-MM-DDTHH:mm
  newClockOut: string
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
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')

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
      reason:      '',
    })
    setErr('')
  }

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editing || !profile) return
    if (!editing.reason.trim()) {
      setErr('Reason is required for any time edit.')
      return
    }
    setSaving(true)
    setErr('')

    const oldIn  = editing.entry.clock_in
    const oldOut = editing.entry.clock_out
    const newIn  = localInputToIso(editing.newClockIn)
    const newOut = editing.newClockOut ? localInputToIso(editing.newClockOut) : null

    const inChanged  = newIn !== oldIn
    const outChanged = newOut !== (oldOut ?? null)

    if (!inChanged && !outChanged) {
      setErr('Nothing changed — close the dialog or adjust a time first.')
      setSaving(false)
      return
    }

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

    // 2. Update the entry itself
    const updates: Partial<TimeEntry> = {
      clock_in:    newIn,
      clock_out:   newOut,
      total_hours: totalH,
      status:      'edited',
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
    return { backgroundColor: '#E8E8E8', color: '#666666' }   // draft (default)
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
            required
          />
          <p className="text-[11px] text-muted mt-1">Required for every edit — your admin will see this.</p>
        </div>

        {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={saving} className={`${btnPrimary} flex-1 h-11`}>
            {saving ? 'Saving…' : 'Save Edit'}
          </button>
          <button type="button" onClick={() => { setEditing(null); setErr('') }} className={`${btnSecondary} flex-1 h-11`}>
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

          <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
            {entries.length === 0 && (
              <p className="p-6 text-center text-muted">No entries this week</p>
            )}
            {entries.map(e => (
              <div key={e.id} className="px-5 py-4 flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink">{fmtDate(e.clock_in)}</p>
                  <p className="text-xs text-muted mt-0.5">
                    {fmtTime(e.clock_in)} → {e.clock_out ? fmtTime(e.clock_out) : '⏳ Active'}
                  </p>
                  {(e.job_addresses as { address: string })?.address && (
                    <p className="text-xs text-muted mt-0.5 truncate">📍 {(e.job_addresses as { address: string }).address}</p>
                  )}
                  {e.notes && (
                    <p className="text-[11px] text-ink mt-1">{e.notes}</p>
                  )}
                  {e.status === 'edited' && (
                    <span className="inline-flex items-center text-[10px] uppercase font-semibold text-blue-600 mt-1">edited</span>
                  )}
                </div>
                <div className="text-right ml-3 flex-shrink-0">
                  <p className="text-sm font-bold text-ink">{e.total_hours ? fmtHours(e.total_hours) : '—'}</p>
                  {e.is_overtime && <span className="text-xs text-orange-600 font-medium">OT</span>}
                  {selected.status === 'draft' && (
                    <button onClick={() => openEdit(e)} className="block mt-1 text-xs text-sky hover:underline">
                      ✎ Edit
                    </button>
                  )}
                </div>
              </div>
            ))}
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
                  <p className="text-sm font-bold text-ink">{fmtHours(ts.total_hours ?? 0)}</p>
                  <p className="text-xs text-muted">→</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {editDialog}
    </div>
  )
}
