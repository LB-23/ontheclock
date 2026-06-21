import { useEffect, useState } from 'react'
import { supabase, type JobAddress } from '../../lib/supabase'
import { btnPrimary, btnSecondary, inputCls, labelCls } from '../../lib/utils'
import { geocodeAddress } from '../../lib/geocode'
import Skeleton from '../../components/Skeleton'

/** JobAddress + the lat/lng/geocoded_at columns the audit view depends on. */
type JobAddressGeo = JobAddress & {
  lat:           number | null
  lng:           number | null
  geocoded_at:   string | null
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
        placeholder="Search addresses…"
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
              <div className="min-w-0">
                <p className="text-sm text-ink truncate">{a.address}</p>
                {a.lat == null || a.lng == null ? (
                  <p className="text-tag text-amber-600">⚠ No GPS — won't be audited</p>
                ) : null}
              </div>
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
    </div>
  )
}
