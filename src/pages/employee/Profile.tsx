import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { btnPrimary, btnSecondary, inputCls, labelCls, fmtHours } from '../../lib/utils'
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

  useEffect(() => {
    if (!pushSupported()) { setPermission('unsupported'); return }
    setPermission(Notification.permission)
    getCurrentSubscription().then(s => setSubscribed(!!s))
  }, [])

  useEffect(() => {
    if (profile) {
      setMobile(profile.mobile_number ?? '')
      setMuted(!profile.notifications_enabled)
    }
  }, [profile])

  if (!profile) return null

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
          <label className={labelCls}>Job Role</label>
          <p className="text-sm text-muted">{profile.job_role || '—'}</p>
        </div>
        <div>
          <label className={labelCls}>Required Hours P/W</label>
          <p className="text-sm text-muted">{profile.weekly_hours_category} hours</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
        <div>
          <label className={labelCls}>Mobile Number</label>
          <input
            type="tel"
            value={mobile}
            onChange={e => setMobile(e.target.value)}
            className={inputCls}
            placeholder="04XX XXX XXX"
          />
        </div>
        <button type="submit" disabled={saving} className={`${btnPrimary} w-full h-12`}>
          {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
        </button>
      </form>

      {/* Notifications */}
      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Push Reminders</p>
        </div>
        <p className="text-sm text-muted">
          Get reminded to clock in and out at the times your admin sets:
          <br />
          <span className="text-ink">
            In: <strong>{fmtReminderTime(profile.clock_in_reminder)}</strong>
            {'   '}·{'   '}
            Out: <strong>{fmtReminderTime(profile.clock_out_reminder)}</strong>
          </span>
        </p>

        {permission === 'unsupported' ? (
          <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
            Push notifications aren't supported on this device/browser. On iPhone, add the app to your home screen via Safari → Share → Add to Home Screen.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-xl bg-page px-4 py-3">
              <span className="text-sm font-medium text-ink">Mute all reminders</span>
              <button type="button" onClick={toggleMute}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${muted ? 'bg-red-500' : 'bg-page border border-skyDeep/40'}`}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${muted ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {!subscribed ? (
              <button type="button" onClick={handleEnablePush} disabled={pushBusy} className={`${btnPrimary} w-full h-11`}>
                {pushBusy ? 'Enabling…' : 'Enable Push Reminders'}
              </button>
            ) : (
              <button
                type="button" onClick={handleDisablePush} disabled={pushBusy}
                style={{ backgroundColor: '#747474', color: '#FFFFFF' }}
                className="inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-50"
              >
                {pushBusy ? 'Disabling…' : 'Disable Push Reminders'}
              </button>
            )}
            {pushErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{pushErr}</p>}
          </>
        )}
      </div>

      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Leave Balances</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted">Annual Leave</span><span className="font-semibold">{fmtHours(profile.annual_leave_balance)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Personal/Sick Leave</span><span className="font-semibold">{fmtHours(profile.personal_leave_balance)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Time in Lieu</span><span className="font-semibold text-skyDeep">{fmtHours(profile.accrued_til_hours)}</span></div>
        </div>
      </div>
    </div>
  )
}
