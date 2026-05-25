import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type LeaveType, type Profile } from '../../lib/supabase'
import { fmtDate, fmtHours, btnPrimary, btnDanger, btnSecondary, inputCls, labelCls } from '../../lib/utils'
import { format, eachDayOfInterval, parseISO, startOfMonth, endOfMonth, getDay } from 'date-fns'
import { holidayFor } from '../../lib/holidays'

const leaveLabels: Record<string, string> = {
  annual: 'Annual', personal: 'Personal/Sick', time_in_lieu: 'TIL', unpaid: 'Unpaid',
}

/** Stable per-employee calendar colour drawn from the brand-approved palette. */
const EMP_COLOURS = ['#FFEACD', '#F0F9CC', '#CEF0F2', '#E7D0ED', '#F8CDE9'] as const
function empColour(uuid: string): string {
  // Simple deterministic hash of the UUID -> palette index
  let h = 0
  for (let i = 0; i < uuid.length; i++) h = (h * 31 + uuid.charCodeAt(i)) >>> 0
  return EMP_COLOURS[h % EMP_COLOURS.length]
}

export default function LeaveManagement() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [approved, setApproved] = useState<LeaveRequest[]>([])
  const [allRequests, setAllRequests] = useState<LeaveRequest[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [calMonth, setCalMonth] = useState(new Date())
  const [tab, setTab] = useState<'calendar' | 'pending' | 'approved' | 'all' | 'balances'>('calendar')
  const [adminNote, setAdminNote] = useState('')
  const [deciding, setDeciding] = useState<string | null>(null)

  // Edit / delete dialog state
  const [openReq, setOpenReq] = useState<LeaveRequest | null>(null)
  const [editForm, setEditForm] = useState({
    leave_type: 'annual' as LeaveType,
    start_date: '', start_time: '',
    end_date:   '', end_time:   '',
    total_hours: 0,
    reason: '',
    admin_notes: '',
  })
  const [editBusy, setEditBusy] = useState(false)
  const [editErr, setEditErr] = useState('')

  // Admin-creates-leave-on-behalf-of-employee dialog state
  const [showAddLeave, setShowAddLeave] = useState(false)
  const [addForm, setAddForm] = useState({
    employee_id: '',
    leave_type:  'annual' as LeaveType,
    start_date:  '',
    start_time:  '07:00',
    end_date:    '',
    end_time:    '15:00',
    reason:      '',
  })
  const [addBusy, setAddBusy] = useState(false)
  const [addErr,  setAddErr]  = useState('')

  const openAddLeave = () => {
    setAddForm({ employee_id: '', leave_type: 'annual', start_date: '', start_time: '07:00', end_date: '', end_time: '15:00', reason: '' })
    setAddErr('')
    setShowAddLeave(true)
  }

  const submitAddLeave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!addForm.employee_id) { setAddErr('Pick an employee.'); return }
    if (!addForm.start_date || !addForm.end_date) { setAddErr('Pick start and end dates.'); return }
    // Compute total_hours: full working days between start and end times.
    // Mirrors the employee-side calc: span_days × per_day_hours where per_day
    // is the difference between start_time and end_time on a single day.
    const dayMs = 86_400_000
    const startMs = new Date(`${addForm.start_date}T${addForm.start_time}:00`).getTime()
    const endMs   = new Date(`${addForm.end_date}T${addForm.end_time}:00`).getTime()
    if (endMs <= startMs) { setAddErr('End must be after start.'); return }
    const days = Math.max(1, Math.round((new Date(addForm.end_date).getTime() - new Date(addForm.start_date).getTime()) / dayMs) + 1)
    const [sh, sm] = addForm.start_time.split(':').map(Number)
    const [eh, em] = addForm.end_time.split(':').map(Number)
    const perDayMin = (eh * 60 + em) - (sh * 60 + sm)
    const totalHours = Math.max(0, (perDayMin / 60) * days)

    setAddBusy(true); setAddErr('')
    const { error } = await supabase.from('leave_requests').insert({
      employee_id: addForm.employee_id,
      leave_type:  addForm.leave_type,
      start_date:  addForm.start_date,
      start_time:  addForm.start_time + ':00',
      end_date:    addForm.end_date,
      end_time:    addForm.end_time   + ':00',
      total_hours: totalHours,
      reason:      addForm.reason || null,
      status:      'approved',  // admin-created leave is immediately approved
      admin_notes: 'Added by admin',
      decided_by:  (await supabase.auth.getUser()).data.user?.id ?? null,
    })
    setAddBusy(false)
    if (error) { setAddErr(error.message); return }

    // Decrement the matching balance just like the approval flow does, so the
    // admin-created leave actually deducts from the employee's bank.
    const fieldMap: Record<string, string> = {
      annual:       'annual_leave_balance',
      personal:     'personal_leave_balance',
      time_in_lieu: 'accrued_til_hours',
    }
    const col = fieldMap[addForm.leave_type]
    if (col) {
      const { data: prof } = await supabase.from('profiles').select(col).eq('id', addForm.employee_id).single()
      if (prof) {
        const current = (prof as unknown as Record<string, number>)[col] ?? 0
        await supabase.from('profiles').update({ [col]: Math.max(0, current - totalHours) }).eq('id', addForm.employee_id)
        if (addForm.leave_type === 'time_in_lieu') {
          await supabase.from('til_ledger').insert({
            employee_id: addForm.employee_id, date: new Date().toISOString().split('T')[0],
            hours_delta: -totalHours, source: 'leave_used',
            note: `Admin-created TIL leave ${addForm.start_date}–${addForm.end_date}`,
          })
        }
      }
    }

    setShowAddLeave(false)
    load()
  }

  const openEdit = (r: LeaveRequest) => {
    setOpenReq(r)
    setEditForm({
      leave_type: r.leave_type,
      start_date: r.start_date,
      start_time: r.start_time ? r.start_time.slice(0, 5) : '07:00',
      end_date:   r.end_date,
      end_time:   r.end_time   ? r.end_time.slice(0, 5)   : '15:36',
      total_hours: Number(r.total_hours ?? 0),
      reason: r.reason ?? '',
      admin_notes: r.admin_notes ?? '',
    })
    setEditErr('')
  }

  const saveEdit = async () => {
    if (!openReq) return
    setEditBusy(true); setEditErr('')
    const { error } = await supabase.from('leave_requests').update({
      leave_type:  editForm.leave_type,
      start_date:  editForm.start_date,
      start_time:  editForm.start_time + ':00',
      end_date:    editForm.end_date,
      end_time:    editForm.end_time   + ':00',
      total_hours: editForm.total_hours,
      reason:      editForm.reason || null,
      admin_notes: editForm.admin_notes || null,
    }).eq('id', openReq.id)
    setEditBusy(false)
    if (error) { setEditErr(error.message); return }
    setOpenReq(null)
    load()
  }

  const deleteRequest = async () => {
    if (!openReq) return
    const restoreNote = openReq.status === 'approved'
      ? `\n\n${fmtHours(openReq.total_hours ?? 0)} will be returned to the employee's ${openReq.leave_type} balance.`
      : ''
    if (!confirm(`Permanently delete this leave request for ${(openReq.profiles as Profile)?.full_name}?${restoreNote}`)) return
    setEditBusy(true)
    const { error } = await supabase.rpc('admin_delete_leave_request', { req_id: openReq.id })
    setEditBusy(false)
    if (error) { setEditErr(error.message); return }
    setOpenReq(null)
    load()
  }

  const load = async () => {
    const [{ data: pending }, { data: appr }, { data: all }, { data: emps }] = await Promise.all([
      supabase.from('leave_requests').select('*, profiles!leave_requests_employee_id_fkey(full_name)').eq('status', 'pending').order('start_date'),
      supabase.from('leave_requests').select('*, profiles!leave_requests_employee_id_fkey(full_name)').eq('status', 'approved').order('start_date'),
      supabase.from('leave_requests').select('*, profiles!leave_requests_employee_id_fkey(full_name)').order('created_at', { ascending: false }),
      supabase.from('profiles')
        .select('id, full_name, app_role, annual_leave_balance, personal_leave_balance, accrued_til_hours, weekly_hours_category')
        .eq('app_role', 'employee')
        .order('full_name'),
    ])
    setRequests((pending as LeaveRequest[]) ?? [])
    setApproved((appr as LeaveRequest[]) ?? [])
    setAllRequests((all as LeaveRequest[]) ?? [])
    setEmployees((emps as Profile[]) ?? [])
  }

  useEffect(() => { load() }, [])

  const decide = async (r: LeaveRequest, status: 'approved' | 'declined') => {
    setDeciding(r.id)
    await supabase.from('leave_requests').update({ status, admin_notes: adminNote || null }).eq('id', r.id)

    if (status === 'approved') {
      // Map leave_type → balance column
      const field: Record<string, string> = {
        annual:       'annual_leave_balance',
        personal:     'personal_leave_balance',
        time_in_lieu: 'accrued_til_hours',
      }
      const col = field[r.leave_type]
      if (col) {
        const { data: prof } = await supabase.from('profiles').select(col).eq('id', r.employee_id).single()
        if (prof) {
          const current = (prof as unknown as Record<string, number>)[col] ?? 0
          // Leave is now in HOURS — deduct directly
          const deduct = r.total_hours ?? 0
          await supabase.from('profiles').update({ [col]: Math.max(0, current - deduct) }).eq('id', r.employee_id)
          if (r.leave_type === 'time_in_lieu') {
            await supabase.from('til_ledger').insert({
              employee_id: r.employee_id, date: new Date().toISOString().split('T')[0],
              hours_delta: -deduct, source: 'leave_used',
              note: `TIL leave approved ${r.start_date}–${r.end_date}`,
            })
          }
        }
      }
    }
    setDeciding(null)
    setAdminNote('')
    load()
  }

  // Calendar helpers
  const monthStart = startOfMonth(calMonth)
  const monthEnd = endOfMonth(calMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startPad = getDay(monthStart) === 0 ? 6 : getDay(monthStart) - 1

  const leavesOnDay = (date: Date) =>
    approved.filter(lr => {
      const s = parseISO(lr.start_date), e = parseISO(lr.end_date)
      return date >= s && date <= e
    })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-ink">Leave Management</h1>
        <button
          onClick={openAddLeave}
          style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
          className={btnPrimary}
        >
          + Add Leave For Employee
        </button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['calendar', 'pending', 'approved', 'all', 'balances'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${tab === t ? 'bg-sky text-white' : 'bg-surface border border-page text-muted'}`}>
            {t === 'calendar'   ? 'Calendar'
             : t === 'pending'  ? `Pending (${requests.length})`
             : t === 'approved' ? `Approved (${approved.length})`
             : t === 'all'      ? `All (${allRequests.length})`
             : `Balances (${employees.length})`}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="space-y-4">
          {requests.length === 0 && <p className="text-center text-muted py-10">No Pending Requests</p>}
          {requests.map(r => (
            <div key={r.id} className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3 hover:border-sky/40 transition-colors">
              <button type="button" onClick={() => openEdit(r)} className="w-full text-left normal-case">
                <div className="flex justify-between">
                  <div>
                    <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                    <p className="text-sm text-muted">
                      {leaveLabels[r.leave_type]} · {fmtDate(r.start_date)}{r.start_time ? ` ${r.start_time.slice(0, 5)}` : ''} – {fmtDate(r.end_date)}{r.end_time ? ` ${r.end_time.slice(0, 5)}` : ''} ({fmtHours(r.total_hours ?? 0)})
                    </p>
                    {r.reason && <p className="text-xs text-muted italic mt-0.5">"{r.reason}"</p>}
                  </div>
                  <span className="text-xs text-muted">Edit ▸</span>
                </div>
              </button>
              <div>
                <label className={labelCls}>Note (optional)</label>
                <input value={adminNote} onChange={e => setAdminNote(e.target.value)} className={inputCls} placeholder="Reason for decision…" />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => decide(r, 'approved')}
                  disabled={deciding === r.id}
                  style={{ backgroundColor: '#D7E363', color: '#141414' }}
                  className={`${btnPrimary} flex-1 h-11`}
                >
                  Approve
                </button>
                <button
                  onClick={() => decide(r, 'declined')}
                  disabled={deciding === r.id}
                  style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
                  className={`${btnDanger} flex-1 h-11`}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'approved' && (
        <div className="space-y-3">
          {approved.length === 0 && <p className="text-center text-muted py-10">No Approved Leave</p>}
          {approved.map(r => (
            <button key={r.id} onClick={() => openEdit(r)}
                    className="w-full text-left bg-surface border border-page px-5 py-4 hover:border-sky/40 transition-colors normal-case">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                  <p className="text-sm text-muted mt-0.5">
                    {leaveLabels[r.leave_type]} · {fmtDate(r.start_date)}{r.start_time ? ` ${r.start_time.slice(0, 5)}` : ''} – {fmtDate(r.end_date)}{r.end_time ? ` ${r.end_time.slice(0, 5)}` : ''}
                  </p>
                  {r.admin_notes && <p className="text-xs text-blue-600 mt-1">💬 {r.admin_notes}</p>}
                </div>
                <p className="text-sm font-bold font-clock text-ink normal-case">{fmtHours(r.total_hours ?? 0)}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {tab === 'all' && (
        <div className="space-y-3">
          {allRequests.length === 0 && <p className="text-center text-muted py-10">No Leave Requests Yet</p>}
          {allRequests.map(r => {
            const status = r.status
            const style: React.CSSProperties =
              status === 'pending'   ? { backgroundColor: 'rgba(249,151,2,0.20)', color: '#F99702' }
              : status === 'approved'  ? { backgroundColor: 'rgba(174,224,1,0.20)', color: '#AEE001' }
              : status === 'withdrawn' ? { backgroundColor: 'rgba(102,102,102,0.15)', color: '#666666' }
              : { backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' }
            return (
              <button key={r.id} onClick={() => openEdit(r)}
                      className="w-full text-left bg-surface border border-page px-5 py-4 hover:border-sky/40 transition-colors normal-case">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                    <p className="text-sm text-muted mt-0.5">
                      {leaveLabels[r.leave_type]} · {fmtDate(r.start_date)}{r.start_time ? ` ${r.start_time.slice(0, 5)}` : ''} – {fmtDate(r.end_date)}{r.end_time ? ` ${r.end_time.slice(0, 5)}` : ''} ({fmtHours(r.total_hours ?? 0)})
                    </p>
                    {r.reason && <p className="text-xs text-muted italic mt-0.5">"{r.reason}"</p>}
                    {r.admin_notes && <p className="text-xs text-blue-600 mt-1">💬 {r.admin_notes}</p>}
                    {r.withdrawal_reason && <p className="text-xs text-muted mt-1">Withdrawn: {r.withdrawal_reason}</p>}
                  </div>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize" style={style}>
                    {status}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {tab === 'balances' && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm overflow-x-auto">
          {employees.length === 0 && <p className="p-6 text-center text-muted">No Employees Yet</p>}
          {employees.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-page">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 text-right">Annual Leave</th>
                  <th className="px-4 py-3 text-right">Personal/Sick Leave</th>
                  <th className="px-4 py-3 text-right">TIL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-page">
                {employees.map(emp => {
                  const a = Number(emp.annual_leave_balance ?? 0)
                  const p = Number(emp.personal_leave_balance ?? 0)
                  const t = Number(emp.accrued_til_hours ?? 0)
                  return (
                    <tr key={emp.id} className="hover:bg-page transition-colors">
                      <td className="px-4 py-3 font-medium text-ink">{emp.full_name}</td>
                      {/* `normal-case` pairs with font-clock to render the
                          lowercase "h"/"m" suffix from fmtHours (font-clock
                          uppercases by default). */}
                      <td className="px-4 py-3 text-right text-ink font-clock tabular-nums normal-case">{fmtHours(a)}</td>
                      <td className="px-4 py-3 text-right text-ink font-clock tabular-nums normal-case">{fmtHours(p)}</td>
                      <td className="px-4 py-3 text-right text-ink font-clock tabular-nums normal-case">{fmtHours(t)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Edit/delete dialog — opens when admin clicks any leave entry */}
      {openReq && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6"
             onClick={() => setOpenReq(null)}>
          <div className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-lg">{(openReq.profiles as Profile)?.full_name}</p>
              <button type="button" onClick={() => setOpenReq(null)} className="text-muted hover:text-ink">✕</button>
            </div>
            <p className="text-xs text-muted capitalize">{openReq.status}</p>

            <div>
              <label className={labelCls}>Leave Type</label>
              <select value={editForm.leave_type}
                      onChange={e => setEditForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}
                      className={inputCls}>
                {Object.entries(leaveLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
                <option value="unpaid">Unpaid</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className={labelCls}>Start Date</label>
                <input type="date" value={editForm.start_date}
                       onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))}
                       className={`${inputCls} min-w-0`} />
              </div>
              <div className="min-w-0">
                <label className={labelCls}>Start Time</label>
                <input type="time" value={editForm.start_time}
                       onChange={e => setEditForm(f => ({ ...f, start_time: e.target.value }))}
                       className={`${inputCls} min-w-0`} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className={labelCls}>End Date</label>
                <input type="date" value={editForm.end_date}
                       onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))}
                       className={`${inputCls} min-w-0`} />
              </div>
              <div className="min-w-0">
                <label className={labelCls}>End Time</label>
                <input type="time" value={editForm.end_time}
                       onChange={e => setEditForm(f => ({ ...f, end_time: e.target.value }))}
                       className={`${inputCls} min-w-0`} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Total Hours</label>
              <input type="number" step="any" min="0" value={editForm.total_hours}
                     onChange={e => setEditForm(f => ({ ...f, total_hours: parseFloat(e.target.value) || 0 }))}
                     className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Reason</label>
              <textarea value={editForm.reason}
                        onChange={e => setEditForm(f => ({ ...f, reason: e.target.value }))}
                        className={`${inputCls} resize-none`} rows={2} />
            </div>
            <div>
              <label className={labelCls}>Admin Note</label>
              <textarea value={editForm.admin_notes}
                        onChange={e => setEditForm(f => ({ ...f, admin_notes: e.target.value }))}
                        className={`${inputCls} resize-none`} rows={2} />
            </div>
            {editErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{editErr}</p>}
            <div className="flex gap-3 pt-2">
              <button
                onClick={saveEdit}
                disabled={editBusy}
                style={{ backgroundColor: '#D7E363', color: '#141414' }}
                className={`${btnPrimary} flex-1 h-11`}
              >
                {editBusy ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => setOpenReq(null)}
                style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
                className={`${btnSecondary} flex-1 h-11`}
              >
                Cancel
              </button>
            </div>
            <button
              onClick={deleteRequest}
              disabled={editBusy}
              style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
              className={`${btnDanger} w-full h-11`}
            >
              Delete Request
            </button>
            {openReq.status === 'approved' && (
              <p className="text-[11px] text-center text-muted">
                Deleting will return {fmtHours(Number(openReq.total_hours ?? 0))} to the employee's {leaveLabels[openReq.leave_type]} balance.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'calendar' && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))} className={btnSecondary}>‹</button>
            <p className="font-semibold">{format(calMonth, 'MMMM yyyy')}</p>
            <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))} className={btnSecondary}>›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <div key={i} className="text-xs font-semibold text-muted">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
            {(() => {
              // Mon..Sun of the current week (calendar grid week, not LBG pay week)
              const now = new Date()
              const weekday = (now.getDay() + 6) % 7  // 0 = Mon ... 6 = Sun
              const monday = new Date(now); monday.setDate(now.getDate() - weekday); monday.setHours(0,0,0,0)
              const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23,59,59,999)
              return days.map(day => {
                const leaves = leavesOnDay(day)
                const inCurrentWeek = day >= monday && day <= sunday
                const phName = holidayFor(day)
                return (
                  <div key={day.toISOString()} className="min-h-[96px] sm:min-h-[112px] p-1.5 text-center bg-page">
                    <p className="text-xs font-medium" style={{ color: inCurrentWeek ? '#1c9fda' : undefined }}>{format(day, 'd')}</p>
                  {phName && (
                    <div
                      className="text-[10px] leading-tight rounded px-0.5 mt-0.5 truncate font-semibold"
                      style={{ backgroundColor: '#B4B3B3', color: '#595858' }}
                      title={phName}
                    >
                      P/H
                    </div>
                  )}
                  {leaves.map(l => {
                    const fullName = (l.profiles as Profile)?.full_name ?? ''
                    const parts = fullName.trim().split(/\s+/)
                    const display = parts.length >= 2
                      ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}`
                      : parts[0] ?? ''
                    return (
                      <div
                        key={l.id}
                        className="text-[10px] leading-tight rounded px-0.5 mt-0.5 truncate text-ink"
                        style={{ backgroundColor: empColour(l.employee_id) }}
                        title={fullName}
                      >
                        {display}
                      </div>
                    )
                  })}
                </div>
              )
              })
            })()}
          </div>
          {/* Legend */}
          {approved.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-page">
              <span className="text-[11px] rounded-full px-2 py-0.5 font-semibold"
                    style={{ backgroundColor: '#B4B3B3', color: '#595858' }}>
                P/H — VIC Public Holiday
              </span>
              {Array.from(new Map(approved.map(l => [l.employee_id, (l.profiles as Profile)?.full_name ?? ''])).entries()).map(([eid, fullName]) => {
                const parts = fullName.trim().split(/\s+/)
                const display = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}` : parts[0] ?? ''
                return (
                  <span key={eid} className="text-[11px] rounded-full px-2 py-0.5 text-ink"
                        style={{ backgroundColor: empColour(eid) }}>
                    {display}
                  </span>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Admin-creates-leave-for-employee dialog */}
      {showAddLeave && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6"
             onClick={() => setShowAddLeave(false)}>
          <form onSubmit={submitAddLeave}
                className="bg-surface w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-lg">Add Leave For Employee</p>
              <button type="button" onClick={() => setShowAddLeave(false)} className="text-muted hover:text-ink">✕</button>
            </div>
            <p className="text-xs text-muted">Creates an immediately-approved leave entry; it appears on the calendar and the employee's balance is debited.</p>

            <div>
              <label className={labelCls}>Employee</label>
              <select value={addForm.employee_id}
                      onChange={e => setAddForm(f => ({ ...f, employee_id: e.target.value }))}
                      className={inputCls} required>
                <option value="">— Pick An Employee —</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Leave Type</label>
              <select value={addForm.leave_type}
                      onChange={e => setAddForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}
                      className={inputCls}>
                {Object.entries(leaveLabels).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <label className="min-w-0 overflow-hidden">
                <span className={labelCls}>Start Date</span>
                <input type="date" value={addForm.start_date}
                       onChange={e => setAddForm(f => ({ ...f, start_date: e.target.value }))}
                       style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                       className="block border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                       required />
              </label>
              <label className="min-w-0 overflow-hidden">
                <span className={labelCls}>Start Time</span>
                <input type="time" value={addForm.start_time}
                       onChange={e => setAddForm(f => ({ ...f, start_time: e.target.value }))}
                       style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                       className="block border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <label className="min-w-0 overflow-hidden">
                <span className={labelCls}>End Date</span>
                <input type="date" value={addForm.end_date}
                       onChange={e => setAddForm(f => ({ ...f, end_date: e.target.value }))}
                       style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                       className="block border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                       required />
              </label>
              <label className="min-w-0 overflow-hidden">
                <span className={labelCls}>End Time</span>
                <input type="time" value={addForm.end_time}
                       onChange={e => setAddForm(f => ({ ...f, end_time: e.target.value }))}
                       style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                       className="block border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20" />
              </label>
            </div>

            <div>
              <label className={labelCls}>Reason (Optional)</label>
              <textarea value={addForm.reason}
                        onChange={e => setAddForm(f => ({ ...f, reason: e.target.value }))}
                        className={`${inputCls} resize-none`} rows={2} />
            </div>

            {addErr && <p className="text-sm text-red-600 bg-red-50 px-3 py-2">{addErr}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowAddLeave(false)}
                style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
                className={`${btnSecondary} flex-1 h-11`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addBusy}
                style={{ backgroundColor: '#D7E363', color: '#141414' }}
                className={`${btnPrimary} flex-1 h-11`}
              >
                {addBusy ? 'Adding…' : 'Add Leave'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
