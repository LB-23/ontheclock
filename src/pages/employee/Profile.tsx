import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { btnPrimary, inputCls, labelCls, fmtHours } from '../../lib/utils'

export default function EmployeeProfile() {
  const { profile, refresh } = useProfile()
  const [mobile, setMobile] = useState(profile?.mobile_number ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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
          <label className={labelCls}>Weekly Hours Target</label>
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

      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-3">Leave Balances</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted">Annual Leave</span><span className="font-semibold">{fmtHours(profile.annual_leave_balance)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Personal/Sick Leave</span><span className="font-semibold">{fmtHours(profile.personal_leave_balance)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Time In Lieu</span><span className="font-semibold text-orange-600">{fmtHours(profile.accrued_til_hours)}</span></div>
        </div>
      </div>
    </div>
  )
}
