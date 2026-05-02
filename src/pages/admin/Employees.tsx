import { useEffect, useState } from 'react'
import { supabase, type Profile, type WeeklyHours, type AppRole } from '../../lib/supabase'
import { btnPrimary, btnSecondary, inputCls, labelCls } from '../../lib/utils'

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
}

const BLANK: FormState = {
  full_name: '', email: '', password: '', mobile_number: '',
  job_role: '', app_role: 'employee', weekly_hours_category: 38,
  accrued_til_hours: 0, annual_leave_balance: 0, personal_leave_balance: 0,
}

export default function Employees() {
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [form, setForm] = useState<FormState>(BLANK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = () =>
    supabase.from('profiles').select('*').order('full_name')
      .then(({ data }) => { setEmployees((data as Profile[]) ?? []); setLoading(false) })

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
    })
    setError('')
    setShowForm(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSaving(true)

    if (!editing) {
      // Use admin_create_employee RPC — does NOT log out the current admin
      const { error: rpcErr } = await supabase.rpc('admin_create_employee', {
        emp_email:             form.email,
        emp_password:          form.password,
        emp_full_name:         form.full_name,
        emp_mobile:            form.mobile_number,
        emp_job_role:          form.job_role,
        emp_app_role:          form.app_role,
        emp_weekly_hours:      form.weekly_hours_category,
        emp_annual_balance:    form.annual_leave_balance,
        emp_personal_balance:  form.personal_leave_balance,
        emp_til_hours:         form.accrued_til_hours,
      })
      if (rpcErr) {
        setError(rpcErr.message)
        setSaving(false)
        return
      }
    } else {
      const { error: updErr } = await supabase.from('profiles').update({
        full_name:             form.full_name,
        mobile_number:         form.mobile_number,
        job_role:              form.job_role,
        app_role:              form.app_role,
        weekly_hours_category: form.weekly_hours_category,
        accrued_til_hours:     form.accrued_til_hours,
        annual_leave_balance:  form.annual_leave_balance,
        personal_leave_balance: form.personal_leave_balance,
      }).eq('id', editing.id)
      if (updErr) {
        setError(updErr.message)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <button onClick={openAdd} className={btnPrimary}>+ Add Employee</button>
      </div>

      {showForm && (
        <form onSubmit={save} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
          <p className="font-semibold">{editing ? 'Edit Employee' : 'New Employee'}</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Full Name</label><input value={form.full_name} onChange={e => set('full_name', e.target.value)} className={inputCls} required /></div>
            <div><label className={labelCls}>Job Role</label><input value={form.job_role} onChange={e => set('job_role', e.target.value)} className={inputCls} placeholder="Foreman" /></div>
          </div>
          {!editing && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Email</label><input type="email" value={form.email} onChange={e => set('email', e.target.value)} className={inputCls} required /></div>
              <div><label className={labelCls}>Password</label><input type="password" value={form.password} onChange={e => set('password', e.target.value)} className={inputCls} required minLength={6} /></div>
            </div>
          )}
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
          <div>
            <label className={labelCls}>Weekly Hours</label>
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
          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className={`${btnPrimary} h-11`}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => setShowForm(false)} className={`${btnSecondary} h-11`}>Cancel</button>
          </div>
        </form>
      )}

      {loading && <p className="text-center text-gray-400">Loading…</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
        {employees.map(emp => (
          <div key={emp.id} className="px-5 py-4 flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-gray-900">{emp.full_name || '—'}</p>
              <p className="text-xs text-gray-500">{emp.job_role} · {emp.app_role} · {emp.weekly_hours_category}h/wk</p>
              <p className="text-xs text-gray-400">{emp.email}</p>
            </div>
            <button onClick={() => openEdit(emp)} className="text-xs text-[#1c9fda] hover:underline">Edit</button>
          </div>
        ))}
      </div>
    </div>
  )
}
