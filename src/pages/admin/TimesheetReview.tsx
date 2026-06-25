import { useEffect, useState } from 'react'
import { supabase, type Timesheet, type TimeEntry, type Profile } from '../../lib/supabase'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'
import { format } from 'date-fns'
import Skeleton from '../../components/Skeleton'
import { useEscapeKey } from '../../hooks/useEscapeKey'

type EntryEdit = {
  id: string
  edited_at: string
  field_changed: 'clock_in' | 'clock_out' | 'both'
  old_clock_in: string | null
  new_clock_in: string | null
  old_clock_out: string | null
  new_clock_out: string | null
  reason: string
  edited_by: string
}

export default function TimesheetReview() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [selected, setSelected] = useState<Timesheet | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [edits, setEdits] = useState<Record<string, EntryEdit[]>>({})
  const [openEdits, setOpenEdits] = useState<Record<string, boolean>>({})
  const [filterEmp, setFilterEmp] = useState('')
  const [filterStatus, setFilterStatus] = useState('submitted')
  const [adminNote, setAdminNote] = useState('')
  const [loading, setLoading] = useState(true)

  // Admin entry-edit state — populated when the admin clicks "Edit" on a
  // single time-entry row inside a submitted timesheet. Saving inserts an
  // audit row into time_entry_edits and updates the time_entries row;
  // recalculate_timesheet trigger picks it up.
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null)
  const [editForm, setEditForm] = useState({ newClockIn: '', newClockOut: '', reason: '' })
  const [editBusy, setEditBusy] = useState(false)
  const [editErr,  setEditErr]  = useState('')
  useEscapeKey(!!editingEntry, () => { setEditingEntry(null); setEditErr('') })

  const openEntryEdit = (e: TimeEntry) => {
    setEditingEntry(e)
    setEditForm({
      newClockIn:  e.clock_in  ? format(new Date(e.clock_in),  "yyyy-MM-dd'T'HH:mm") : '',
      newClockOut: e.clock_out ? format(new Date(e.clock_out), "yyyy-MM-dd'T'HH:mm") : '',
      reason: '',
    })
    setEditErr('')
  }

  const saveEntryEdit = async () => {
    if (!editingEntry) return
    if (!editForm.reason.trim()) { setEditErr('Reason is required for an admin edit.'); return }
    setEditBusy(true); setEditErr('')
    const newIn  = editForm.newClockIn  ? new Date(editForm.newClockIn).toISOString()  : null
    const newOut = editForm.newClockOut ? new Date(editForm.newClockOut).toISOString() : null
    const oldIn  = editingEntry.clock_in
    const oldOut = editingEntry.clock_out
    const inChanged  = newIn  !== oldIn
    const outChanged = newOut !== oldOut
    if (!inChanged && !outChanged) { setEditErr('No change to save.'); setEditBusy(false); return }

    const field_changed: 'clock_in' | 'clock_out' | 'both' =
      inChanged && outChanged ? 'both' : inChanged ? 'clock_in' : 'clock_out'

    // Audit row first so the trail is preserved even if the update fails
    const { data: userRes } = await supabase.auth.getUser()
    await supabase.from('time_entry_edits').insert({
      time_entry_id: editingEntry.id,
      field_changed,
      old_clock_in:  inChanged  ? oldIn  : null,
      new_clock_in:  inChanged  ? newIn  : null,
      old_clock_out: outChanged ? oldOut : null,
      new_clock_out: outChanged ? newOut : null,
      reason: editForm.reason.trim(),
      edited_by: userRes.user?.id ?? null,
    })

    const { error } = await supabase.from('time_entries').update({
      clock_in:  newIn,
      clock_out: newOut,
    }).eq('id', editingEntry.id)

    setEditBusy(false)
    if (error) { setEditErr(error.message); return }
    setEditingEntry(null)
    if (selected) openTimesheet(selected)  // refresh entries + edits map
  }

  const load = async () => {
    // Compute today's Friday LBG-week-start in local time so we hide any
    // future-week timesheet auto-created by the leave/holiday pre-population
    // job — admin only wants to see weeks that have already begun or earlier.
    const today = new Date()
    const dow = today.getDay() // 0=Sun ... 5=Fri ... 6=Sat
    const offsetToFri = (dow - 5 + 7) % 7
    const thisFri = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offsetToFri)
    const thisWeekStart = format(thisFri, 'yyyy-MM-dd')

    let q = supabase.from('timesheets').select('*, profiles!timesheets_employee_id_fkey(full_name)')
      .lte('week_start', thisWeekStart)  // hide future weeks
      .order('week_start', { ascending: false })
    if (filterStatus) {
      q = q.eq('status', filterStatus)
    } else {
      // "All Statuses" still excludes drafts — admin only cares about
      // timesheets the employee has actually submitted / actioned.
      q = q.in('status', ['submitted', 'approved', 'rejected'])
    }
    if (filterEmp)   q = q.eq('employee_id', filterEmp)
    const { data } = await q
    setTimesheets((data as Timesheet[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    // Only show employees (admins don't have timesheets / shouldn't clutter the filter)
    supabase.from('profiles').select('id, full_name').eq('app_role', 'employee').order('full_name')
      .then(({ data }) => setEmployees((data as Profile[]) ?? []))
  }, [])

  useEffect(() => { load() }, [filterStatus, filterEmp])

  const openTimesheet = async (ts: Timesheet) => {
    setSelected(ts)
    setAdminNote(ts.admin_notes ?? '')
    const { data: entriesData } = await supabase.from('time_entries')
      .select('*, job_addresses(address), stages(name)')
      .eq('employee_id', ts.employee_id)
      .eq('week_start', ts.week_start)
      .order('clock_in')
    const ents = (entriesData as TimeEntry[]) ?? []
    setEntries(ents)

    // Fetch edit history for these entries (if any)
    if (ents.length) {
      const ids = ents.map(e => e.id)
      const { data: editsData } = await supabase.from('time_entry_edits')
        .select('*').in('time_entry_id', ids).order('edited_at', { ascending: false })
      const grouped: Record<string, EntryEdit[]> = {}
      ;(editsData ?? []).forEach((row: Record<string, unknown>) => {
        const k = row.time_entry_id as string
        if (!grouped[k]) grouped[k] = []
        grouped[k].push(row as unknown as EntryEdit)
      })
      setEdits(grouped)
    } else {
      setEdits({})
    }
    setOpenEdits({})
  }

  const updateStatus = async (status: 'approved' | 'rejected') => {
    if (!selected) return
    await supabase.from('timesheets').update({
      status, admin_notes: adminNote || null,
    }).eq('id', selected.id)

    // Move associated entries to matching status
    if (status === 'approved') {
      await supabase.from('time_entries').update({ status: 'approved' })
        .eq('employee_id', selected.employee_id).eq('week_start', selected.week_start)
        .in('status', ['submitted', 'edited', 'completed'])
    }

    // TIL auto-accrual on approval
    if (status === 'approved' && (selected.overtime_hours ?? 0) > 0) {
      const { data: profile } = await supabase.from('profiles').select('accrued_til_hours').eq('id', selected.employee_id).single()
      await supabase.from('til_ledger').insert({
        employee_id:  selected.employee_id,
        date:         new Date().toISOString().split('T')[0],
        hours_delta:  selected.overtime_hours,
        source:       'auto_overtime',
        timesheet_id: selected.id,
        note:         `Auto-accrued from approved timesheet ${selected.week_start}`,
      })
      await supabase.from('profiles').update({
        accrued_til_hours: (profile?.accrued_til_hours ?? 0) + (selected.overtime_hours ?? 0),
      }).eq('id', selected.employee_id)
    }

    setSelected(null)
    load()
  }

  const fmtEditTime = (iso: string | null) => iso ? format(new Date(iso), 'd MMM HH:mm') : '—'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Timesheet Review</h1>

      {selected ? (
        <div className="space-y-4">
          <div className="space-y-3">
            <button onClick={() => setSelected(null)} className={btnSecondary}>← Back</button>
            <div>
              <p className="font-semibold">{(selected.profiles as Profile)?.full_name}</p>
              <p className="text-sm text-muted">{fmtWeekRange(selected.week_start)} · <span className="capitalize">{selected.status}</span></p>
            </div>
          </div>

          <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
            {entries.length === 0 && <p className="p-6 text-center text-muted">No Entries</p>}
            {entries.map(e => {
              const entryEdits = edits[e.id] ?? []
              const hasEdits = entryEdits.length > 0
              const isSystem = e.entry_type && e.entry_type !== 'regular'
              return (
                <div key={e.id} className="px-5 py-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{fmtDate(e.clock_in)}</p>
                      {isSystem ? (
                        <p className="text-[12px] italic mt-0.5" style={{ color: '#15739D' }}>{e.notes}</p>
                      ) : (
                        <>
                          <p className="text-xs text-muted">{fmtTime(e.clock_in)} → {e.clock_out ? fmtTime(e.clock_out) : 'Active'}</p>
                          <p className="text-xs text-muted truncate">{(e.job_addresses as { address: string })?.address}</p>
                          {e.notes && (() => {
                            const isRed = e.notes.includes('Auto-closed') || e.notes.includes('Added manually')
                            return (
                              <p
                                className={`text-tag mt-1 ${isRed ? 'italic' : ''}`}
                                style={{ color: isRed ? '#FF2828' : '#000000' }}
                              >
                                {e.notes}
                              </p>
                            )
                          })()}
                        </>
                      )}
                    </div>
                    <div className="text-right ml-3">
                      <p className="text-sm font-bold">{e.total_hours ? fmtHours(e.total_hours) : '—'}</p>
                      {hasEdits && (
                        <button
                          onClick={() => setOpenEdits(o => ({ ...o, [e.id]: !o[e.id] }))}
                          className="block mt-1 text-xs text-blue-600 hover:underline"
                        >
                          ✎ {entryEdits.length} edit{entryEdits.length > 1 ? 's' : ''}
                        </button>
                      )}
                      {/* Admin can edit clock_in/out on a submitted timesheet
                          BEFORE approval. System entries (leave shadows,
                          public holidays) are sourced from leave_requests, so
                          editing them here would desync — disable. */}
                      {selected.status === 'submitted' && !isSystem && (
                        <button
                          onClick={() => openEntryEdit(e)}
                          className="block mt-1 text-xs text-sky hover:underline"
                        >
                          ✎ Edit
                        </button>
                      )}
                    </div>
                  </div>
                  {hasEdits && openEdits[e.id] && (
                    <div className="mt-3 space-y-2 border-t border-page pt-3">
                      {entryEdits.map(ed => (
                        <div key={ed.id} className="rounded-lg bg-blue-50 p-2 text-tag text-blue-900">
                          <p className="font-semibold">{fmtEditTime(ed.edited_at)}</p>
                          {ed.field_changed !== 'clock_out' && ed.new_clock_in && (
                            <p>Clock-in: {fmtEditTime(ed.old_clock_in)} → {fmtEditTime(ed.new_clock_in)}</p>
                          )}
                          {ed.field_changed !== 'clock_in' && ed.new_clock_out && (
                            <p>Clock-out: {fmtEditTime(ed.old_clock_out)} → {fmtEditTime(ed.new_clock_out)}</p>
                          )}
                          <p className="italic mt-1">"{ed.reason}"</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted">Regular</span><span className="font-semibold">{fmtHours(selected.regular_hours ?? 0)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Additional Hours</span><span className="font-semibold" style={{ color: '#1C9FDA' }}>{fmtHours(selected.overtime_hours ?? 0)}</span></div>
            <div className="flex justify-between font-bold border-t pt-3"><span>Total</span><span className="tabular-nums">{fmtHours(selected.total_hours ?? 0)}</span></div>
          </div>

          <div>
            <label className={labelCls}>Admin Note (optional)</label>
            <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="Feedback for employee…" />
          </div>

          {(selected.status === 'submitted') && (
            <div className="flex gap-3">
              {/* Gallery action style: underlined #0352fb link buttons on grey */}
              <button
                onClick={() => updateStatus('approved')}
                style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
                className={`${btnPrimary} flex-1 h-12`}
              >
                Approve
              </button>
              <button
                onClick={() => updateStatus('rejected')}
                style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
                className={`${btnDanger} flex-1 h-12`}
              >
                Reject
              </button>
            </div>
          )}
          {selected.status === 'draft' && (
            <p className="text-xs text-center text-muted">Draft — employee hasn't submitted yet</p>
          )}
          {selected.status === 'approved' && (
            <p className="text-xs text-center text-green-600">✓ Approved</p>
          )}

          {/* Admin can permanently delete a timesheet at any status */}
          <button
            onClick={async () => {
              if (!confirm(`Permanently delete this timesheet for ${(selected.profiles as Profile)?.full_name}?\n\nThis also deletes every time entry inside the week (${fmtWeekRange(selected.week_start)}) and any audit/edit history. This cannot be undone.`)) return
              const { error } = await supabase.rpc('admin_delete_timesheet', { timesheet_id: selected.id })
              if (error) { alert('Delete failed: ' + error.message); return }
              setSelected(null)
              load()
            }}
            style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
            className={`${btnPrimary} w-full h-11 mt-2`}
          >
            Delete this timesheet
          </button>

          {/* Admin entry-edit modal — opens when admin clicks ✎ Edit on a
              time-entry row inside a submitted (not yet approved) timesheet. */}
          {editingEntry && (
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6"
                 onClick={() => setEditingEntry(null)}>
              <div className="bg-surface w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-lg"
                   onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-lg">Edit Time Entry</h2>
                  <button type="button" onClick={() => setEditingEntry(null)} className="text-muted hover:text-ink">✕</button>
                </div>
                <p className="text-xs text-muted">
                  Edits are audit-logged with the admin's name + reason. The timesheet totals recalculate automatically.
                </p>

                <div>
                  <label className={labelCls}>Clock-in</label>
                  <input type="datetime-local" value={editForm.newClockIn}
                         onChange={e => setEditForm(f => ({ ...f, newClockIn: e.target.value }))}
                         className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Clock-out</label>
                  <input type="datetime-local" value={editForm.newClockOut}
                         onChange={e => setEditForm(f => ({ ...f, newClockOut: e.target.value }))}
                         className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Reason <span className="text-red-500">*</span></label>
                  <textarea value={editForm.reason}
                            onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                            className={`${inputCls} resize-none`} rows={2}
                            placeholder="e.g. employee forgot to clock out, fixed retroactively" />
                </div>

                {editErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2">{editErr}</p>}

                <div className="flex gap-3 pt-2">
                  <button onClick={saveEntryEdit} disabled={editBusy} className={`${btnPrimary} flex-1 h-11`}>
                    {editBusy ? 'Saving…' : 'Save Edit'}
                  </button>
                  <button onClick={() => setEditingEntry(null)} className={`${btnSecondary} flex-1 h-11`}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-3 flex-wrap">
            {/* Drafts dropped per spec — admin only ever needs to triage
                timesheets that the employee has already submitted. */}
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All Statuses</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All Employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {loading && <Skeleton count={4} />}
          {!loading && timesheets.length === 0 && (
            <div className="text-center py-10" style={{ color: '#D9D9D9' }}>
              <p>No Timesheets Match This Filter.</p>
              <p className="text-xs mt-1">Try a wider date range or a different status.</p>
            </div>
          )}

          <div className="space-y-3">
            {timesheets.map(ts => (
              <button key={ts.id} onClick={() => openTimesheet(ts)}
                /* normal-case prevents the global `button { uppercase }`
                   from shouting names + week ranges on the list. */
                className="w-full text-left bg-surface border border-page px-5 py-4 flex justify-between items-center hover:border-sky/40 transition-colors normal-case">
                <div>
                  <p className="text-sm font-semibold">{(ts.profiles as Profile)?.full_name}</p>
                  <p className="text-xs text-muted">{fmtWeekRange(ts.week_start)}</p>
                  <span
                    className="inline-flex items-center rounded-none px-2 py-0.5 text-[9px] font-semibold font-forma uppercase tracking-[0.04em] mt-1"
                    style={
                      ts.status === 'submitted' ? { backgroundColor: '#fbe3bd', color: '#f99702' }
                      : ts.status === 'approved' ? { backgroundColor: '#dff8be', color: '#8bc93d' }
                      : ts.status === 'rejected' ? { backgroundColor: '#FDBEB5', color: '#9C0F0F' }
                      : { backgroundColor: '#CDCBCB', color: '#3E3E3E' }
                    }
                  >{ts.status}</span>
                </div>
                <p className="text-sm font-bold">{fmtHours(ts.total_hours ?? 0)}</p>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
