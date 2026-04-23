import { useEffect, useState } from 'react'
import { supabase, type TimeEntry, type Timesheet, type LeaveRequest } from '../../lib/supabase'
import { fmtTime, fmtHours } from '../../lib/utils'
import { format } from 'date-fns'

export default function Dashboard() {
  const [activeEntries, setActiveEntries] = useState<TimeEntry[]>([])
  const [pendingTimesheets, setPendingTimesheets] = useState<Timesheet[]>([])
  const [pendingLeave, setPendingLeave] = useState<LeaveRequest[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      const today = format(new Date(), 'yyyy-MM-dd')
      const [{ data: active }, { data: tSheets }, { data: leave }] = await Promise.all([
        supabase.from('time_entries').select('*, profiles(full_name, job_role), job_addresses(address), stages(name)').eq('status', 'active').order('clock_in'),
        supabase.from('timesheets').select('*, profiles(full_name)').eq('status', 'submitted').order('week_start', { ascending: false }),
        supabase.from('leave_requests').select('*, profiles(full_name)').eq('status', 'pending').order('created_at'),
      ])
      setActiveEntries((active as TimeEntry[]) ?? [])
      setPendingTimesheets((tSheets as Timesheet[]) ?? [])
      setPendingLeave((leave as LeaveRequest[]) ?? [])
      setLoading(false)
    }
    load()
    const interval = setInterval(load, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="text-center py-16 text-gray-400">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'On Site Now',          value: activeEntries.length,    color: 'bg-[#1c9fda] text-white' },
          { label: 'Timesheets to Review', value: pendingTimesheets.length, color: 'bg-amber-50 text-amber-700' },
          { label: 'Leave Requests',       value: pendingLeave.length,      color: 'bg-purple-50 text-purple-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.color}`}>
            <p className="text-3xl font-bold">{s.value}</p>
            <p className="text-xs font-medium mt-1 opacity-80">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Who's on site */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-50">
          <h2 className="font-semibold text-gray-900">🟢 On Site Now</h2>
        </div>
        {activeEntries.length === 0 ? (
          <p className="px-5 py-6 text-center text-gray-400">No one clocked in</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {activeEntries.map(e => {
              const elapsed = Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 3_600_000 * 10) / 10
              return (
                <div key={e.id} className="px-5 py-4 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-semibold">{(e.profiles as { full_name: string })?.full_name}</p>
                    <p className="text-xs text-gray-500">
                      In at {fmtTime(e.clock_in)} · {(e.job_addresses as { address: string })?.address ?? '—'}
                    </p>
                    {(e.stages as { name: string })?.name && (
                      <p className="text-xs text-gray-400">🔧 {(e.stages as { name: string }).name}</p>
                    )}
                    {e.clock_in_lat && (
                      <a
                        href={`https://maps.google.com/?q=${e.clock_in_lat},${e.clock_in_lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#1c9fda] underline"
                      >
                        📍 View on map
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#1c9fda]">{fmtHours(elapsed)}</p>
                    <p className="text-xs text-gray-400">elapsed</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending timesheets */}
      {pendingTimesheets.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900">📋 Timesheets Awaiting Approval</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingTimesheets.map(ts => (
              <div key={ts.id} className="px-5 py-4 flex justify-between items-center">
                <div>
                  <p className="text-sm font-semibold">{(ts.profiles as { full_name: string })?.full_name}</p>
                  <p className="text-xs text-gray-500">Week of {ts.week_start}</p>
                </div>
                <p className="text-sm font-bold">{fmtHours(ts.total_hours ?? 0)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pending leave */}
      {pendingLeave.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900">🌴 Leave Requests Pending</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {pendingLeave.map(lr => (
              <div key={lr.id} className="px-5 py-4">
                <p className="text-sm font-semibold">{(lr.profiles as { full_name: string })?.full_name}</p>
                <p className="text-xs text-gray-500">{lr.leave_type} · {lr.start_date} → {lr.end_date}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
