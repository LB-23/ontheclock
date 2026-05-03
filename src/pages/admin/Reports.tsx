import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../../lib/supabase'
import { exportCSV, fmtHours, getWeekStart } from '../../lib/utils'
import { format, startOfISOWeek } from 'date-fns'

type ReportTab = 'employee' | 'job' | 'weekly'

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('employee')
  const [employees, setEmployees] = useState<Profile[]>([])
  const [jobs, setJobs] = useState<{ id: string; address: string }[]>([])
  const [filterEmp, setFilterEmp] = useState('')
  const [filterJob, setFilterJob] = useState('')
  const [filterWeek, setFilterWeek] = useState(getWeekStart())
  const [dateFrom, setDateFrom] = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'))
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').order('full_name').then(({ data }) => setEmployees((data as Profile[]) ?? []))
    supabase.from('job_addresses').select('id, address').eq('is_active', true).order('address').then(({ data }) => setJobs(data ?? []))
  }, [])

  const runReport = async () => {
    setLoading(true)
    if (tab === 'employee') {
      let q = supabase.from('time_entries').select('*, profiles(full_name), job_addresses(address), stages(name)')
        .gte('clock_in', dateFrom).lte('clock_in', dateTo + 'T23:59:59')
      if (filterEmp) q = q.eq('employee_id', filterEmp)
      const { data } = await q.order('clock_in')
      setRows((data ?? []).map((e: Record<string, unknown>) => ({
        Date:      e.clock_in ? format(new Date(e.clock_in as string), 'dd/MM/yyyy') : '',
        Employee:  (e.profiles as { full_name: string })?.full_name ?? '',
        Site:      (e.job_addresses as { address: string })?.address ?? '',
        Stage:     (e.stages as { name: string })?.name ?? '',
        ClockIn:   e.clock_in ? format(new Date(e.clock_in as string), 'HH:mm') : '',
        ClockOut:  e.clock_out ? format(new Date(e.clock_out as string), 'HH:mm') : '',
        Hours:     e.total_hours ?? '',
        Overtime:  e.is_overtime ? 'Yes' : 'No',
        Status:    e.status ?? '',
      })))
    } else if (tab === 'job') {
      let q = supabase.from('time_entries').select('*, profiles(full_name), job_addresses(address)')
        .gte('clock_in', dateFrom).lte('clock_in', dateTo + 'T23:59:59')
      if (filterJob) q = q.eq('job_address_id', filterJob)
      const { data } = await q.order('job_address_id')
      // Group by employee within job
      const grouped: Record<string, { address: string; employee: string; hours: number }> = {}
      for (const e of (data ?? []) as Record<string, unknown>[]) {
        const key = `${(e.job_addresses as { address: string })?.address}__${(e.profiles as { full_name: string })?.full_name}`
        if (!grouped[key]) grouped[key] = { address: (e.job_addresses as { address: string })?.address ?? '', employee: (e.profiles as { full_name: string })?.full_name ?? '', hours: 0 }
        grouped[key].hours += Number(e.total_hours ?? 0)
      }
      setRows(Object.values(grouped).map(r => ({ Site: r.address, Employee: r.employee, 'Total Hours': fmtHours(r.hours) })))
    } else {
      const weekStart = filterWeek || getWeekStart()
      const { data } = await supabase.from('timesheets').select('*, profiles(full_name, weekly_hours_category)')
        .eq('week_start', weekStart).order('profiles(full_name)')
      setRows((data ?? []).map((t: Record<string, unknown>) => ({
        Employee:       (t.profiles as Profile)?.full_name ?? '',
        WeekOf:         t.week_start ?? '',
        TotalHours:     fmtHours(Number(t.total_hours ?? 0)),
        RegularHours:   fmtHours(Number(t.regular_hours ?? 0)),
        OvertimeHours:  fmtHours(Number(t.overtime_hours ?? 0)),
        Status:         t.status ?? '',
      })))
    }
    setLoading(false)
  }

  const inputCls = 'block rounded-xl border border-page bg-surface px-3 py-2 text-sm focus:border-sky focus:outline-none'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Reports</h1>

      <div className="flex gap-2 flex-wrap">
        {([['employee','By Employee'],['job','By Job Site'],['weekly','Weekly All-Staff']] as const).map(([t, label]) => (
          <button key={t} onClick={() => { setTab(t); setRows([]) }}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === t ? 'bg-sky text-white' : 'bg-surface border border-page text-muted'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
        {(tab === 'employee' || tab === 'job') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}
        {tab === 'employee' && (
          <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className={inputCls}>
            <option value="">All employees</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        )}
        {tab === 'job' && (
          <select value={filterJob} onChange={e => setFilterJob(e.target.value)} className={inputCls}>
            <option value="">All sites</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.address}</option>)}
          </select>
        )}
        {tab === 'weekly' && (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">Week Starting (Monday)</label>
            <input type="date" value={filterWeek} onChange={e => setFilterWeek(e.target.value)} className={inputCls} />
          </div>
        )}
        <div className="flex gap-3">
          <button onClick={runReport} disabled={loading}
            className="inline-flex items-center justify-center rounded-xl bg-sky px-5 py-2.5 text-sm font-semibold text-white hover:bg-skyDeep disabled:opacity-50">
            {loading ? 'Loading…' : 'Run Report'}
          </button>
          {rows.length > 0 && (
            <button onClick={() => exportCSV(rows, `ontheclock-${tab}-report.csv`)}
              className="inline-flex items-center justify-center rounded-xl border border-page bg-surface px-5 py-2.5 text-sm font-semibold text-ink hover:bg-page">
              ↓ Export CSV
            </button>
          )}
        </div>
      </div>

      {rows.length > 0 && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page">
              <tr>
                {Object.keys(rows[0]).map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-page">
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-page">
                  {Object.values(r).map((v, j) => (
                    <td key={j} className="px-4 py-3 text-ink whitespace-nowrap">{String(v ?? '—')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">{rows.length} rows</p>
        </div>
      )}
    </div>
  )
}
