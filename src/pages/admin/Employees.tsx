import { useEffect, useState } from 'react'
import { supabase, type Profile, type WeeklyHours, type AppRole } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { btnPrimary, btnSecondary, btnDanger, inputCls, labelCls, fmtHours } from '../../lib/utils'

type FormState = {
  full_name: string
  email: string
  password: string
  mobile_number: string
  job_role: string
  app_role: AppRole
  weekly_hours_category: WeeklyHours
  accrued_til_hours: number
  annual_leave_balance: number
  personal_leave_balance: number
  annual_accrual_per_week: number
  personal_accrual_per_week: number
  clock_in_reminder: string   // 'HH:mm' or ''
  clock_out_reminder: string
}

const BLANK: FormState = {
  full_name: '', email: '', password: '', mobile_number: '',
  job_role: '', app_role: 'employee', weekly_hours_category: 38,
  accrued_til_hours: 0, annual_leave_balance: 0, personal_leave_balance: 0,
  annual_accrual_per_week: 0, personal_accrual_per_week: 0,
  clock_in_reminder: '', clock_out_reminder: '',
}

export default function Employees() {
  const { profile: me } = useProfile()
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [form, setForm] = useState<FormState>(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // For viewing an individual employee profile
  const [viewing, setViewing] = useState<Profile | null>(null)

  const load = async () => {
    // admin_list_employees RPC joins auth.users.email so the admin always
    // sees and preserves the existing email when editing a profile.
    const { data: profs } = await supabase.rpc('admin_list_employees')
    setEmployees((profs as Profile[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const openAdd = () => { setEditing(null); setForm(BLANK); setError(''); setShowForm(true) }
  const openEdit = (p: Profile) => {
    setEditing(p)
    setForm({
      full_name: p.full_name ?? '',
      email: p.email ?? '',
      password: '',
      mobile_number: p.mobile_number ?? '',
      job_role: p.job_role ?? '',
      app_role: p.app_role ?? 'employee',
      weekly_hours_category: p.weekly_hours_category ?? 38,
      accrued_til_hours: p.accrued_til_hours ?? 0,
      annual_leave_balance: p.annual_leave_balance ?? 0,
      personal_leave_balance: p.personal_leave_balance ?? 0,
      annual_accrual_per_week:   p.annual_accrual_per_week   ?? 0,
      personal_accrual_per_week: p.personal_accrual_per_week ?? 0,
      clock_in_reminder:  p.clock_in_reminder  ? p.clock_in_reminder.slice(0, 5)  : '',
      clock_out_reminder: p.clock_out_reminder ? p.clock_out_reminder.slice(0, 5) : '',
    })
    setError('')
    setShowForm(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    const isAdmin = form.app_role === 'admin'

    if (!editing) {
      // Use admin_create_employee RPC — does NOT log out the current admin
      const { error: rpcErr } = await supabase.rpc('admin_create_employee', {
        emp_email:             form.email,
        emp_password:          form.password,
        emp_full_name:         form.full_name,
        emp_mobile:            form.mobile_number,
        emp_job_role:          form.job_role,
        emp_app_role:          form.app_role,
        emp_weekly_hours:      isAdmin ? 38 : form.weekly_hours_category,
        emp_annual_balance:    isAdmin ? 0  : form.annual_leave_balance,
        emp_personal_balance:  isAdmin ? 0  : form.personal_leave_balance,
        emp_til_hours:         isAdmin ? 0  : form.accrued_til_hours,
      })
      if (rpcErr) { setError(rpcErr.message); setSaving(false); return }
    } else {
      const updates: Record<string, unknown> = {
        full_name:             form.full_name,
        mobile_number:         form.mobile_number,
        job_role:              form.job_role,
        app_role:              form.app_role,
        clock_in_reminder:     form.clock_in_reminder  || null,
        clock_out_reminder:    form.clock_out_reminder || null,
      }
      if (!isAdmin) {
        updates.weekly_hours_category    = form.weekly_hours_category
        updates.accrued_til_hours        = form.accrued_til_hours
        updates.annual_leave_balance     = form.annual_leave_balance
        updates.personal_leave_balance   = form.personal_leave_balance
        updates.annual_accrual_per_week  = form.annual_accrual_per_week
        updates.personal_accrual_per_week = form.personal_accrual_per_week
      }
      const { error: updErr } = await supabase.from('profiles').update(updates).eq('id', editing.id)
      if (updErr) { setError(updErr.message); setSaving(false); return }

      // If email changed, update via RPC
      if (form.email && form.email !== editing.email) {
        const { error: emErr } = await supabase.rpc('admin_update_employee_email', {
          target_id: editing.id, new_email: form.email,
        })
        if (emErr) { setError(emErr.message); setSaving(false); return }
      }
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  const removeEmployee = async (p: Profile) => {
    if (p.id === me?.id) { alert('You cannot delete yourself.'); return }
    if (!confirm(`Permanently delete ${p.full_name}?\n\nThis removes their account and ALL their time entries, timesheets, leave requests and TIL ledger entries. This cannot be undone.`)) return
    const { error: delErr } = await supabase.rpc('admin_delete_employee', { target_id: p.id })
    if (delErr) { alert('Delete failed: ' + delErr.message); return }
    setViewing(null)
    load()
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  // Profile-detail dialog (opened by clicking a Team row)
  const profileDialog = viewing && (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4 py-6" onClick={() => setViewing(null)}>
      <div className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="font-semibold text-lg">{viewing.full_name}</p>
          <button onClick={() => setViewing(null)} className="text-muted hover:text-ink">✕</button>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Email</dt><dd className="text-ink">{viewing.email ?? '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Mobile</dt><dd className="text-ink">{viewing.mobile_number || '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Job Role</dt><dd className="text-ink">{viewing.job_role || '—'}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">App Role</dt><dd className="text-ink capitalize">{viewing.app_role}</dd></div>
          {viewing.app_role !== 'admin' && (
            <>
              <div className="flex justify-between"><dt className="text-muted">Required Hours P/W</dt><dd className="text-ink">{viewing.weekly_hours_category}h</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Annual Leave</dt><dd className="text-ink">{fmtHours(viewing.annual_leave_balance ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Personal/Sick</dt><dd className="text-ink">{fmtHours(viewing.personal_leave_balance ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Time In Lieu</dt><dd className="text-ink">{fmtHours(viewing.accrued_til_hours ?? 0)}</dd></div>
              <div className="flex justify-between border-t border-page pt-2 mt-2"><dt className="text-muted">Accrued Leave P/W – Annual</dt><dd className="text-ink font-clock tabular-nums">{Number(viewing.annual_accrual_per_week ?? 0).toFixed(4)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Accrued Leave P/W – Personal/Sick</dt><dd className="text-ink font-clock tabular-nums">{Number(viewing.personal_accrual_per_week ?? 0).toFixed(4)}</dd></div>
            </>
          )}
        </dl>
        <div className="flex gap-3 pt-2">
          <button onClick={() => { const v = viewing; setViewing(null); openEdit(v) }} className={`${btnPrimary} flex-1 h-11`}>✎ Edit</button>
          <button onClick={() => removeEmployee(viewing)} disabled={viewing.id === me?.id} className={`${btnDanger} flex-1 h-11`}>Delete</button>
        </div>
      </div>
    </div>
  )

  const isFormForAdmin = form.app_role === 'admin'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Team</h1>
        <button onClick={openAdd} className={btnPrimary}>+ Add Employee</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
          <p className="font-semibold">{editing ? 'Edit Employee' : 'New Employee'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Full Name</label><input value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputCls} required /></div>
            <div><label className={labelCls}>Job Role</label><input value={form.job_role} onChange={e => set('job_role', e.target.value)} className={inputCls} placeholder="Foreman" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} required /></div>
            {!editing && (
              <div><label className={labelCls}>Password</label><input type="password" value={form.password} onChange={e => set('password', e.target.value)} className={inputCls} required minLength={6} /></div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Mobile</label><input type="tel" value={form.mobile_number} onChange={e => set('mobile_number', e.target.value)} className={inputCls} /></div>
            <div>
              <label className={labelCls}>Role</label>
              <select value={form.app_role} onChange={e => set('app_role', e.target.value as AppRole)} className={inputCls}>
                <option value="employee">Employee</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          {!isFormForAdmin && (
            <>
              <div>
                <label className={labelCls}>Required Hours P/W</label>
                <select value={form.weekly_hours_category} onChange={e => set('weekly_hours_category', Number(e.target.value) as WeeklyHours)} className={inputCls}>
                  <option value={38}>38 hours</option>
                  <option value={40}>40 hours</option>
                  <option value={42}>42 hours</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={labelCls}>Annual Leave (hours)</label><input type="number" step="0.5" value={form.annual_leave_balance} onChange={e => set('annual_leave_balance', parseFloat(e.target.value) || 0)} className={inputCls} /></div>
                <div><label className={labelCls}>Personal Leave (hours)</label><input type="number" step="0.5" value={form.personal_leave_balance} onChange={e => set('personal_leave_balance', parseFloat(e.target.value) || 0)} className={inputCls} /></div>
                <div><label className={labelCls}>TIL (hours)</label><input type="number" step="0.5" value={form.accrued_til_hours} onChange={e => set('accrued_til_hours', parseFloat(e.target.value) || 0)} className={inputCls} /></div>
              </div>

              {/* Weekly accrual rates — added to the running balance every Friday */}
              <div className="border-t border-page pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Accrued Leave P/W (auto-added every Thursday)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Annual P/W (hours)</label>
                    <input type="number" step="0.0001" min="0" value={form.annual_accrual_per_week}
                           onChange={e => set('annual_accrual_per_week', parseFloat(e.target.value) || 0)}
                           className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Personal/Sick P/W (hours)</label>
                    <input type="number" step="0.0001" min="0" value={form.personal_accrual_per_week}
                           onChange={e => set('personal_accrual_per_week', parseFloat(e.target.value) || 0)}
                           className={inputCls} />
                  </div>
                </div>
                <p className="text-[11px] text-muted mt-2">e.g. 4 weeks annual leave a year on 38h/wk → 38 × 4 ÷ 52 ≈ 2.9231 hr/week</p>
              </div>
            </>
          )}

          {/* Reminder times — admins too can set their own */}
          {editing && (
            <div className="grid grid-cols-2 gap-3 border-t border-page pt-4">
              <div>
                <label className={labelCls}>Clock-in reminder</label>
                <input type="time" value={form.clock_in_reminder}
                       onChange={e => set('clock_in_reminder', e.target.value)} className={inputCls} />
                <p className="text-[11px] text-muted mt-1">Leave blank to disable</p>
              </div>
              <div>
                <label className={labelCls}>Clock-out reminder</label>
                <input type="time" value={form.clock_out_reminder}
                       onChange={e => set('clock_out_reminder', e.target.value)} className={inputCls} />
                <p className="text-[11px] text-muted mt-1">Leave blank to disable</p>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className={`${btnPrimary} h-11`}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} className={`${btnSecondary} h-11`}>Cancel</button>
          </div>
        </form>
      )}

      {loading && <p className="text-center text-muted">Loading…</p>}

      {/* Hide the team list while a profile dialog is open */}
      {!viewing && (() => {
        const admins    = employees.filter(e => e.app_role === 'admin')
        const employed  = employees.filter(e => e.app_role === 'employee')

        const renderList = (list: Profile[], emptyLabel: string) => (
          <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
            {list.length === 0 ? (
              <p className="px-5 py-6 text-center text-muted text-sm">{emptyLabel}</p>
            ) : list.map(emp => (
              <button
                key={emp.id}
                onClick={() => setViewing(emp)}
                className="w-full px-5 py-4 flex justify-between items-center hover:bg-page transition-colors text-left group"
              >
                <div>
                  <p className="text-sm font-semibold text-ink group-hover:text-sky">{emp.full_name || '—'}</p>
                  <p className="text-xs text-muted">
                    {emp.job_role || 'No role'}
                    {emp.app_role === 'admin'
                      ? ' · Admin'
                      : ` · ${emp.weekly_hours_category}h/wk`}
                  </p>
                </div>
                <span className="text-xs text-muted group-hover:text-sky">View →</span>
              </button>
            ))}
          </div>
        )

        return (
          <div className="space-y-6">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                Admins ({admins.length})
              </h2>
              {renderList(admins, 'No admin users')}
            </div>
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">
                Employees ({employed.length})
              </h2>
              {renderList(employed, 'No employees yet')}
            </div>
          </div>
        )
      })()}

      {profileDialog}
    </div>
  )
}
