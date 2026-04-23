import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type LeaveType } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtDate, workdaysBetween, btnPrimary, inputCls, labelCls } from '../../lib/utils'

const leaveLabels: Record<LeaveType, string> = {
  annual:      'Annual Leave',
  sick:        'Sick Leave',
  personal:    'Personal Leave',
  time_in_lieu:'Time in Lieu',
  unpaid:      'Unpaid Leave',
}

export default function LeaveAndTOIL() {
  const { profile } = useProfile()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ leave_type: 'annual' as LeaveType, start_date: '', end_date: '', reason: '' })

  useEffect(() => {
    if (!profile) return
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests((data as LeaveRequest[]) ?? []))
  }, [profile])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !form.start_date || !form.end_date) return
    setLoading(true)
    const days = workdaysBetween(form.start_date, form.end_date)
    const { data } = await supabase.from('leave_requests').insert({
      employee_id: profile.id,
      leave_type:  form.leave_type,
      start_date:  form.start_date,
      end_date:    form.end_date,
      total_days:  days,
      reason:      form.reason || null,
      status:      'pending',
    }).select().single()
    setLoading(false)
    if (data) { setRequests(prev => [data as LeaveRequest, ...prev]); setShowForm(false) }
  }

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending:  'bg-amber-100 text-amber-700',
      approved: 'bg-green-100 text-green-700',
      declined: 'bg-red-100 text-red-600',
    }
    return `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${map[s] ?? ''}`
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Leave & TOIL</h1>

      {/* Balances */}
      {profile && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Annual Leave',  value: `${profile.annual_leave_balance} days`,   color: 'bg-green-50 text-green-700' },
            { label: 'Sick Leave',    value: `${profile.sick_leave_balance} days`,      color: 'bg-blue-50 text-blue-700' },
            { label: 'Personal',      value: `${profile.personal_leave_balance} days`,  color: 'bg-purple-50 text-purple-700' },
            { label: 'TOIL',          value: `${profile.accrued_tol_hours} hrs`,        color: 'bg-orange-50 text-orange-700' },
          ].map(b => (
            <div key={b.label} className={`rounded-2xl p-4 ${b.color}`}>
              <p className="text-xs font-semibold opacity-70">{b.label}</p>
              <p className="text-xl font-bold mt-1">{b.value}</p>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setShowForm(!showForm)} className={`${btnPrimary} w-full h-12`}>
        {showForm ? 'Cancel' : '+ Request Leave'}
      </button>

      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <div>
            <label className={labelCls}>Leave Type</label>
            <select
              value={form.leave_type}
              onChange={e => setForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}
              className={inputCls}
            >
              {Object.entries(leaveLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className={inputCls} required />
            </div>
          </div>
          <div>
            <label className={labelCls}>Reason (optional)</label>
            <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className={`${inputCls} resize-none`} rows={2} />
          </div>
          <button type="submit" disabled={loading} className={`${btnPrimary} w-full h-12`}>
            {loading ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      )}

      {/* History */}
      <div className="space-y-3">
        {requests.length === 0 && <p className="text-center text-gray-400 py-8">No leave requests yet</p>}
        {requests.map(r => (
          <div key={r.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-semibold">{leaveLabels[r.leave_type]}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(r.start_date)} — {fmtDate(r.end_date)}
                  {r.total_days ? ` (${r.total_days} days)` : ''}
                </p>
                {r.reason && <p className="text-xs text-gray-400 mt-0.5 italic">"{r.reason}"</p>}
                {r.admin_notes && (
                  <p className="text-xs text-blue-600 mt-1">💬 {r.admin_notes}</p>
                )}
              </div>
              <span className={statusBadge(r.status)}>{r.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
