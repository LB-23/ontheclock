import { useEffect, useState } from 'react'
import { supabase, type Timesheet, type TimeEntry, type Profile } from '../../lib/supabase'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'
import { format } from 'date-fns'

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

  const load = async () => {
    let q = supabase.from('timesheets').select('*, profiles(full_name)').order('week_start', { ascending: false })
    if (filterStatus) q = q.eq('status', filterStatus)
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
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(null)} className={btnSecondary}>← Back</button>
            <div>
              <p className="font-semibold">{(selected.profiles as Profile)?.full_name}</p>
              <p className="text-sm text-muted">{fmtWeekRange(selected.week_start)} · <span className="capitalize">{selected.status}</span></p>
            </div>
          </div>

          <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
            {entries.length === 0 && <p className="p-6 text-center text-muted">No entries</p>}
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
                                className={`text-[11px] mt-1 ${isRed ? 'italic' : ''}`}
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
                      {e.is_overtime && <span className="text-xs text-orange-600">OT</span>}
                      {hasEdits && (
                        <button
                          onClick={() => setOpenEdits(o => ({ ...o, [e.id]: !o[e.id] }))}
                          className="block mt-1 text-xs text-blue-600 hover:underline"
                        >
                          ✎ {entryEdits.length} edit{entryEdits.length > 1 ? 's' : ''}
                        </button>
                      )}
                    </div>
                  </div>
                  {hasEdits && openEdits[e.id] && (
                    <div className="mt-3 space-y-2 border-t border-page pt-3">
                      {entryEdits.map(ed => (
                        <div key={ed.id} className="rounded-lg bg-blue-50 p-2 text-[11px] text-blue-900">
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
            <div className="flex justify-between text-sm"><span className="text-muted">Overtime</span><span className="font-semibold text-orange-600">{fmtHours(selected.overtime_hours ?? 0)}</span></div>
            <div className="flex justify-between font-bold border-t pt-3"><span>Total</span><span>{fmtHours(selected.total_hours ?? 0)}</span></div>
          </div>

          <div>
            <label className={labelCls}>Admin Note (optional)</label>
            <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="Feedback for employee…" />
          </div>

          {(selected.status === 'submitted') && (
            <div className="flex gap-3">
              <button onClick={() => updateStatus('approved')} className={`${btnPrimary} flex-1 h-12`}>✓ Approve</button>
              <button onClick={() => updateStatus('rejected')} className={`${btnDanger} flex-1 h-12`}>✗ Reject</button>
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
            className={`${btnDanger} w-full h-11 mt-2`}
          >
            Delete this timesheet
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-3 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All statuses</option>
              <option value="draft">Drafts</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {loading && <p className="text-center text-muted">Loading…</p>}
          {!loading && timesheets.length === 0 && (
            <p className="text-center text-muted py-10">No timesheets match this filter.</p>
          )}

          <div className="space-y-3">
            {timesheets.map(ts => (
              <button key={ts.id} onClick={() => openTimesheet(ts)}
                className="w-full text-left bg-surface rounded-2xl border border-page shadow-sm px-5 py-4 flex justify-between items-center hover:border-sky/40 transition-colors">
                <div>
                  <p className="text-sm font-semibold">{(ts.profiles as Profile)?.full_name}</p>
                  <p className="text-xs text-muted">{fmtWeekRange(ts.week_start)}</p>
                  <span
                    className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize mt-1"
                    style={
                      ts.status === 'submitted' ? { backgroundColor: 'rgba(249,151,2,0.20)', color: '#F99702' }
                      : ts.status === 'approved' ? { backgroundColor: 'rgba(174,224,1,0.20)', color: '#AEE001' }
                      : ts.status === 'rejected' ? { backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' }
                      : { backgroundColor: '#D9D9D9', color: '#666666' }
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
