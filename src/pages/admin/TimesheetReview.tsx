import { useEffect, useState } from 'react'
import { supabase, type Timesheet, type TimeEntry, type Profile } from '../../lib/supabase'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'

export default function TimesheetReview() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [selected, setSelected] = useState<Timesheet | null>(null)
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [filterEmp, setFilterEmp] = useState('')
  const [filterStatus, setFilterStatus] = useState('submitted')
  const [adminNote, setAdminNote] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    let q = supabase.from('timesheets').select('*, profiles(full_name, email)').order('week_start', { ascending: false })
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterEmp)   q = q.eq('employee_id', filterEmp)
    const { data } = await q
    setTimesheets((data as Timesheet[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').order('full_name')
      .then(({ data }) => setEmployees((data as Profile[]) ?? []))
  }, [])

  useEffect(() => { load() }, [filterStatus, filterEmp])

  const openTimesheet = async (ts: Timesheet) => {
    setSelected(ts)
    setAdminNote(ts.admin_notes ?? '')
    const { data } = await supabase.from('time_entries')
      .select('*, job_addresses(address), stages(name)')
      .eq('employee_id', ts.employee_id)
      .eq('week_start', ts.week_start)
      .order('clock_in')
    setEntries((data as TimeEntry[]) ?? [])
  }

  const updateStatus = async (status: 'approved' | 'rejected') => {
    if (!selected) return
    const updates: Partial<Timesheet> = { status, admin_notes: adminNote || null }
    await supabase.from('timesheets').update(updates).eq('id', selected.id)

    // Auto-accrual on approval
    if (status === 'approved' && (selected.overtime_hours ?? 0) > 0) {
      const { data: profile } = await supabase.from('profiles').select('accrued_tol_hours').eq('id', selected.employee_id).single()
      await supabase.from('tol_ledger').insert({
        employee_id:  selected.employee_id,
        date:         new Date().toISOString().split('T')[0],
        hours_delta:  selected.overtime_hours,
        source:       'auto_overtime',
        timesheet_id: selected.id,
        note:         `Auto-accrued from approved timesheet ${selected.week_start}`,
      })
      await supabase.from('profiles').update({
        accrued_tol_hours: (profile?.accrued_tol_hours ?? 0) + (selected.overtime_hours ?? 0),
      }).eq('id', selected.employee_id)
    }

    setSelected(null)
    load()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Timesheet Review</h1>

      {selected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(null)} className={btnSecondary}>← Back</button>
            <div>
              <p className="font-semibold">{(selected.profiles as Profile)?.full_name}</p>
              <p className="text-sm text-gray-500">{fmtWeekRange(selected.week_start)}</p>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {entries.map(e => (
              <div key={e.id} className="px-5 py-4 flex justify-between">
                <div>
                  <p className="text-sm font-medium">{fmtDate(e.clock_in)}</p>
                  <p className="text-xs text-gray-500">{fmtTime(e.clock_in)} → {e.clock_out ? fmtTime(e.clock_out) : '⏳'}</p>
                  <p className="text-xs text-gray-400">{(e.job_addresses as { address: string })?.address}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{e.total_hours ? fmtHours(e.total_hours) : '—'}</p>
                  {e.is_overtime && <span className="text-xs text-orange-600">OT</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Regular</span><span className="font-semibold">{fmtHours(selected.regular_hours ?? 0)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Overtime</span><span className="font-semibold text-orange-600">{fmtHours(selected.overtime_hours ?? 0)}</span></div>
            <div className="flex justify-between font-bold border-t pt-3"><span>Total</span><span>{fmtHours(selected.total_hours ?? 0)}</span></div>
          </div>

          <div>
            <label className={labelCls}>Admin Note (optional)</label>
            <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} className={`${inputCls} resize-none`} rows={2} placeholder="Feedback for employee…" />
          </div>

          {selected.status === 'submitted' && (
            <div className="flex gap-3">
              <button onClick={() => updateStatus('approved')} className={`${btnPrimary} flex-1 h-12`}>✓ Approve</button>
              <button onClick={() => updateStatus('rejected')} className={`${btnDanger} flex-1 h-12`}>✗ Reject</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-3 flex-wrap">
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All statuses</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="draft">Draft</option>
            </select>
            <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All employees</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
          </div>

          {loading && <p className="text-center text-gray-400">Loading…</p>}

          <div className="space-y-3">
            {timesheets.map(ts => (
              <button key={ts.id} onClick={() => openTimesheet(ts)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex justify-between items-center hover:border-[#1c9fda]/40 transition-colors">
                <div>
                  <p className="text-sm font-semibold">{(ts.profiles as Profile)?.full_name}</p>
                  <p className="text-xs text-gray-500">{fmtWeekRange(ts.week_start)}</p>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold capitalize mt-1 ${
                    ts.status === 'submitted' ? 'bg-amber-100 text-amber-700'
                    : ts.status === 'approved' ? 'bg-green-100 text-green-700'
                    : ts.status === 'rejected' ? 'bg-red-100 text-red-600'
                    : 'bg-gray-100 text-gray-600'
                  }`}>{ts.status}</span>
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
