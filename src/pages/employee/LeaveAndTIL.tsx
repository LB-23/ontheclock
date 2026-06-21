import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type LeaveType } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtDate, fmtClock, fmtHours, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'
import AdminNoteBanner from '../../components/AdminNoteBanner'
import { useEscapeKey } from '../../hooks/useEscapeKey'

const leaveLabels: Record<LeaveType, string> = {
  annual:       'Annual Leave',
  personal:     'Personal/Sick Leave',
  time_in_lieu: 'Time In Lieu',
  unpaid:       'Unpaid Leave',
}

const shortLabels: Record<LeaveType, string> = {
  annual:       'Annual',
  personal:     'Personal/Sick',
  time_in_lieu: 'TIL',
  unpaid:       'Unpaid',
}

type FormState = {
  leave_type: LeaveType
  start_date: string
  start_time: string   // 'HH:mm'
  end_date:   string
  end_time:   string
  reason: string
}

const BLANK: FormState = {
  leave_type: 'annual',
  start_date: '',
  start_time: '00:00',
  end_date:   '',
  end_time:   '00:00',
  reason: '',
}

export default function LeaveAndTIL() {
  const { profile } = useProfile()
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK)
  const [openReq, setOpenReq] = useState<LeaveRequest | null>(null)
  const [withdrawing, setWithdrawing] = useState(false)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [err, setErr] = useState('')

  // Esc closes the detail dialog (and clears the inline withdraw form state)
  useEscapeKey(!!openReq, () => { setOpenReq(null); setWithdrawReason(''); setErr('') })

  const reload = () => {
    if (!profile) return
    supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', profile.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests((data as LeaveRequest[]) ?? []))
  }
  useEffect(reload, [profile])

  // Default end_time to start_time + (weekly/5) when only one of them is set
  useEffect(() => {
    if (!profile) return
    if (form.start_date && form.end_date && form.start_time) {
      const dailyMins = Math.round(profile.weekly_hours_category / 5 * 60)
      const [h, m] = form.start_time.split(':').map(Number)
      const startMins = h * 60 + m
      const endMins   = startMins + dailyMins
      const eh = String(Math.floor(endMins / 60) % 24).padStart(2, '0')
      const em = String(endMins % 60).padStart(2, '0')
      // Only auto-fill once on initial dates entry
      if (!form.end_time) setForm(f => ({ ...f, end_time: `${eh}:${em}` }))
    }
  }, [form.start_date, form.end_date, profile])  // eslint-disable-line react-hooks/exhaustive-deps

  // Compute total hours from start_date+time -> end_date+time considering daily required hours
  const computeTotalHours = (): number => {
    if (!profile || !form.start_date || !form.end_date || !form.start_time || !form.end_time) return 0
    const dailyHrs = profile.weekly_hours_category / 5
    const start = new Date(`${form.start_date}T${form.start_time}`)
    const end   = new Date(`${form.end_date}T${form.end_time}`)
    if (end <= start) return 0

    // Days inclusive
    const startDay = new Date(form.start_date).getTime()
    const endDay   = new Date(form.end_date).getTime()
    const dayCount = Math.round((endDay - startDay) / 86400000) + 1

    if (dayCount === 1) {
      // Same-day: just the duration in hours (capped at daily)
      const hrs = (end.getTime() - start.getTime()) / 3_600_000
      return Math.round(Math.min(hrs, dailyHrs) * 10) / 10
    }

    // Multi-day: hours from start_time to end-of-workday on day 1,
    //          + full days for days in between,
    //          + hours from start-of-workday to end_time on last day.
    const endOfDay1Mins = (7 * 60) + (dailyHrs * 60)  // assume 7am start; cap at start_time + dailyHrs
    const [sh, sm] = form.start_time.split(':').map(Number)
    const startMins = sh * 60 + sm
    const day1Hrs = Math.max(0, (endOfDay1Mins - startMins) / 60)

    const [eh2, em2] = form.end_time.split(':').map(Number)
    const endMins = eh2 * 60 + em2
    // Day N: from 7am up to end_time (capped at dailyHrs)
    const dayNHrs = Math.max(0, Math.min(endMins - 7 * 60, dailyHrs * 60) / 60)

    const middleDays = dayCount - 2
    const total = day1Hrs + (middleDays * dailyHrs) + dayNHrs
    return Math.round(total * 10) / 10
  }

  const totalHours = computeTotalHours()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !form.start_date || !form.end_date) return
    if (totalHours <= 0) { setErr('Times need to span at least a partial day.'); return }
    setLoading(true)
    setErr('')
    const { data, error } = await supabase.from('leave_requests').insert({
      employee_id: profile.id,
      leave_type:  form.leave_type,
      start_date:  form.start_date,
      end_date:    form.end_date,
      start_time:  form.start_time + ':00',
      end_time:    form.end_time   + ':00',
      total_hours: totalHours,
      reason:      form.reason || null,
      status:      'pending',
    }).select().single()
    setLoading(false)
    if (error) { setErr(error.message); return }
    if (data) {
      setRequests(prev => [data as LeaveRequest, ...prev])
      setShowForm(false)
      setForm(BLANK)
    }
  }

  const removeRequest = async (r: LeaveRequest) => {
    if (!confirm(`Remove this ${leaveLabels[r.leave_type]} request? This cannot be undone.`)) return
    const { error } = await supabase.from('leave_requests').delete().eq('id', r.id)
    if (error) { alert('Could not delete: ' + error.message); return }
    setOpenReq(null)
    reload()
  }

  const withdraw = async (r: LeaveRequest) => {
    if (!withdrawReason.trim()) { setErr('A reason is required to withdraw approved leave.'); return }
    setWithdrawing(true)
    setErr('')
    // Restore the deducted hours back to the employee's balance
    if (profile) {
      const balCol: Record<string, keyof typeof profile> = {
        annual:       'annual_leave_balance',
        personal:     'personal_leave_balance',
        time_in_lieu: 'accrued_til_hours',
      }
      const col = balCol[r.leave_type]
      if (col) {
        const current = Number(profile[col] ?? 0)
        const restore = Number(r.total_hours ?? 0)
        await supabase.from('profiles').update({ [col]: current + restore }).eq('id', profile.id)
      }
    }
    const { error } = await supabase.from('leave_requests').update({
      status: 'withdrawn',
      withdrawal_reason: withdrawReason.trim(),
      withdrawn_at: new Date().toISOString(),
    }).eq('id', r.id)
    setWithdrawing(false)
    if (error) { setErr(error.message); return }
    setOpenReq(null)
    setWithdrawReason('')
    reload()
  }

  // Status palette — soft pastel bg + deeply-toned text. Each pair clears
  // WCAG AA 4.5:1 against its own bg.
  const statusStyle = (s: string): React.CSSProperties => {
    if (s === 'pending')   return { backgroundColor: '#fbe3bd', color: '#f99702' }
    if (s === 'approved')  return { backgroundColor: '#d2f2a9', color: '#8bc93d' }
    if (s === 'declined' || s === 'rejected') return { backgroundColor: '#FDBEB5', color: '#9C0F0F' }
    if (s === 'withdrawn') return { backgroundColor: '#CDCBCB', color: '#3E3E3E' }
    return {}
  }
  const badgeCls = 'inline-flex items-center rounded-none px-2 py-[3px] text-[9px] font-semibold font-forma uppercase'

  // Detail dialog for a leave request
  const detailDialog = openReq && (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6"
         onClick={() => { setOpenReq(null); setWithdrawReason(''); setErr('') }}>
      <div className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-lg">{leaveLabels[openReq.leave_type]}</p>
          <button onClick={() => { setOpenReq(null); setWithdrawReason('') }} className="text-muted hover:text-ink">✕</button>
        </div>
        <span className={badgeCls} style={statusStyle(openReq.status)}>{openReq.status}</span>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Start</dt><dd>{fmtDate(openReq.start_date)}{openReq.start_time ? ` · ${fmtClock(openReq.start_time)}` : ''}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">End</dt><dd>{fmtDate(openReq.end_date)}{openReq.end_time ? ` · ${fmtClock(openReq.end_time)}` : ''}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Total Hours</dt><dd className="font-bold">{fmtHours(openReq.total_hours ?? 0)}</dd></div>
          {openReq.reason && (
            <div><dt className="text-muted">Reason</dt><dd className="mt-0.5">{openReq.reason}</dd></div>
          )}
          {openReq.admin_notes && (
            <div>
              <dt className="text-muted">Admin Note</dt>
              <dd className="mt-0.5"><AdminNoteBanner>{openReq.admin_notes}</AdminNoteBanner></dd>
            </div>
          )}
          {openReq.withdrawal_reason && (
            <div><dt className="text-muted">Withdrawal Reason</dt><dd className="mt-0.5">{openReq.withdrawal_reason}</dd></div>
          )}
        </dl>

        {/* Pending / withdrawn / declined: can be removed outright */}
        {(openReq.status === 'pending' || openReq.status === 'withdrawn' || openReq.status === 'declined') && (
          <button onClick={() => removeRequest(openReq)} className={`${btnDanger} w-full h-11`}>
            Delete Request
          </button>
        )}

        {/* Approved: needs withdrawal flow with reason */}
        {openReq.status === 'approved' && (
          <div className="space-y-2 pt-2 border-t border-page">
            <label className={labelCls}>Reason for withdrawing leave <span className="text-red-500">*</span></label>
            <textarea value={withdrawReason} onChange={e => setWithdrawReason(e.target.value)}
                      className={`${inputCls} resize-none`} rows={3}
                      placeholder="e.g. Site emergency, plans changed…" />
            {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
            <button onClick={() => withdraw(openReq)} disabled={withdrawing}
                    className={`${btnDanger} w-full h-11`}>
              {withdrawing ? 'Withdrawing…' : 'Withdraw Approved Leave'}
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Leave & TIL</h1>

      {/* Balances — equal-size tiles, labels on one line.
          Per brand update, the H/M figure is rendered non-bold so the heading
          (leave type) is the only emphasised line in each tile. Balances are
          hidden while the request form is open so the form sits high on the
          page right under the heading. */}
      {profile && !showForm && (
        <div className="grid grid-cols-3 gap-3">
          {[
            // May 2026 design-system tile palette — same sky ramp as admin Dashboard
            { label: 'Annual Leave',        value: fmtHours(profile.annual_leave_balance),   bg: '#9ADBED' },
            { label: 'Personal/Sick Leave', value: fmtHours(profile.personal_leave_balance), bg: '#5DC4E3' },
            { label: 'Time In Lieu',        value: fmtHours(profile.accrued_til_hours),      bg: '#0096C7' },
          ].map(b => (
            <div key={b.label} style={{ backgroundColor: b.bg, color: '#000000' }}
                 className="p-3 sm:p-4 overflow-hidden">
              <p className="text-micro sm:text-micro font-semibold uppercase tracking-tight whitespace-nowrap">
                {b.label}
              </p>
              <p className="text-xl sm:text-2xl font-normal mt-1 font-clock normal-case">{b.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* When the form is closed we surface the Request Leave button; when it's
          open we collapse that prompt and lift the form to take its place. The
          Cancel + Submit buttons then sit side-by-side at the bottom of the
          form so the action pair lives in one consistent spot. */}
      {!showForm && (
        <button
          onClick={() => { setShowForm(true); setErr('') }}
          style={{ backgroundColor: '#e8e8e8', color: '#0352fb', fontSize: '12px' }}
          className={`${btnPrimary} w-full h-12`}
        >
          Request Leave
        </button>
      )}

      {showForm && (
        <form onSubmit={submit} className="bg-surface border border-page p-5 space-y-4">
          <div>
            <label className={labelCls}>Leave Type</label>
            <select value={form.leave_type}
                    onChange={e => setForm(f => ({ ...f, leave_type: e.target.value as LeaveType }))}
                    className={inputCls}>
              {Object.entries(leaveLabels).filter(([k]) => k !== 'unpaid').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {/* CSS grid (not flex) gives each cell a fixed 50% width that the native
              iOS date/time chrome cannot overflow. `overflow-hidden` clips any
              rogue picker UI, `appearance:none` removes Safari's intrinsic
              min-width from the placeholder so cells sit clearly separated. */}
          <div className="grid grid-cols-2 gap-4">
            <label className="min-w-0 overflow-hidden">
              <span className={labelCls}>Start Date</span>
              <input type="date" value={form.start_date}
                     onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
                     style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                     className="block rounded-xl border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                     required />
            </label>
            <label className="min-w-0 overflow-hidden">
              <span className={labelCls}>Start Time</span>
              <input type="time" value={form.start_time}
                     onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                     style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                     className="block rounded-xl border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                     required />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label className="min-w-0 overflow-hidden">
              <span className={labelCls}>End Date</span>
              <input type="date" value={form.end_date}
                     onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))}
                     style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                     className="block rounded-xl border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                     required />
            </label>
            <label className="min-w-0 overflow-hidden">
              <span className={labelCls}>End Time</span>
              <input type="time" value={form.end_time}
                     onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                     style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', WebkitAppearance: 'none', appearance: 'none' }}
                     className="block rounded-xl border border-page bg-surface px-2 py-2.5 text-xs sm:text-sm text-ink focus:border-sky focus:outline-none focus:ring-2 focus:ring-sky/20"
                     required />
            </label>
          </div>
          <div className="rounded-xl bg-page px-4 py-3 flex justify-between items-center">
            <span className="text-xs uppercase font-semibold tracking-wide text-muted">Total leave hours</span>
            <span className="text-lg font-clock normal-case font-bold text-ink">{fmtHours(totalHours)}</span>
          </div>
          <div>
            <label className={labelCls}>Reason (optional)</label>
            <textarea value={form.reason}
                      onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                      className={`${inputCls} resize-none`} rows={2} />
          </div>
          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
          {/* Cancel sits beside Submit Request at the bottom of the form per
              brand directive so the action pair is together. Cancel is the
              dark-grey "neutralise" button; Submit is the lime CTA. */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setShowForm(false); setErr('') }}
              style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
              className={`${btnSecondary} flex-1 h-12`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
              className={`${btnPrimary} flex-1 h-12`}
            >
              {loading ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      )}

      {/* History — clickable rows open the detail dialog. Hidden while the
          request form is open so the form gets full attention. */}
      {!showForm && (
      <div className="space-y-3">
        {requests.length === 0 && (
          <div className="text-center py-8" style={{ color: '#D9D9D9' }}>
            <p>No Leave Requests Yet</p>
            <p className="text-xs mt-1">Request leave when you need time off.</p>
          </div>
        )}
        {requests.map(r => (
          <button key={r.id} onClick={() => { setOpenReq(r); setErr('') }}
                  className="w-full text-left bg-surface rounded-2xl border border-page shadow-sm px-5 py-4 hover:border-sky/40 transition-colors">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-sm font-semibold">{shortLabels[r.leave_type]} Leave</p>
                <p className="text-xs text-muted mt-0.5">
                  {fmtDate(r.start_date)}
                  {r.start_time ? ` ${fmtClock(r.start_time)}` : ''}
                  {' — '}
                  {fmtDate(r.end_date)}
                  {r.end_time ? ` ${fmtClock(r.end_time)}` : ''}
                  {r.total_hours ? ` (${fmtHours(r.total_hours)})` : ''}
                </p>
                {r.reason && <p className="text-xs text-muted mt-0.5">{r.reason}</p>}
              </div>
              <span className={badgeCls} style={statusStyle(r.status)}>{r.status}</span>
            </div>
          </button>
        ))}
      </div>
      )}

      {detailDialog}
    </div>
  )
}

