import { useEffect, useState } from 'react'
import { supabase, type JobAddress } from '../../lib/supabase'
import { btnPrimary, btnSecondary, inputCls, labelCls, fmtHours } from '../../lib/utils'
import { geocodeAddress } from '../../lib/geocode'
import Skeleton from '../../components/Skeleton'
import { useEscapeKey } from '../../hooks/useEscapeKey'

/** JobAddress + the lat/lng/geocoded_at columns the audit view depends on,
 *  plus the client/job-card fields. */
type JobAddressGeo = JobAddress & {
  lat:                number | null
  lng:                number | null
  geocoded_at:        string | null
  client_name:        string | null
  client_number:      string | null
  client_email:       string | null
  total_hours:        number | null
  total_hours_manual: boolean | null
}

export default function JobAddresses() {
  const [addresses, setAddresses] = useState<JobAddressGeo[]>([])
  const [loading, setLoading] = useState(true)
  const [newAddress, setNewAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState('')
  const [search, setSearch] = useState('')
  const [backfillBusy, setBackfillBusy] = useState(false)
  const [backfillMsg, setBackfillMsg] = useState('')

  // Job-card modal — opened by clicking a site row.
  const [openJob, setOpenJob] = useState<JobAddressGeo | null>(null)
  const [jobForm, setJobForm] = useState({ client_name: '', client_number: '', client_email: '', total_hours: '', manual: false })
  const [jobBusy, setJobBusy] = useState(false)
  useEscapeKey(!!openJob, () => setOpenJob(null))

  const openJobCard = (a: JobAddressGeo) => {
    setOpenJob(a)
    setJobForm({
      client_name:   a.client_name   ?? '',
      client_number: a.client_number ?? '',
      client_email:  a.client_email  ?? '',
      total_hours:   String(a.total_hours ?? 0),
      manual:        !!a.total_hours_manual,
    })
  }

  const saveJobCard = async () => {
    if (!openJob) return
    setJobBusy(true)
    const patch: Record<string, unknown> = {
      client_name:   jobForm.client_name.trim()   || null,
      client_number: jobForm.client_number.trim() || null,
      client_email:  jobForm.client_email.trim()  || null,
      total_hours_manual: jobForm.manual,
    }
    // Only persist a hand-entered total when the admin is overriding; otherwise
    // the total stays auto-maintained by the approval trigger.
    if (jobForm.manual) patch.total_hours = parseFloat(jobForm.total_hours) || 0
    const { error } = await supabase.from('job_addresses').update(patch).eq('id', openJob.id)
    // Switching back to auto: recompute the total now from approved entries.
    if (!error && !jobForm.manual) await supabase.rpc('recompute_job_total_hours', { job_id: openJob.id })
    setJobBusy(false)
    if (error) { alert(`Could not save: ${error.message}`); return }
    setOpenJob(null)
    load()
  }

  const load = () =>
    supabase.from('job_addresses').select('*').order('address')
      .then(({ data }) => { setAddresses((data as JobAddressGeo[]) ?? []); setLoading(false) })

  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = newAddress.trim()
    if (!q) return
    setAdding(true); setAddMsg('')

    // Geocode BEFORE insert so the row lands with coordinates already populated
    // and the audit feature works on the first clock-in. If geocoding fails we
    // still insert (lat/lng stay null) and surface a heads-up so admins know
    // the audit page will tag it "site not geocoded" until backfilled.
    const coords = await geocodeAddress(q)
    const { error } = await supabase.from('job_addresses').insert({
      address: q,
      is_active: true,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      geocoded_at: coords ? new Date().toISOString() : null,
    })
    setAdding(false)
    if (error) { setAddMsg(`Could not add: ${error.message}`); return }
    setNewAddress('')
    setAddMsg(coords
      ? `Added with GPS (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`
      : 'Added, but the address could not be auto-geocoded — try "Backfill GPS" or refine the address.')
    load()
  }

  /** Backfill GPS for any active row missing lat/lng. Rate-limited to
   *  1 request/second to respect Nominatim's fair-use policy. */
  const backfillMissing = async () => {
    const missing = addresses.filter(a => a.is_active && (a.lat == null || a.lng == null))
    if (!missing.length) { setBackfillMsg('No addresses missing GPS — all caught up.'); return }
    setBackfillBusy(true); setBackfillMsg(`Geocoding ${missing.length}…`)
    let okCount = 0, failCount = 0
    for (const a of missing) {
      const coords = await geocodeAddress(a.address)
      if (coords) {
        const { error } = await supabase.from('job_addresses').update({
          lat: coords.lat, lng: coords.lng, geocoded_at: new Date().toISOString(),
        }).eq('id', a.id)
        if (error) failCount++; else okCount++
      } else {
        failCount++
      }
      // Throttle to respect Nominatim's 1 req/sec policy
      await new Promise(r => setTimeout(r, 1100))
      setBackfillMsg(`Geocoding ${missing.length}… ${okCount + failCount}/${missing.length}`)
    }
    setBackfillBusy(false)
    setBackfillMsg(`Done. ${okCount} updated, ${failCount} unresolved.`)
    load()
  }

  const toggle = async (addr: JobAddressGeo) => {
    await supabase.from('job_addresses').update({ is_active: !addr.is_active }).eq('id', addr.id)
    setAddresses(prev => prev.map(a => a.id === addr.id ? { ...a, is_active: !a.is_active } : a))
  }

  const filtered = addresses.filter(a => a.address.toLowerCase().includes(search.toLowerCase()))
  const active   = filtered.filter(a =>  a.is_active)
  const inactive = filtered.filter(a => !a.is_active)
  const missingCount = addresses.filter(a => a.is_active && (a.lat == null || a.lng == null)).length

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Job Sites</h1>

      {/* Add new */}
      <form onSubmit={add} className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-semibold text-ink">Add New Job Site</h2>
        <div>
          <label className={labelCls}>Address</label>
          <input
            type="text"
            value={newAddress}
            onChange={e => setNewAddress(e.target.value)}
            className={inputCls}
            placeholder="e.g. 12 Sample St, Suburb VIC"
            required
          />
        </div>
        <button type="submit" disabled={adding} className={`${btnPrimary} h-11`}>
          {adding ? 'Geocoding & adding…' : '+ Add Site'}
        </button>
        {addMsg && <p className="text-xs text-muted">{addMsg}</p>}
      </form>

      {/* GPS backfill — visible only when some active rows lack coordinates */}
      {missingCount > 0 && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">{missingCount} site{missingCount === 1 ? '' : 's'} missing GPS</h2>
              <p className="text-xs text-muted">These won't appear correctly in the Location Audit until geocoded.</p>
            </div>
            <button onClick={backfillMissing} disabled={backfillBusy} className={`${btnSecondary} h-10 shrink-0`}>
              {backfillBusy ? 'Working…' : 'Backfill GPS'}
            </button>
          </div>
          {backfillMsg && <p className="text-xs text-muted">{backfillMsg}</p>}
        </div>
      )}

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className={inputCls}
        style={{ fontSize: '12px' }}
        placeholder="search address…"
      />

      {loading && <Skeleton count={6} />}

      {/* Active */}
      <div className="bg-surface rounded-2xl border border-page shadow-sm">
        <div className="px-5 py-3 border-b border-page">
          <h2 className="text-sm font-semibold text-ink">Active ({active.length})</h2>
        </div>
        <div className="divide-y divide-page max-h-[800px] overflow-y-auto">
          {active.map(a => (
            <div key={a.id} className="px-5 py-3 flex justify-between items-center gap-3">
              {/* Click the address to open the job card */}
              <button onClick={() => openJobCard(a)} className="min-w-0 text-left normal-case flex-1">
                <p className="text-sm text-ink truncate underline decoration-page hover:decoration-sky">{a.address}</p>
                <p className="text-tag text-muted">{fmtHours(a.total_hours ?? 0)} total{a.client_name ? ` · ${a.client_name}` : ''}</p>
                {a.lat == null || a.lng == null ? (
                  <p className="text-tag text-amber-600">⚠ No GPS — won't be audited</p>
                ) : null}
              </button>
              <button onClick={() => toggle(a)} className="text-[10px] font-forma uppercase tracking-[0.04em] underline text-red-500 shrink-0">
                Deactivate
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Inactive */}
      {inactive.length > 0 && (
        <div className="bg-surface rounded-2xl border border-page shadow-sm">
          <div className="px-5 py-3 border-b border-page">
            <h2 className="text-sm font-semibold text-muted">Inactive ({inactive.length})</h2>
          </div>
          <div className="divide-y divide-page max-h-48 overflow-y-auto">
            {inactive.map(a => (
              <div key={a.id} className="px-5 py-3 flex justify-between items-center opacity-50">
                <p className="text-sm text-muted line-through">{a.address}</p>
                <button onClick={() => toggle(a)} className="text-xs text-sky hover:underline shrink-0 ml-4">
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Job card — client details + total hours */}
      {openJob && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 px-4 py-6"
             onClick={() => setOpenJob(null)}>
          <div className="bg-surface w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto shadow-lg"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-ink normal-case">{openJob.address}</h2>
              <button type="button" onClick={() => setOpenJob(null)} className="text-muted hover:text-ink shrink-0">✕</button>
            </div>

            <div>
              <label className={labelCls}>Client Name</label>
              <input value={jobForm.client_name} onChange={e => setJobForm(f => ({ ...f, client_name: e.target.value }))} className={inputCls} placeholder="e.g. Jane Smith" />
            </div>
            <div>
              <label className={labelCls}>Client Number</label>
              <input value={jobForm.client_number} onChange={e => setJobForm(f => ({ ...f, client_number: e.target.value }))} className={inputCls} placeholder="e.g. 0400 000 000" />
            </div>
            <div>
              <label className={labelCls}>Client Email</label>
              <input type="email" value={jobForm.client_email} onChange={e => setJobForm(f => ({ ...f, client_email: e.target.value }))} className={inputCls} placeholder="e.g. jane@example.com" />
            </div>
            <div>
              <label className={labelCls}>Total Hours</label>
              <input
                type="number" step="0.01" min="0"
                value={jobForm.total_hours}
                disabled={!jobForm.manual}
                onChange={e => setJobForm(f => ({ ...f, total_hours: e.target.value }))}
                className={`${inputCls} ${jobForm.manual ? '' : 'opacity-60'}`}
              />
              <label className="flex items-center gap-2 mt-2 text-xs text-muted normal-case cursor-pointer">
                <input type="checkbox" checked={jobForm.manual} onChange={e => setJobForm(f => ({ ...f, manual: e.target.checked }))} />
                Override manually (otherwise total is auto-summed from approved timesheet entries for this site)
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={saveJobCard} disabled={jobBusy} className={`${btnPrimary} flex-1 h-11`}>
                {jobBusy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setOpenJob(null)} className={`${btnSecondary} flex-1 h-11`}>Cancel</button>
            </div>
            <p className="text-tag text-muted">
              {openJob.total_hours_manual ? 'Total is currently a manual override.' : 'Total is auto-maintained from approved timesheets.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
