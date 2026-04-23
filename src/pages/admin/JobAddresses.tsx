import { useEffect, useState } from 'react'
import { supabase, type JobAddress } from '../../lib/supabase'
import { btnPrimary, btnSecondary, inputCls, labelCls } from '../../lib/utils'

export default function JobAddresses() {
  const [addresses, setAddresses] = useState<JobAddress[]>([])
  const [loading, setLoading] = useState(true)
  const [newAddress, setNewAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')

  const load = () =>
    supabase.from('job_addresses').select('*').order('address')
      .then(({ data }) => { setAddresses((data as JobAddress[]) ?? []); setLoading(false) })

  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAddress.trim()) return
    setAdding(true)
    await supabase.from('job_addresses').insert({ address: newAddress.trim(), is_active: true })
    setNewAddress('')
    setAdding(false)
    load()
  }

  const toggle = async (addr: JobAddress) => {
    await supabase.from('job_addresses').update({ is_active: !addr.is_active }).eq('id', addr.id)
    setAddresses(prev => prev.map(a => a.id === addr.id ? { ...a, is_active: !a.is_active } : a))
  }

  const filtered = addresses.filter(a => a.address.toLowerCase().includes(search.toLowerCase()))
  const active   = filtered.filter(a =>  a.is_active)
  const inactive = filtered.filter(a => !a.is_active)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Job Sites</h1>

      {/* Add new */}
      <form onSubmit={add} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Add New Job Site</p>
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
          {adding ? 'Adding…' : '+ Add Site'}
        </button>
      </form>

      {/* Search */}
      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className={inputCls}
        placeholder="Search addresses…"
      />

      {loading && <p className="text-center text-gray-400">Loading…</p>}

      {/* Active */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="px-5 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Active ({active.length})</h2>
        </div>
        <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
          {active.map(a => (
            <div key={a.id} className="px-5 py-3 flex justify-between items-center">
              <p className="text-sm text-gray-900">{a.address}</p>
              <button onClick={() => toggle(a)} className="text-xs text-red-500 hover:underline shrink-0 ml-4">
                Deactivate
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Inactive */}
      {inactive.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-5 py-3 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-400">Inactive ({inactive.length})</h2>
          </div>
          <div className="divide-y divide-gray-50 max-h-48 overflow-y-auto">
            {inactive.map(a => (
              <div key={a.id} className="px-5 py-3 flex justify-between items-center opacity-50">
                <p className="text-sm text-gray-500 line-through">{a.address}</p>
                <button onClick={() => toggle(a)} className="text-xs text-[#1c9fda] hover:underline shrink-0 ml-4">
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
