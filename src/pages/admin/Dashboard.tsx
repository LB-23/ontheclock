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

  const onSite = activeEntries.length
  const tsCount = pendingTimesheets.length
  const leaveCount = pendingLeave.length
  // Verb agrees with count — "1 person on site" / "7 people on site".
  // Zero state gets its own copy so it reads as an active "all clear" not
  // a placeholder "no data".
  const onSiteLabel =
    onSite === 0 ? 'Nobody on site' :
    onSite === 1 ? 'Person on site' :
    'People on site'

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-muted">{format(new Date(), 'EEEE d MMMM yyyy')}</p>
      </div>

      {/* ── Dashboard Hero ──────────────────────────────────────────────
       *  The three identical stat tiles previously here are collapsed into
       *  ONE typographic moment: a giant count of who's punched in right
       *  now, with the verb agreeing with the count. The other two
       *  metrics (timesheets, leave) drop to a secondary action row
       *  below, becoming tap targets that route directly to their pages.
       *  Bencium reduction filter: anything that can be removed without
       *  losing meaning, must be. Three tiles → one hero + one tag row.
       *  ─────────────────────────────────────────────────────────────── */}
      <header className="text-ink pt-2 pb-4">
        <p className="font-clock text-micro text-muted animate-rise">
          Right now
        </p>
        <p
          className="font-clock font-bold tabular-nums leading-none mt-2 animate-rise-delay-1"
          style={{ fontSize: 'clamp(6rem, 30vw, 14rem)', letterSpacing: '-0.06em' }}
          aria-label={`${onSite} ${onSiteLabel.toLowerCase()}`}
        >
          {onSite}
        </p>
        <p
          className="font-clock font-bold leading-[1.05] mt-2 animate-rise-delay-2"
          style={{ fontSize: 'clamp(1.5rem, 7vw, 3rem)', letterSpacing: '-0.02em' }}
        >
          {onSiteLabel}
        </p>

        {/* Secondary action row — two tag-style tap targets. When both
            queues are empty, surfaces an "all caught up" line of voice
            copy instead so the row never collapses to nothing. */}
        <div className="mt-6 flex flex-wrap items-center gap-3 animate-rise-delay-3">
          {tsCount > 0 && (
            <button
              onClick={() => nav('/timesheets')}
              className="inline-flex items-center gap-2 bg-surface border border-page px-3 py-2 text-sm hover:border-sky transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky"
            >
              <span className="font-clock font-bold tabular-nums text-ink">{tsCount}</span>
              <span className="text-muted">{tsCount === 1 ? 'Timesheet to review' : 'Timesheets to review'}</span>
              <span className="text-sky">→</span>
            </button>
          )}
          {leaveCount > 0 && (
            <button
              onClick={() => nav('/leave')}
              className="inline-flex items-center gap-2 bg-surface border border-page px-3 py-2 text-sm hover:border-sky transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky"
            >
              <span className="font-clock font-bold tabular-nums text-ink">{leaveCount}</span>
              <span className="text-muted">{leaveCount === 1 ? 'Leave request pending' : 'Leave requests pending'}</span>
              <span className="text-sky">→</span>
            </button>
          )}
          {tsCount === 0 && leaveCount === 0 && (
            <p className="text-sm text-muted italic">All caught up — nothing waiting for review.</p>
          )}
        </div>
      </header>

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
