import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, type TimeEntry, type Timesheet, type LeaveRequest } from '../../lib/supabase'
import { fmtTime, fmtHours, fmtWeekRangeLong } from '../../lib/utils'
import { format } from 'date-fns'

export default function Dashboard() {
  const nav = useNavigate()
  const [activeEntries, setActiveEntries]   = useState<TimeEntry[]>([])
  const [pendingTimesheets, setPendingTimesheets] = useState<Timesheet[]>([])
  const [pendingLeave, setPendingLeave]     = useState<LeaveRequest[]>([])
  const [loading, setLoading]               = useState(true)

  useEffect(() => {
    const load = async () => {
      const [{ data: active }, { data: tSheets }, { data: leave }] = await Promise.all([
        supabase.from('time_entries').select('*, profiles(full_name, job_role), job_addresses(address), stages(name)').eq('status', 'active').order('clock_in'),
        supabase.from('timesheets').select('*, profiles(full_name)').eq('status', 'submitted').order('week_start', { ascending: false }),
        supabase.from('leave_requests').select('*, profiles!leave_requests_employee_id_fkey(full_name)').eq('status', 'pending').order('created_at'),
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

  if (loading) return <div className="text-center py-16 text-muted">Loading…</div>

  // May 2026 design-system dashboard tile palette — light-to-deep sky ramp,
  // black text on every tile so values read crisply.
  const stats = [
    { label: 'On Site Now',          value: activeEntries.length,    bg: '#9ADBED', to: '#on-site-now' },
    { label: 'Timesheets to Review', value: pendingTimesheets.length, bg: '#5DC4E3', to: '/timesheets' },
    { label: 'Leave Requests',       value: pendingLeave.length,      bg: '#0096C7', to: '/leave' },
  ]

  const goTo = (to: string) => {
    if (to.startsWith('#')) {
      document.querySelector(to)?.scrollIntoView({ behavior: 'smooth' })
    } else {
      nav(to)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-muted">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
      </div>

      {/* Click-through stat tiles — brand-coloured backgrounds with dark accent text */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <button
            key={s.label}
            onClick={() => goTo(s.to)}
            style={{ backgroundColor: s.bg, color: '#000000' }}
            /* Hover affordance is movement + sky ring instead of shadow-md so
             * we stay inside the "no-shadow surface" rule. shadow-md is
             * reserved for functional depth (modals, sheets), not hover. */
            className="text-left p-3 sm:p-4 transition-transform hover:scale-[1.02] hover:ring-2 hover:ring-sky/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky overflow-hidden"
          >
            <p className="text-3xl sm:text-4xl font-clock font-bold tabular-nums">{s.value}</p>
            <p className="text-micro sm:text-micro font-semibold uppercase tracking-tight mt-1 whitespace-nowrap">{s.label}</p>
          </button>
        ))}
      </div>

      {/* Who's on site */}
      <div id="on-site-now" className="bg-surface rounded-2xl border border-page shadow-sm scroll-mt-20">
        <div className="px-5 py-4 border-b border-page flex items-center justify-between">
          <h2 className="font-semibold text-ink">On Site Now</h2>
          <button onClick={() => nav('/audit')} className="text-xs text-sky hover:underline">
            Location audit →
          </button>
        </div>
        {activeEntries.length === 0 ? (
          <p className="px-5 py-6 text-center text-muted">No One Clocked In</p>
        ) : (
          <div className="divide-y divide-page">
            {activeEntries.map(e => {
              const elapsed = Math.floor((Date.now() - new Date(e.clock_in).getTime()) / 3_600_000 * 10) / 10
              return (
                <div key={e.id} className="px-5 py-4 flex justify-between items-center">
                  <div>
                    <p className="text-sm font-semibold">{(e.profiles as { full_name: string })?.full_name}</p>
                    <p className="text-xs text-muted">
                      In at {fmtTime(e.clock_in)} · {(e.job_addresses as { address: string })?.address ?? '—'}
                    </p>
                    {(e.stages as { name: string })?.name && (
                      <p className="text-xs text-muted">{(e.stages as { name: string }).name}</p>
                    )}
                    {e.clock_in_lat && (
                      <a
                        href={`https://maps.google.com/?q=${e.clock_in_lat},${e.clock_in_lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-sky underline"
                        onClick={ev => ev.stopPropagation()}
                      >
                        View on map
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-clock normal-case text-sky tracking-wider tabular-nums">{fmtHours(elapsed)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending timesheets — each row links to TimesheetReview */}
      {pendingTimesheets.length > 0 && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm">
          <div className="px-5 py-4 border-b border-page flex items-center justify-between">
            <h2 className="font-semibold text-ink">Timesheets Awaiting Approval</h2>
            <button onClick={() => nav('/timesheets')} className="text-xs text-sky hover:underline">
              Review all →
            </button>
          </div>
          <div className="divide-y divide-page">
            {pendingTimesheets.map(ts => (
              <button
                key={ts.id}
                onClick={() => nav('/timesheets')}
                className="w-full px-5 py-4 flex justify-between items-center hover:bg-page transition-colors text-left"
              >
                <div>
                  <p className="text-sm font-semibold">{(ts.profiles as { full_name: string })?.full_name}</p>
                  <p className="text-xs text-muted">Week of {fmtWeekRangeLong(ts.week_start)}</p>
                </div>
                <p className="text-sm font-bold">{fmtHours(ts.total_hours ?? 0)}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Pending leave — each row links to LeaveManagement */}
      {pendingLeave.length > 0 && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm">
          <div className="px-5 py-4 border-b border-page flex items-center justify-between">
            <h2 className="font-semibold text-ink">Leave Requests Pending</h2>
            <button onClick={() => nav('/leave')} className="text-xs text-sky hover:underline">
              Review all →
            </button>
          </div>
          <div className="divide-y divide-page">
            {pendingLeave.map(lr => {
              // Normalise leave-type label: 'time_in_lieu' -> 'time in lieu', plus capitalize.
              const typeLabel = lr.leave_type.replace(/_/g, ' ')
              const start = lr.start_time
                ? `${lr.start_date} ${lr.start_time.slice(0, 5)}`
                : lr.start_date
              const end = lr.end_time
                ? `${lr.end_date} ${lr.end_time.slice(0, 5)}`
                : lr.end_date
              return (
                <button
                  key={lr.id}
                  onClick={() => nav('/leave')}
                  className="w-full px-5 py-4 hover:bg-page transition-colors text-left"
                >
                  <p className="text-sm font-semibold">{(lr.profiles as { full_name: string })?.full_name}</p>
                  <p className="text-xs text-muted capitalize">{typeLabel} · {start} → {end}</p>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
