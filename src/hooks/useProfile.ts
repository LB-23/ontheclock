import { useEffect, useState } from 'react'
import { supabase, type Profile } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useProfile() {
  const { user } = useAuth()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) { setProfile(null); setLoading(false); return }

    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        setProfile(data ? { ...data, email: user.email } : null)
        setLoading(false)
      })
  }, [user])

  const refresh = async () => {
    if (!user) return
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    setProfile(data ? { ...data, email: user.email } : null)
  }

  return { profile, loading, refresh }
}
