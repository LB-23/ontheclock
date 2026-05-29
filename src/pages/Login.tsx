import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { btnPrimary, inputCls, labelCls } from '../lib/utils'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    setLoading(false)
    if (error) { setError(error.message); return }
    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        {/* Logo already carries the brand name (alt + visual). Dropping the
            "Larkin Building Group" subtitle removes a redundant line. */}
        <div className="text-center mb-8">
          <img src="/lb-full.svg" alt="Larkin Building Group" className="w-56 mx-auto mb-3" />
          <h1 className="text-2xl font-bold text-ink">OnTheClock</h1>
        </div>

        <div className="bg-surface border border-page p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className={labelCls}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@larkinbuildinggroup.com.au"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className={inputCls}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 border border-red-200">{error}</p>
            )}
            <button type="submit" disabled={loading} className={`${btnPrimary} w-full h-12`}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
