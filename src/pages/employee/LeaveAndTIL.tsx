import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type LeaveType } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtDate, fmtHours, btnPrimary, inputCls, labelCls } from '../../lib/utils'

const leaveLabels: Record<LeaveType, string> = {
  annual:       'Annual Leave',
  personal:     'Personal/Sick Leave',
  time_in_lieu: 'Time In Lieu',
  unpaid:       'Unpaid Leave',
}

export default function LeaveAndTIL() {
  const { profile } = useProfile()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ leave_type: 'annual' as LeaveType, start_date: '', end_date: '', total_hours: 0, reason: '' })

  useEffect(() => {
    if (!profile) return
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests((data as LeaveRequest[]) ?? []))
  }, [profile])

  // Suggest hours based on date range and weekly_hours
  useEffect(() => {
    if (!form.start_date || !form.end_date || !profile) return
    const days = Math.max(1,
      Math.round((new Date(form.end_date).getTime() - new Date(form.start_date).getTime()) / 86400000) + 1
    )
    // 5-day work week assumption: hours/day = weekly / 5
    const dailyHrs = profile.weekly_hours_category / 5
    setForm(f => ({ ...f, total_hours: Math.round(days * dailyHrs * 10) / 10 }))
  }, [form.start_date, form.end_date, profile])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !form.start_date || !form.end_date) return
    setLoading(true)
    const { data } = await supabase.from('leave_requests').insert({
      employee_id: profile.id,
      leave_type:  form.leave_type,
      start_date:  form.start_date,
      end_date:    form.end_date,
      total_hours: form.total_hours,
      reason:      form.reason || null,
      status:      'pending',
    }).select().single()
    setLoading(false)
    if (data) {
      setRequests(prev => [data as LeaveRequest, ...prev])
      setShowForm(false)
      setForm({ leave_type: 'annual', start_date: '', end_date: '', total_hours: 0, reason: '' })
    }
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
      <h1 className="text-2xl font-bold text-ink">Leave & TIL</h1>

      {/* Balances — all in hours */}
      {profile && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Annual Leave',         value: fmtHours(profile.annual_leave_balance),   color: 'bg-green-50 text-green-700' },
            { label: 'Personal/Sick Leave',  value: fmtHours(profile.personal_leave_balance), color: 'bg-blue-50 text-blue-700' },
            { label: 'Time In Lieu',         value: fmtHours(profile.accrued_til_hours),      color: 'bg-orange-50 text-orange-700' },
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
        <form onSubmit={submit} className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
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
            <label className={labelCls}>Total Hours</label>
            <input type="number" step="0.5" min="0" value={form.total_hours} onChange={e => setForm(f => ({ ...f, total_hours: parseFloat(e.target.value) || 0 }))} className={inputCls} required />
            <p className="text-[11px] text-muted mt-1">Auto-calculated from dates · adjust if part day</p>
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
        {requests.length === 0 && <p className="text-center text-muted py-8">No leave requests yet</p>}
        {requests.map(r => (
          <div key={r.id} className="bg-surface rounded-2xl border border-page shadow-sm px-5 py-4">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-semibold">{leaveLabels[r.leave_type]}</p>
                <p className="text-xs text-muted mt-0.5">
                  {fmtDate(r.start_date)} — {fmtDate(r.end_date)}
                  {r.total_hours ? ` (${fmtHours(r.total_hours)})` : ''}
                </p>
                {r.reason && <p className="text-xs text-muted mt-0.5 italic">"{r.reason}"</p>}
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
