import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type Profile } from '../../lib/supabase'
import { fmtDate, fmtHours, btnPrimary, btnDanger, btnSecondary, inputCls, labelCls } from '../../lib/utils'
import { format, eachDayOfInterval, parseISO, startOfMonth, endOfMonth, getDay } from 'date-fns'

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
  const [tab, setTab] = useState<'pending' | 'approved' | 'all' | 'balances' | 'calendar'>('pending')
  const [adminNote, setAdminNote] = useState('')
  const [deciding, setDeciding] = useState<string | null>(null)

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
      <h1 className="text-2xl font-bold text-ink">Leave Management</h1>

      <div className="flex gap-2 flex-wrap">
        {(['pending', 'approved', 'all', 'balances', 'calendar'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${tab === t ? 'bg-sky text-white' : 'bg-surface border border-page text-muted'}`}>
            {t === 'pending'  ? `Pending (${requests.length})`
             : t === 'approved' ? `Approved (${approved.length})`
             : t === 'all'      ? `All (${allRequests.length})`
             : t === 'balances' ? `Team Balances (${employees.length})`
             : 'Calendar'}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="space-y-4">
          {requests.length === 0 && <p className="text-center text-muted py-10">No pending requests</p>}
          {requests.map(r => (
            <div key={r.id} className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3">
              <div className="flex justify-between">
                <div>
                  <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                  <p className="text-sm text-muted">
                    {leaveLabels[r.leave_type]} · {fmtDate(r.start_date)}{r.start_time ? ` ${r.start_time.slice(0, 5)}` : ''} – {fmtDate(r.end_date)}{r.end_time ? ` ${r.end_time.slice(0, 5)}` : ''} ({fmtHours(r.total_hours ?? 0)})
                  </p>
                  {r.reason && <p className="text-xs text-muted italic mt-0.5">"{r.reason}"</p>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Note (optional)</label>
                <input value={adminNote} onChange={e => setAdminNote(e.target.value)} className={inputCls} placeholder="Reason for decision…" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => decide(r, 'approved')} disabled={deciding === r.id} className={`${btnPrimary} flex-1 h-11`}>Approve</button>
                <button onClick={() => decide(r, 'declined')} disabled={deciding === r.id} className={`${btnDanger} flex-1 h-11`}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'approved' && (
        <div className="space-y-3">
          {approved.length === 0 && <p className="text-center text-muted py-10">No approved leave</p>}
          {approved.map(r => (
            <div key={r.id} className="bg-surface rounded-2xl border border-page shadow-sm px-5 py-4">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                  <p className="text-sm text-muted mt-0.5">
                    {leaveLabels[r.leave_type]} · {fmtDate(r.start_date)}{r.start_time ? ` ${r.start_time.slice(0, 5)}` : ''} – {fmtDate(r.end_date)}{r.end_time ? ` ${r.end_time.slice(0, 5)}` : ''}
                  </p>
                  {r.admin_notes && <p className="text-xs text-blue-600 mt-1">💬 {r.admin_notes}</p>}
                </div>
                <p className="text-sm font-bold font-clock text-skyDeep">{fmtHours(r.total_hours ?? 0)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'all' && (
        <div className="space-y-3">
          {allRequests.length === 0 && <p className="text-center text-muted py-10">No leave requests yet</p>}
          {allRequests.map(r => {
            const status = r.status
            const style: React.CSSProperties =
              status === 'pending'   ? { backgroundColor: 'rgba(249,151,2,0.20)', color: '#F99702' }
              : status === 'approved'  ? { backgroundColor: 'rgba(174,224,1,0.20)', color: '#AEE001' }
              : status === 'withdrawn' ? { backgroundColor: 'rgba(102,102,102,0.15)', color: '#666666' }
              : { backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' }
            return (
              <div key={r.id} className="bg-surface rounded-2xl border border-page shadow-sm px-5 py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                    <p className="text-sm text-muted mt-0.5">
                      {leaveLabels[r.leave_type]} · {fmtDate(r.start_date)}{r.start_time ? ` ${r.start_time.slice(0, 5)}` : ''} – {fmtDate(r.end_date)}{r.end_time ? ` ${r.end_time.slice(0, 5)}` : ''} ({fmtHours(r.total_hours ?? 0)})
                    </p>
                    {r.reason && <p className="text-xs text-muted italic mt-0.5">"{r.reason}"</p>}
                    {r.admin_notes && <p className="text-xs text-blue-600 mt-1">💬 {r.admin_notes}</p>}
                    {r.withdrawal_reason && <p className="text-xs text-muted mt-1">↩ Withdrawn: {r.withdrawal_reason}</p>}
                  </div>
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize" style={style}>
                    {status}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tab === 'balances' && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm overflow-x-auto">
          {employees.length === 0 && <p className="p-6 text-center text-muted">No employees yet</p>}
          {employees.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-page">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 text-right">Annual</th>
                  <th className="px-4 py-3 text-right">Personal/Sick</th>
                  <th className="px-4 py-3 text-right">TIL</th>
                  <th className="px-4 py-3 text-right">Total Hrs</th>
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
                      <td className="px-4 py-3 text-right text-ink font-clock tabular-nums">{fmtHours(a)}</td>
                      <td className="px-4 py-3 text-right text-ink font-clock tabular-nums">{fmtHours(p)}</td>
                      <td className="px-4 py-3 text-right text-ink font-clock tabular-nums">{fmtHours(t)}</td>
                      <td className="px-4 py-3 text-right font-semibold font-clock tabular-nums text-skyDeep">{fmtHours(a + p + t)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
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
            {days.map(day => {
              const leaves = leavesOnDay(day)
              return (
                <div key={day.toISOString()} className="min-h-[52px] rounded-lg p-1 text-center bg-page">
                  <p className="text-xs text-muted font-medium">{format(day, 'd')}</p>
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
            })}
          </div>
          {/* Legend */}
          {approved.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-page">
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
    </div>
  )
}
