import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { btnPrimary, btnSecondary, inputCls, labelCls, fmtHours, timesheetSubmissionStatus, onTimeFlagCls } from '../../lib/utils'
import { pushSupported, enablePushForCurrentUser, disablePushForCurrentUser, getCurrentSubscription } from '../../lib/push'

/** Render a 'HH:MM:SS' reminder time as 12-hour with am/pm (e.g. '7:25 am') */
function fmtReminderTime(t: string | null | undefined): string {
  if (!t) return '— not set —'
  const [hStr, mStr] = t.split(':')
  const h = Number(hStr)
  const m = mStr ?? '00'
  const period = h >= 12 ? 'pm' : 'am'
  const h12 = ((h + 11) % 12) + 1
  return `${h12}:${m} ${period}`
}

export default function EmployeeProfile() {
  const { profile, refresh } = useProfile()
  const [mobile, setMobile] = useState(profile?.mobile_number ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Push state
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushErr, setPushErr] = useState('')
  const [muted, setMuted] = useState(profile ? !profile.notifications_enabled : false)

  // Timesheet submission timeliness (on-time vs late) — counts across the
  // user's submitted/approved timesheets that carry a submission timestamp.
  const [subStats, setSubStats] = useState({ onTime: 0, late: 0 })

  useEffect(() => {
    if (!pushSupported()) { setPermission('unsupported'); return }
    setPermission(Notification.permission)
    getCurrentSubscription().then(s => setSubscribed(!!s))
  }, [])

  useEffect(() => {
    if (!profile) return
    supabase.from('timesheets')
      .select('week_start, submitted_at')
      .eq('employee_id', profile.id)
      .in('status', ['submitted', 'approved', 'rejected'])
      .then(({ data }) => {
        let onTime = 0, late = 0
        for (const t of data ?? []) {
          const s = timesheetSubmissionStatus(t.week_start as string, t.submitted_at as string | null)
          if (s === 'on-time') onTime++
          else if (s === 'late') late++
        }
        setSubStats({ onTime, late })
      })
  }, [profile])

  useEffect(() => {
    if (profile) {
      setMobile(profile.mobile_number ?? '')
      setMuted(!profile.notifications_enabled)
    }
  }, [profile])

  if (!profile) return null
  const isAdmin = profile.app_role === 'admin'

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await supabase.from('profiles').update({ mobile_number: mobile }).eq('id', profile.id)
    await refresh()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleEnablePush = async () => {
    setPushBusy(true); setPushErr('')
    const res = await enablePushForCurrentUser()
    if (!res.ok) setPushErr(res.error ?? 'Could not enable')
    else { setPermission('granted'); setSubscribed(true) }
    setPushBusy(false)
  }

  const handleDisablePush = async () => {
    setPushBusy(true); setPushErr('')
    await disablePushForCurrentUser()
    setSubscribed(false)
    setPushBusy(false)
  }

  const toggleMute = async () => {
    const newMuted = !muted
    setMuted(newMuted)
    await supabase.from('profiles').update({ notifications_enabled: !newMuted }).eq('id', profile.id)
    await refresh()
  }

  return (
    <div className="space-y-6 max-w-md">
      <h1 className="text-2xl font-bold text-ink">My Profile</h1>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
          <div>
            <label className={labelCls}>Name</label>
            <p className="text-sm font-medium text-ink">{profile.full_name || '—'}</p>
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <p className="text-sm text-muted">{profile.email}</p>
          </div>
          <div>
            <label className={labelCls}>Mobile Number</label>
            <input
              type="tel"
              value={mobile}
              onChange={e => setMobile(e.target.value)}
              className="block w-full bg-transparent text-sm text-ink placeholder:text-[#D9D9D9] focus:outline-none"
              placeholder="04XX XXX XXX"
            />
          </div>
          <div>
            <label className={labelCls}>Job Role</label>
            <p className="text-sm text-muted">{profile.job_role || '—'}</p>
          </div>
          {/* Required hours + leave balances don't apply to admin users — they
              don't accrue leave. Employees still see both. */}
          {!isAdmin && (
            <div>
              <label className={labelCls}>Required Hours P/W</label>
              <p className="text-sm text-muted">{profile.weekly_hours_category} hours</p>
            </div>
          )}
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
          className={`${btnPrimary} w-full h-12`}
        >
          {saved ? 'Saved!' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      {/* Notifications */}
      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Push Reminders</p>
        </div>
        {isAdmin ? (
          <p className="text-sm text-muted">
            Get notified the moment an employee submits a leave request.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Get reminded to clock in and out at the times your admin sets:
            <br />
            <span className="text-ink">
              In: <strong>{fmtReminderTime(profile.clock_in_reminder)}</strong>
              {'   '}·{'   '}
              Out: <strong>{fmtReminderTime(profile.clock_out_reminder)}</strong>
            </span>
          </p>
        )}

        {permission === 'unsupported' ? (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Push notifications aren't supported on this device/browser. On iPhone, add the app to your home screen via Safari → Share → Add to Home Screen.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl bg-page px-4 py-3">
              <span className="text-xs font-medium text-ink">{isAdmin ? 'Mute Leave Notifications' : 'Mute All Reminders'}</span>
              <button type="button" onClick={toggleMute}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${muted ? 'bg-red-500' : 'bg-page border border-skyDeep/40'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${muted ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {!subscribed ? (
              <button
                type="button"
                onClick={handleEnablePush}
                disabled={pushBusy}
                style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
                className={`${btnPrimary} w-full h-11`}
              >
                {pushBusy ? 'Enabling…' : 'Enable Push Reminders'}
              </button>
            ) : (
              <button
                type="button" onClick={handleDisablePush} disabled={pushBusy}
                style={{ backgroundColor: '#e8e8e8', color: '#0352fb' }}
                className={`${btnSecondary} w-full h-11`}
              >
                {pushBusy ? 'Disabling…' : 'Disable Push Reminders'}
              </button>
            )}
            {pushErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{pushErr}</p>}
          </>
        )}
      </div>

      {/* Timesheet submission timeliness — on-time vs late counts. Employees
          only; admins don't submit their own timesheets for this metric. */}
      {!isAdmin && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Timesheet Submissions</p>
          <div className="flex gap-8 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-lg font-clock font-bold text-ink">{subStats.onTime}</span>
              <span className={onTimeFlagCls}>On-Time</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-clock font-bold text-ink">{subStats.late}</span>
              <span className={onTimeFlagCls}>Late</span>
            </div>
          </div>
        </div>
      )}

      {!isAdmin && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Leave Balances</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">Annual Leave</span><span className="font-semibold text-ink">{fmtHours(profile.annual_leave_balance)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Personal/Sick Leave</span><span className="font-semibold text-ink">{fmtHours(profile.personal_leave_balance)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Time in Lieu</span><span className="font-semibold text-ink">{fmtHours(profile.accrued_til_hours)}</span></div>
          </div>
        </div>
      )}
    </div>
  )
}
