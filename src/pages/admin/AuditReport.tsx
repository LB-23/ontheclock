import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { supabase, type Profile } from '../../lib/supabase'
import { exportXLSX, btnPrimary, btnSecondary, inputCls, labelCls } from '../../lib/utils'

type AuditFlag = 'ok' | 'no_clock_in_gps' | 'no_clock_out_gps' | 'site_not_geocoded' | 'clock_in_far' | 'clock_out_far'

type AuditRow = {
  id: string
  employee_id: string
  employee_name: string
  clock_in: string
  clock_out: string | null
  status: string
  job_address: string | null
  job_lat: number | null
  job_lng: number | null
  clock_in_lat: number | null
  clock_in_lng: number | null
  clock_out_lat: number | null
  clock_out_lng: number | null
  clock_in_distance_m: number | null
  clock_out_distance_m: number | null
  audit_flag: AuditFlag
}

const flagLabel: Record<AuditFlag, { text: string; style: React.CSSProperties }> = {
  ok:                { text: 'OK',                       style: { backgroundColor: 'rgba(174,224,1,0.20)', color: '#AEE001' } },
  clock_in_far:      { text: 'Clock-in far from site',   style: { backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' } },
  clock_out_far:     { text: 'Clock-out far from site',  style: { backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' } },
  no_clock_in_gps:   { text: 'No clock-in GPS',          style: { backgroundColor: 'rgba(249,151,2,0.20)', color: '#F99702' } },
  no_clock_out_gps:  { text: 'No clock-out GPS',         style: { backgroundColor: 'rgba(249,151,2,0.20)', color: '#F99702' } },
  site_not_geocoded: { text: 'Site not geocoded',        style: { backgroundColor: '#E8E8E8',              color: '#666666' } },
}

export default function AuditReport() {
  const [rows, setRows]             = useState<AuditRow[]>([])
  const [employees, setEmployees]   = useState<Profile[]>([])
  const [filterEmp, setFilterEmp]   = useState('')
  const [filterFlag, setFilterFlag] = useState<'flagged' | 'all' | AuditFlag>('flagged')
  const [from, setFrom]             = useState(format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd'))
  const [to,   setTo]               = useState(format(new Date(), 'yyyy-MM-dd'))
  const [threshold, setThreshold]   = useState(200)
  const [loading, setLoading]       = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('id, full_name').order('full_name')
      .then(({ data }) => setEmployees((data as Profile[]) ?? []))
  }, [])

  const load = async () => {
    setLoading(true)
    let q = supabase.from('location_audit').select('*')
      .gte('clock_in', from)
      .lte('clock_in', to + 'T23:59:59')
      .order('clock_in', { ascending: false })

    if (filterEmp) q = q.eq('employee_id', filterEmp)

    const { data } = await q
    let result = (data as AuditRow[]) ?? []

    // Re-classify with the user-set threshold (DB view uses 200m default)
    result = result.map(r => {
      const inFar  = r.clock_in_distance_m  !== null && r.clock_in_distance_m  > threshold
      const outFar = r.clock_out_distance_m !== null && r.clock_out_distance_m > threshold
      let flag: AuditFlag = 'ok'
      if (r.clock_in_lat === null) flag = 'no_clock_in_gps'
      else if (r.job_lat === null) flag = 'site_not_geocoded'
      else if (inFar) flag = 'clock_in_far'
      else if (r.clock_out !== null && r.clock_out_lat === null) flag = 'no_clock_out_gps'
      else if (outFar) flag = 'clock_out_far'
      return { ...r, audit_flag: flag }
    })

    if (filterFlag === 'flagged') {
      result = result.filter(r => r.audit_flag !== 'ok')
    } else if (filterFlag !== 'all') {
      result = result.filter(r => r.audit_flag === filterFlag)
    }

    setRows(result)
    setLoading(false)
  }

  useEffect(() => { load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filterEmp, filterFlag, from, to, threshold])

  const downloadCSV = () => {
    exportXLSX(rows.map(r => ({
      Date:                format(new Date(r.clock_in), 'yyyy-MM-dd HH:mm'),
      Employee:            r.employee_name,
      JobSite:             r.job_address ?? '',
      ClockInDistanceM:    r.clock_in_distance_m ?? '',
      ClockOutDistanceM:   r.clock_out_distance_m ?? '',
      Flag:                flagLabel[r.audit_flag].text,
      ClockInGPS:          r.clock_in_lat ? `${r.clock_in_lat},${r.clock_in_lng}` : '',
      ClockOutGPS:         r.clock_out_lat ? `${r.clock_out_lat},${r.clock_out_lng}` : '',
      JobSiteGPS:          r.job_lat ? `${r.job_lat},${r.job_lng}` : '',
    })), `location-audit-${from}_to_${to}.xlsx`)
  }

  // Summary counts
  const total    = rows.length
  const flaggedRed   = rows.filter(r => r.audit_flag === 'clock_in_far' || r.audit_flag === 'clock_out_far').length
  const flaggedAmber = rows.filter(r => r.audit_flag === 'no_clock_in_gps' || r.audit_flag === 'no_clock_out_gps').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Location Audit</h1>
          <p className="text-sm text-muted mt-1">Flags clock-in/out events that happened away from the recorded job site.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 grid gap-3 md:grid-cols-5">
        <div>
          <label className={labelCls}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Employee</label>
          <select value={filterEmp} onChange={e => setFilterEmp(e.target.value)} className={inputCls}>
            <option value="">All</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Show</label>
          <select value={filterFlag} onChange={e => setFilterFlag(e.target.value as 'flagged' | 'all' | AuditFlag)} className={inputCls}>
            <option value="flagged">Flagged only</option>
            <option value="all">All entries</option>
            <option value="clock_in_far">Clock-in far</option>
            <option value="clock_out_far">Clock-out far</option>
            <option value="no_clock_in_gps">No clock-in GPS</option>
            <option value="no_clock_out_gps">No clock-out GPS</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Distance threshold (m)</label>
          <input type="number" min={50} max={5000} step={50} value={threshold}
                 onChange={e => setThreshold(Number(e.target.value))} className={inputCls} />
        </div>
      </div>

      {/* Summary — colour-coded by severity (all backgrounds @ 10% transparency) */}
      <div className="grid grid-cols-3 gap-3">
        <div style={{ backgroundColor: 'rgba(174,224,1,0.10)', color: '#AEE001' }} className="rounded-2xl p-4">
          <p className="text-4xl font-clock font-bold tabular-nums">{total}</p>
          <p className="text-[11px] mt-1 font-semibold uppercase tracking-wide opacity-90">Entries in range</p>
        </div>
        <div style={{ backgroundColor: 'rgba(255,40,40,0.10)', color: '#FF2828' }} className="rounded-2xl p-4">
          <p className="text-4xl font-clock font-bold tabular-nums">{flaggedRed}</p>
          <p className="text-[11px] mt-1 font-semibold uppercase tracking-wide opacity-90">Off-site</p>
        </div>
        <div style={{ backgroundColor: 'rgba(249,151,2,0.10)', color: '#F99702' }} className="rounded-2xl p-4">
          <p className="text-4xl font-clock font-bold tabular-nums">{flaggedAmber}</p>
          <p className="text-[11px] mt-1 font-semibold uppercase tracking-wide opacity-90">Missing GPS</p>
        </div>
      </div>

      <div className="flex justify-end">
        {rows.length > 0 && (
          <button onClick={downloadCSV} className={btnSecondary}>↓ Export Excel</button>
        )}
      </div>

      {/* Results table */}
      {loading ? (
        <p className="text-center text-muted py-10">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-10 text-center text-muted">
          🎉 No flagged entries in this range. Everyone clocked on/off where they should.
        </div>
      ) : (
        <div className="bg-surface rounded-2xl border border-page shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-page">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Employee</th>
                <th className="px-4 py-3">Job Site</th>
                <th className="px-4 py-3 text-right">Clock-In</th>
                <th className="px-4 py-3 text-right">Clock-Out</th>
                <th className="px-4 py-3">Flag</th>
                <th className="px-4 py-3">Map</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-page">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-page">
                  <td className="px-4 py-3 text-ink whitespace-nowrap">{format(new Date(r.clock_in), 'd MMM HH:mm')}</td>
                  <td className="px-4 py-3 font-medium text-ink">{r.employee_name}</td>
                  <td className="px-4 py-3 text-ink max-w-xs truncate">{r.job_address ?? '—'}</td>
                  <td className={`px-4 py-3 text-right font-mono ${r.clock_in_distance_m && r.clock_in_distance_m > threshold ? 'text-red-600 font-semibold' : 'text-ink'}`}>
                    {r.clock_in_distance_m !== null ? `${r.clock_in_distance_m}m` : '—'}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono ${r.clock_out_distance_m && r.clock_out_distance_m > threshold ? 'text-red-600 font-semibold' : 'text-ink'}`}>
                    {r.clock_out_distance_m !== null ? `${r.clock_out_distance_m}m` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
                          style={flagLabel[r.audit_flag].style}>
                      {flagLabel[r.audit_flag].text}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs space-x-2">
                    {r.clock_in_lat && r.job_lat && (
                      <a target="_blank" rel="noopener noreferrer"
                         href={`https://www.google.com/maps/dir/${r.clock_in_lat},${r.clock_in_lng}/${r.job_lat},${r.job_lng}`}
                         className="text-sky hover:underline">In ↔ Site</a>
                    )}
                    {r.clock_out_lat && r.job_lat && (
                      <a target="_blank" rel="noopener noreferrer"
                         href={`https://www.google.com/maps/dir/${r.clock_out_lat},${r.clock_out_lng}/${r.job_lat},${r.job_lng}`}
                         className="text-sky hover:underline">Out ↔ Site</a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-3 text-xs text-muted">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</p>
        </div>
      )}
    </div>
  )
}
