import { useEffect, useState } from 'react'
import { supabase, type LeaveRequest, type LeaveType } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtDate, fmtClock, fmtHours, computeLeaveHours, btnPrimary, btnSecondary, btnDanger, inputCls, labelCls } from '../../lib/utils'
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
  // When set, the request form is editing this (admin-created) leave rather than
  // creating a new one — saving restores the old deduction and re-submits.
  const [editing, setEditing] = useState<LeaveRequest | null>(null)
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
      .neq('leave_type', 'away')   // "Away" admin flags are calendar-only
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

  // Total leave hours, counting only workdays (excludes weekends + VIC public
  // holidays — those aren't deducted from a leave balance). See computeLeaveHours.
  const computeTotalHours = (): number => {
    if (!profile || !form.start_date || !form.end_date || !form.start_time || !form.end_time) return 0
    const dailyHrs = profile.weekly_hours_category / 5
    return computeLeaveHours(form.start_date, form.start_time, form.end_date, form.end_time, dailyHrs)
  }

  const totalHours = computeTotalHours()

  // Load an (admin-created, approved) leave into the form for editing.
  const startEdit = (r: LeaveRequest) => {
    setForm({
      leave_type: r.leave_type,
      start_date: r.start_date,
      start_time: r.start_time ? r.start_time.slice(0, 5) : '07:00',
      end_date:   r.end_date,
      end_time:   r.end_time ? r.end_time.slice(0, 5) : '15:00',
      reason:     r.reason ?? '',
    })
    setEditing(r)
    setOpenReq(null)
    setShowForm(true)
    setErr('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile || !form.start_date || !form.end_date) return
    if (totalHours <= 0) { setErr('Times need to span at least a partial day.'); return }
    setLoading(true)
    setErr('')

    // Editing an existing (admin-created) leave: restore the previously-deducted
    // hours and send it back for re-approval (status -> pending). The admin's
    // approval then re-deducts the new amount.
    if (editing) {
      const balCol: Record<string, string> = {
        annual: 'annual_leave_balance', personal: 'personal_leave_balance', time_in_lieu: 'accrued_til_hours',
      }
      const col = balCol[editing.leave_type]
      if (col && editing.status === 'approved') {
        const { data: prof } = await supabase.from('profiles').select(col).eq('id', profile.id).single()
        if (prof) {
          const current = (prof as unknown as Record<string, number>)[col] ?? 0
          await supabase.from('profiles').update({ [col]: current + (editing.total_hours ?? 0) }).eq('id', profile.id)
          if (editing.leave_type === 'time_in_lieu') {
            await supabase.from('til_ledger').insert({
              employee_id: profile.id, date: new Date().toISOString().split('T')[0],
              hours_delta: (editing.total_hours ?? 0), source: 'leave_used',
              note: 'TIL leave edited — restored pending re-approval',
            })
          }
        }
      }
      const { error: upErr } = await supabase.from('leave_requests').update({
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date:   form.end_date,
        start_time: form.start_time + ':00',
        end_time:   form.end_time + ':00',
        total_hours: totalHours,
        reason:     form.reason || null,
        status:     'pending',
      }).eq('id', editing.id)
      setLoading(false)
      if (upErr) { setErr(upErr.message); return }
      const editedId = editing.id
      setEditing(null); setShowForm(false); setForm(BLANK); reload()
      supabase.functions.invoke('notify-leave-request', { body: { leave_request_id: editedId } }).catch(() => {})
      return
    }

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
      // Notify admins immediately (fire-and-forget — a push failure must not
      // block the employee's submission).
      supabase.functions.invoke('notify-leave-request', {
        body: { leave_request_id: (data as LeaveRequest).id },
      }).catch(() => { /* ignore */ })
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
    if (s === 'approved')  return { backgroundColor: '#dff8be', color: '#8bc93d' }
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

        {/* Admin-created approved leave: the employee can edit it. Saving sends
            it back for re-approval (status -> pending). */}
        {openReq.status === 'approved' && openReq.admin_notes === 'Added by admin' && (
          <button onClick={() => startEdit(openReq)} className={`${btnPrimary} w-full h-11`}>
            Edit Leave
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
            { label: 'Annual Leave',        value: fmtHours(profile.annual_leave_balance),   bg: '#a3dff5' },
            { label: 'Personal/Sick Leave', value: fmtHours(profile.personal_leave_balance), bg: '#47bfeb' },
            { label: 'Time In Lieu',        value: fmtHours(profile.accrued_til_hours),      bg: '#1787b9' },
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
          onClick={() => { setEditing(null); setForm(BLANK); setShowForm(true); setErr('') }}
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
              onClick={() => { setShowForm(false); setEditing(null); setForm(BLANK); setErr('') }}
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
              {loading ? (editing ? 'Re-submitting…' : 'Submitting…') : (editing ? 'Re-submit' : 'Submit Request')}
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

