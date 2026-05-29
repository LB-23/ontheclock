import { useEffect, useState, useRef } from 'react'
import Select from 'react-select'
import { format } from 'date-fns'
import { supabase, type JobAddress, type Stage, type TimeEntry } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { getGPS, getWeekStart, calcHours, btnPrimary, btnSecondary, inputCls, labelCls } from '../../lib/utils'

export default function PunchClock() {
  const { profile } = useProfile()
  const [jobAddresses, setJobAddresses] = useState<JobAddress[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null)
  const [selectedJob, setSelectedJob] = useState<{ value: string; label: string } | null>(null)
  const [selectedStage, setSelectedStage] = useState<{ value: string; label: string } | null>(null)
  const [elapsed, setElapsed] = useState('')
  const [loading, setLoading] = useState(false)
  const [gpsWarning, setGpsWarning] = useState(false)
  const [showOutDialog, setShowOutDialog] = useState(false)
  const [outNotes, setOutNotes] = useState('')
  const [outErr, setOutErr] = useState('')
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load job addresses + stages
  useEffect(() => {
    supabase.from('job_addresses').select('*').eq('is_active', true).order('address')
      .then(({ data }) => setJobAddresses(data ?? []))
    supabase.from('stages').select('*').eq('is_active', true).order('name')
      .then(({ data }) => setStages(data ?? []))
  }, [])

  // Check if already clocked in
  useEffect(() => {
    if (!profile) return
    supabase
      .from('time_entries')
      .select('*, job_addresses(address), stages(name)')
      .eq('employee_id', profile.id)
      .eq('status', 'active')
      .maybeSingle()
      .then(({ data }) => {
        if (data) setActiveEntry(data as TimeEntry)
      })
  }, [profile])

  // Live elapsed timer
  useEffect(() => {
    if (!activeEntry) { setElapsed(''); return }
    const tick = () => {
      const ms = Date.now() - new Date(activeEntry.clock_in).getTime()
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      const s = Math.floor((ms % 60_000) / 1_000)
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    tick()
    timerRef.current = setInterval(tick, 1_000)
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [activeEntry])

  const handleClockIn = async () => {
    if (!profile || !selectedJob) return
    setLoading(true)
    const gps = await getGPS()
    if (!gps) setGpsWarning(true)

    const { data, error } = await supabase.from('time_entries').insert({
      employee_id:    profile.id,
      clock_in:       new Date().toISOString(),
      job_address_id: selectedJob.value,
      stage_id:       selectedStage?.value ?? null,
      clock_in_lat:   gps?.lat ?? null,
      clock_in_lng:   gps?.lng ?? null,
      status:         'active',
      week_start:     getWeekStart(),
    }).select('*, job_addresses(address), stages(name)').single()

    setLoading(false)
    if (!error && data) setActiveEntry(data as TimeEntry)
  }

  const openClockOut = () => {
    setOutNotes('')
    setOutErr('')
    setShowOutDialog(true)
  }

  const handleClockOut = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeEntry || !profile) return
    if (!outNotes.trim()) {
      setOutErr('Please add notes describing the work you did this shift.')
      return
    }
    setLoading(true)
    const gps = await getGPS()
    const clockOut = new Date().toISOString()
    // Auto-lunch deduction removed per brand directive — total_hours is now
    // the raw clock-in → clock-out duration, no break subtraction.
    const total = calcHours(activeEntry.clock_in, clockOut)
    const isOvertime = total > profile.weekly_hours_category / 5

    await supabase.from('time_entries').update({
      clock_out:     clockOut,
      clock_out_lat: gps?.lat ?? null,
      clock_out_lng: gps?.lng ?? null,
      total_hours:   total,
      is_overtime:   isOvertime,
      status:        'completed',
      notes:         outNotes.trim(),
    }).eq('id', activeEntry.id)

    setLoading(false)
    setShowOutDialog(false)
    setActiveEntry(null)
    setSelectedJob(null)
    setSelectedStage(null)
    setGpsWarning(false)
    setOutNotes('')
  }

  const jobOptions = jobAddresses.map(j => ({ value: j.id, label: j.address }))
  const stageOptions = stages.map(s => ({ value: s.id, label: s.name }))

  // Brought in-line with the squared design system + brand palette:
  //   • borderRadius: 0  (was 0.75rem — out-of-system)
  //   • borderWidth:  2  (matches inputCls 2px border)
  //   • selected option bg: #116DFF action (was #3B82F6 — pre-refresh token).
  //     White-on-#116DFF measures ~5.5:1 — passes WCAG AA.
  const selectStyles = {
    control: (base: object) => ({
      ...base,
      borderRadius: 0,
      borderWidth: 2,
      borderColor: '#E8E8E8',
      backgroundColor: '#FAFAFA',
      padding: '2px 4px',
      boxShadow: 'none',
      '&:hover': { borderColor: '#1C9FDA' },
    }),
    option: (base: object, state: { isSelected: boolean; isFocused: boolean }) => ({
      ...base,
      backgroundColor: state.isSelected ? '#116DFF' : state.isFocused ? '#E8E8E8' : '#FAFAFA',
      color: state.isSelected ? '#FFFFFF' : '#000000',
    }),
  }

  const isClockedIn = !!activeEntry

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* ── PunchClock Hero ──────────────────────────────────────────────
       *  The live clock IS the page — no card chrome, no shadow, no
       *  centred tile. Editorial scale + tracked-tight typography so the
       *  time numeral reads from across a job site. Address breaks into
       *  two lines on the comma for impact. Staggered fade/rise on first
       *  paint (respects prefers-reduced-motion via the global reset).
       *  ──────────────────────────────────────────────────────────────── */}
      <header className="text-ink pt-2 pb-4">
        {isClockedIn ? (
          <>
            <p className="font-clock text-micro text-muted animate-rise">
              Clocked in at {format(new Date(activeEntry.clock_in), 'h:mm aaa')}
            </p>
            <p
              className="font-clock font-bold tabular-nums leading-none mt-2 animate-rise-delay-1"
              style={{ fontSize: 'clamp(4.5rem, 22vw, 11rem)', letterSpacing: '-0.04em' }}
              aria-live="polite"
              aria-label={`Clocked in for ${elapsed}`}
            >
              {elapsed || '00:00:00'}
            </p>
            <div className="mt-6 animate-rise-delay-2">
              {(() => {
                const full = (activeEntry.job_addresses as JobAddress)?.address ?? '—'
                /* "18 Alfred St, Prahran VIC" → ["18 Alfred St", "Prahran VIC"]
                   so the address reads in two editorial lines instead of one
                   crammed row. Fallback to single line if no comma present. */
                const parts = full.split(/,\s*/)
                const [street, ...rest] = parts
                const tail = rest.join(', ')
                return (
                  <>
                    <p
                      className="font-clock font-bold leading-[1.05]"
                      style={{ fontSize: 'clamp(1.375rem, 6vw, 2.5rem)', letterSpacing: '-0.02em' }}
                    >
                      {street}
                    </p>
                    {tail && (
                      <p
                        className="font-clock font-bold leading-[1.05] text-muted"
                        style={{ fontSize: 'clamp(1.375rem, 6vw, 2.5rem)', letterSpacing: '-0.02em' }}
                      >
                        {tail}
                      </p>
                    )}
                  </>
                )
              })()}
              {(activeEntry.stages as Stage)?.name && (
                <p className="text-tag font-semibold uppercase text-muted mt-3" style={{ letterSpacing: '0.2em' }}>
                  {(activeEntry.stages as Stage).name}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="font-clock text-micro text-muted animate-rise">
              Ready to Clock-In
            </p>
            <p
              className="font-clock font-bold tabular-nums leading-none mt-2 animate-rise-delay-1"
              style={{ fontSize: 'clamp(4.5rem, 22vw, 11rem)', letterSpacing: '-0.04em' }}
            >
              {format(new Date(), 'h:mm')}
              <span className="text-muted">{format(new Date(), ' aaa')}</span>
            </p>
            <div className="mt-6 animate-rise-delay-2">
              <p
                className="font-clock font-bold leading-[1.05]"
                style={{ fontSize: 'clamp(1.375rem, 6vw, 2.5rem)', letterSpacing: '-0.02em' }}
              >
                {format(new Date(), 'EEEE')}
              </p>
              <p
                className="font-clock font-bold leading-[1.05] text-muted"
                style={{ fontSize: 'clamp(1.375rem, 6vw, 2.5rem)', letterSpacing: '-0.02em' }}
              >
                {format(new Date(), 'd MMMM yyyy')}
              </p>
            </div>
          </>
        )}
      </header>

      {gpsWarning && (
        /* GPS warning — amber palette per the design system. Emoji removed
         * (renders inconsistently across iOS/Android and breaks the single-
         * typeface brand voice); the bold lead-in carries the severity. */
        <div className="bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          <strong>Location unavailable —</strong> punched in without GPS. Enable location access for full tracking.
        </div>
      )}

      {/* Clock-in form — surface card. rounded/shadow utilities removed (they
          collapse to 0/none via the global override and were misleading in
          source). Sits below the hero so the time numeral leads the page. */}
      {!isClockedIn && (
        <div className="bg-surface border border-page p-5 space-y-4 animate-rise-delay-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">
              Job Site *
            </label>
            <Select
              options={jobOptions}
              value={selectedJob}
              onChange={opt => setSelectedJob(opt)}
              placeholder="Search job site…"
              isClearable
              styles={selectStyles}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">
              Stage / Task
            </label>
            <Select
              options={stageOptions}
              value={selectedStage}
              onChange={opt => setSelectedStage(opt)}
              placeholder="Select stage…"
              isClearable
              styles={selectStyles}
            />
          </div>
          <button
            onClick={handleClockIn}
            disabled={!selectedJob || loading}
            style={{ backgroundColor: '#D7E363', color: '#141414' }}
            className={`${btnPrimary} w-full h-14 text-base`}
          >
            {loading ? 'Clocking In…' : 'Clock-In'}
          </button>
        </div>
      )}

      {/* Clock-out button */}
      {isClockedIn && (
        <button
          onClick={openClockOut}
          disabled={loading}
          className="inline-flex items-center justify-center w-full h-14 text-base font-semibold active:scale-95 transition-all disabled:opacity-50"
          style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
        >
          Clock-Out
        </button>
      )}

      {/* Clock-out notes dialog (notes are required) */}
      {showOutDialog && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 px-4 py-6">
          <form onSubmit={handleClockOut}
                className="bg-surface rounded-2xl shadow-lg w-full max-w-md p-5 space-y-4">
            <div>
              <h2 className="font-semibold text-ink">Add notes for this shift</h2>
              <p className="text-xs text-muted mt-0.5">Required — describe the work you completed today.</p>
            </div>

            <div>
              <label className={labelCls}>Shift notes <span className="text-red-500">*</span></label>
              <textarea
                value={outNotes}
                onChange={e => setOutNotes(e.target.value)}
                className={`${inputCls} resize-none`}
                rows={4}
                autoFocus
                required
                minLength={3}
                placeholder="e.g. Framed first floor walls, sealed wet area, cleaned site"
              />
            </div>

            {outErr && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{outErr}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowOutDialog(false)}
                disabled={loading}
                style={{ backgroundColor: '#A4A3A3', color: '#FAFAFA' }}
                className={`${btnSecondary} flex-1 h-12`}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !outNotes.trim()}
                style={{ backgroundColor: '#737373', color: '#FAFAFA' }}
                className="inline-flex items-center justify-center flex-1 h-12 font-semibold active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? 'Clocking Out…' : 'Confirm Clock-Out'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
