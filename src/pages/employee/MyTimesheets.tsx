import { useEffect, useState } from 'react'
import { supabase, type TimeEntry, type Timesheet } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { fmtWeekRange, fmtDate, fmtTime, fmtHours, btnPrimary, btnSecondary } from '../../lib/utils'

export default function MyTimesheets() {
  const { profile } = useProfile()
  const [timesheets, setTimesheets] = useState<Timesheet[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [selected, setSelected] = useState<Timesheet | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) return
    supabase
      .from('timesheets')
      .select('*')
      .eq('employee_id', profile.id)
      .order('week_start', { ascending: false })
      .then(({ data }) => { setTimesheets(data ?? []); setLoading(false) })
  }, [profile])

  const loadEntries = async (ts: Timesheet) => {
    setSelected(ts)
    const { data } = await supabase
      .from('time_entries')
      .select('*, job_addresses(address), stages(name)')
      .eq('employee_id', profile!.id)
      .eq('week_start', ts.week_start)
      .order('clock_in')
    setEntries((data as TimeEntry[]) ?? [])
  }

  const submitTimesheet = async (ts: Timesheet) => {
    await supabase
      .from('timesheets')
      .upsert({ ...ts, status: 'submitted' }, { onConflict: 'id' })
    setTimesheets(prev => prev.map(t => t.id === ts.id ? { ...t, status: 'submitted' } : t))
    setSelected(prev => prev?.id === ts.id ? { ...prev, status: 'submitted' } : prev)
  }

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      draft:     'bg-gray-100 text-gray-600',
      submitted: 'bg-amber-100 text-amber-700',
      approved:  'bg-green-100 text-green-700',
      rejected:  'bg-red-100 text-red-600',
    }
    return `inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${map[status] ?? map.draft}`
  }

  if (loading) return <div className="text-center py-16 text-gray-400">Loading…</div>

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">My Timesheets</h1>

      {selected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <button onClick={() => setSelected(null)} className={btnSecondary}>← Back</button>
            <div>
              <p className="font-semibold">{fmtWeekRange(selected.week_start)}</p>
              <span className={statusBadge(selected.status)}>{selected.status}</span>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {entries.length === 0 && (
              <p className="p-6 text-center text-gray-400">No entries this week</p>
            )}
            {entries.map(e => (
              <div key={e.id} className="px-5 py-4">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{fmtDate(e.clock_in)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {fmtTime(e.clock_in)} → {e.clock_out ? fmtTime(e.clock_out) : '⏳ Active'}
                    </p>
                    {(e.job_addresses as { address: string })?.address && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        📍 {(e.job_addresses as { address: string }).address}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">
                      {e.total_hours ? fmtHours(e.total_hours) : '—'}
                    </p>
                    {e.is_overtime && (
                      <span className="text-xs text-orange-600 font-medium">OT</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-gray-500">Regular hours</span>
              <span className="font-semibold">{fmtHours(selected.regular_hours ?? 0)}</span>
            </div>
            <div className="flex justify-between text-sm mb-4">
              <span className="text-gray-500">Overtime hours</span>
              <span className="font-semibold text-orange-600">{fmtHours(selected.overtime_hours ?? 0)}</span>
            </div>
            <div className="flex justify-between font-bold border-t pt-3">
              <span>Total</span>
              <span>{fmtHours(selected.total_hours ?? 0)}</span>
            </div>
          </div>

          {selected.status === 'draft' && (
            <button onClick={() => submitTimesheet(selected)} className={`${btnPrimary} w-full h-12`}>
              Submit for Approval
            </button>
          )}
          {selected.admin_notes && (
            <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 text-sm text-blue-700">
              💬 Admin note: {selected.admin_notes}
            </div>
          )}
        </div>
      ) : (
        <>
          {timesheets.length === 0 && (
            <div className="text-center py-16 text-gray-400">No timesheets yet</div>
          )}
          <div className="space-y-3">
            {timesheets.map(ts => (
              <button
                key={ts.id}
                onClick={() => loadEntries(ts)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex justify-between items-center hover:border-[#1c9fda]/40 transition-colors"
              >
                <div>
                  <p className="text-sm font-semibold">{fmtWeekRange(ts.week_start)}</p>
                  <span className={statusBadge(ts.status)}>{ts.status}</span>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">{fmtHours(ts.total_hours ?? 0)}</p>
                  <p className="text-xs text-gray-400">→</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
