import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type Profile } from '../../lib/supabase'
import { fmtDate, btnPrimary, btnDanger, btnSecondary, inputCls, labelCls } from '../../lib/utils'
import { format, eachDayOfInterval, parseISO, startOfMonth, endOfMonth, getDay } from 'date-fns'

const leaveLabels: Record<string, string> = {
  annual: 'Annual', sick: 'Sick', personal: 'Personal', time_in_lieu: 'TOIL', unpaid: 'Unpaid',
}

export default function LeaveManagement() {
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [approved, setApproved] = useState<LeaveRequest[]>([])
  const [calMonth, setCalMonth] = useState(new Date())
  const [tab, setTab] = useState<'pending' | 'calendar'>('pending')
  const [adminNote, setAdminNote] = useState('')
  const [deciding, setDeciding] = useState<string | null>(null)

  const load = async () => {
    const [{ data: pending }, { data: appr }] = await Promise.all([
      supabase.from('leave_requests').select('*, profiles(full_name)').eq('status', 'pending').order('start_date'),
      supabase.from('leave_requests').select('*, profiles(full_name)').eq('status', 'approved').order('start_date'),
    ])
    setRequests((pending as LeaveRequest[]) ?? [])
    setApproved((appr as LeaveRequest[]) ?? [])
  }

  useEffect(() => { load() }, [])

  const decide = async (r: LeaveRequest, status: 'approved' | 'declined') => {
    setDeciding(r.id)
    await supabase.from('leave_requests').update({ status, admin_notes: adminNote || null }).eq('id', r.id)
    // Deduct leave balance if approved
    if (status === 'approved') {
      const field: Record<string, string> = {
        annual: 'annual_leave_balance', sick: 'sick_leave_balance',
        personal: 'personal_leave_balance', time_in_lieu: 'accrued_tol_hours',
      }
      const col = field[r.leave_type]
      if (col) {
        const { data: prof } = await supabase.from('profiles').select(`${col}`).eq('id', r.employee_id).single()
        if (prof) {
          const current = (prof as unknown as Record<string, number>)[col] ?? 0
          const deduct = r.leave_type === 'time_in_lieu' ? (r.total_days ?? 0) * 8 : (r.total_days ?? 0)
          await supabase.from('profiles').update({ [col]: Math.max(0, current - deduct) }).eq('id', r.employee_id)
          if (r.leave_type === 'time_in_lieu') {
            await supabase.from('tol_ledger').insert({
              employee_id: r.employee_id, date: new Date().toISOString().split('T')[0],
              hours_delta: -(r.total_days ?? 0) * 8, source: 'leave_used',
              note: `TOIL leave approved ${r.start_date}–${r.end_date}`,
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
      <h1 className="text-2xl font-bold text-gray-900">Leave Management</h1>

      <div className="flex gap-2">
        {(['pending', 'calendar'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${tab === t ? 'bg-[#1c9fda] text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
            {t === 'pending' ? `Pending (${requests.length})` : 'Calendar'}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="space-y-4">
          {requests.length === 0 && <p className="text-center text-gray-400 py-10">No pending requests</p>}
          {requests.map(r => (
            <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
              <div className="flex justify-between">
                <div>
                  <p className="font-semibold">{(r.profiles as Profile)?.full_name}</p>
                  <p className="text-sm text-gray-500">{leaveLabels[r.leave_type]} · {fmtDate(r.start_date)} – {fmtDate(r.end_date)} ({r.total_days} days)</p>
                  {r.reason && <p className="text-xs text-gray-400 italic mt-0.5">"{r.reason}"</p>}
                </div>
              </div>
              <div>
                <label className={labelCls}>Note (optional)</label>
                <input value={adminNote} onChange={e => setAdminNote(e.target.value)} className={inputCls} placeholder="Reason for decision…" />
              </div>
              <div className="flex gap-3">
                <button onClick={() => decide(r, 'approved')} disabled={deciding === r.id} className={`${btnPrimary} flex-1 h-11`}>✓ Approve</button>
                <button onClick={() => decide(r, 'declined')} disabled={deciding === r.id} className={`${btnDanger} flex-1 h-11`}>✗ Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'calendar' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))} className={btnSecondary}>‹</button>
            <p className="font-semibold">{format(calMonth, 'MMMM yyyy')}</p>
            <button onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))} className={btnSecondary}>›</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <div key={i} className="text-xs font-semibold text-gray-400">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startPad }).map((_, i) => <div key={`pad-${i}`} />)}
            {days.map(day => {
              const leaves = leavesOnDay(day)
              return (
                <div key={day.toISOString()} className="min-h-[52px] rounded-lg p-1 text-center bg-gray-50">
                  <p className="text-xs text-gray-600 font-medium">{format(day, 'd')}</p>
                  {leaves.map(l => (
                    <div key={l.id} className="text-[10px] leading-tight bg-[#1c9fda]/20 text-[#1c9fda] rounded px-0.5 mt-0.5 truncate">
                      {(l.profiles as Profile)?.full_name?.split(' ')[0]}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
