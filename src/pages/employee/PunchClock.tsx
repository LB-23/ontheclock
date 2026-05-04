import { useEffect, useState, useRef } from 'react'
import Select from 'react-select'
import { format } from 'date-fns'
import { supabase, type JobAddress, type Stage, type TimeEntry } from '../../lib/supabase'
import { useProfile } from '../../hooks/useProfile'
import { getGPS, getWeekStart, calcHours, applyAutoBreak, btnPrimary } from '../../lib/utils'

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

  const handleClockOut = async () => {
    if (!activeEntry || !profile) return
    setLoading(true)
    const gps = await getGPS()
    const clockOut = new Date().toISOString()
    const raw = calcHours(activeEntry.clock_in, clockOut)
    const { total } = applyAutoBreak(raw)
    const isOvertime = total > profile.weekly_hours_category / 5

    await supabase.from('time_entries').update({
      clock_out:     clockOut,
      clock_out_lat: gps?.lat ?? null,
      clock_out_lng: gps?.lng ?? null,
      total_hours:   total,
      is_overtime:   isOvertime,
      status:        'completed',
    }).eq('id', activeEntry.id)

    setLoading(false)
    setActiveEntry(null)
    setSelectedJob(null)
    setSelectedStage(null)
    setGpsWarning(false)
  }

  const jobOptions = jobAddresses.map(j => ({ value: j.id, label: j.address }))
  const stageOptions = stages.map(s => ({ value: s.id, label: s.name }))

  const selectStyles = {
    control: (base: object) => ({
      ...base,
      borderRadius: '0.75rem',
      borderColor: '#E8E8E8',          // page
      backgroundColor: '#FAFAFA',       // surface
      padding: '2px 4px',
      boxShadow: 'none',
      '&:hover': { borderColor: '#1C9FDA' }, // sky
    }),
    option: (base: object, state: { isSelected: boolean; isFocused: boolean }) => ({
      ...base,
      backgroundColor: state.isSelected ? '#3B82F6' : state.isFocused ? '#E8E8E8' : '#FAFAFA',
      color: state.isSelected ? '#FFFFFF' : '#000000',
    }),
  }

  const isClockedIn = !!activeEntry

  return (
    <div className="max-w-md mx-auto space-y-6">
      {/* Clock display */}
      <div
        className={`rounded-2xl p-6 text-center shadow-md border ${
          isClockedIn
            ? 'text-white border-transparent'
            : 'bg-surface border-page'
        }`}
        style={isClockedIn ? { backgroundColor: '#737373' } : undefined}
      >
        {isClockedIn ? (
          <>
            <p className="text-sm font-medium opacity-90 mb-1">Clocked in at</p>
            <p className="text-3xl font-clock mb-1 tracking-wider">
              {format(new Date(activeEntry.clock_in), 'h:mm aaa')}
            </p>
            <p className="text-7xl font-clock my-3 tracking-wider tabular-nums">{elapsed}</p>
            <p className="text-sm opacity-90">
              {(activeEntry.job_addresses as JobAddress)?.address ?? '—'}
            </p>
            {(activeEntry.stages as Stage)?.name && (
              <p className="text-sm opacity-90">{(activeEntry.stages as Stage).name}</p>
            )}
          </>
        ) : (
          <>
            <p className="text-6xl font-clock text-ink tracking-wider tabular-nums">
              {format(new Date(), 'h:mm aaa')}
            </p>
            <p className="text-sm text-muted mt-2">
              {format(new Date(), 'EEEE, d MMMM yyyy')}
            </p>
          </>
        )}
      </div>

      {gpsWarning && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          ⚠️ Location unavailable — punched in without GPS. Enable location access for full tracking.
        </div>
      )}

      {/* Clock-in form */}
      {!isClockedIn && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-4">
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
            className={`${btnPrimary} w-full h-14 text-base`}
          >
            {loading ? 'Clocking in…' : '⏱ Clock In'}
          </button>
        </div>
      )}

      {/* Clock-out button */}
      {isClockedIn && (
        <button
          onClick={handleClockOut}
          disabled={loading}
          className="inline-flex items-center justify-center w-full h-14 text-base rounded-xl text-white font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-50"
          style={{ backgroundColor: '#FF3131' }}
        >
          {loading ? 'Clocking out…' : 'Clock Out'}
        </button>
      )}

      <p className="text-xs text-center text-muted">
        30-min paid lunch auto-included for shifts over 6 hours
      </p>
    </div>
  )
}
