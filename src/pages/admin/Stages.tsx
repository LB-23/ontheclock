import { useEffect, useState } from 'react'
import { supabase, type Stage } from '../../lib/supabase'
import { btnPrimary, inputCls, labelCls } from '../../lib/utils'

export default function Stages() {
  const [stages, setStages] = useState<Stage[]>([])
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  const load = () =>
    supabase.from('stages').select('*').order('name')
      .then(({ data }) => setStages((data as Stage[]) ?? []))

  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setAdding(true)
    await supabase.from('stages').insert({ name: newName.trim(), is_active: true })
    setNewName('')
    setAdding(false)
    load()
  }

  const toggle = async (s: Stage) => {
    await supabase.from('stages').update({ is_active: !s.is_active }).eq('id', s.id)
    setStages(prev => prev.map(x => x.id === s.id ? { ...x, is_active: !x.is_active } : x))
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink">Stages / Tasks</h1>
      <form onSubmit={add} className="bg-surface rounded-2xl border border-page shadow-sm p-5 flex gap-3">
        <div className="flex-1">
          <label className={labelCls}>New Stage Name</label>
          <input value={newName} onChange={e => setNewName(e.target.value)} className={inputCls} placeholder="e.g. Tiling" required />
        </div>
        <button type="submit" disabled={adding} className={`${btnPrimary} h-11 self-end`}>
          {adding ? '…' : '+ Add Stage'}
        </button>
      </form>
      <div className="bg-surface rounded-2xl border border-page shadow-sm divide-y divide-page">
        {stages.map(s => (
          <div key={s.id} className={`px-5 py-3 flex justify-between items-center ${!s.is_active ? 'opacity-40' : ''}`}>
            <p className="text-sm font-medium">{s.name}</p>
            <button onClick={() => toggle(s)} className={`text-[10px] font-forma uppercase tracking-[0.04em] underline ${s.is_active ? 'text-red-500' : 'text-sky'}`}>
              {s.is_active ? 'Deactivate' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
