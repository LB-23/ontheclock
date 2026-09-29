import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { inputCls, labelCls } from '../lib/utils'

/* Login submit button — gallery uses a neutral grey button (#E8E8E8 fill,
 * 1px #3A3A3A hairline, #666 Forma label, 10px uppercase), NOT the lime
 * btnPrimary used elsewhere. Kept login-specific since no other screen uses it. */
const btnLogin =
  'w-full h-10 inline-flex items-center justify-center bg-page border border-[#3A3A3A] text-muted font-forma font-semibold text-[10px] uppercase tracking-[0.04em] hover:bg-[#E0E0E0] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky disabled:opacity-50 disabled:cursor-not-allowed'

/* Supabase returns a 5xx/504 with an empty body when the auth server can't
 * reach the database in time; auth-js then stringifies that body, so users saw
 * a bare "{}". Translate server/network failures into something readable and
 * make it clear the password itself wasn't rejected. */
function loginErrorMessage(err: { message?: string; status?: number; name?: string }): string {
  const msg = (err.message ?? '').trim()
  const status = err.status ?? 0
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.'
  if (/email not confirmed/i.test(msg)) return 'This account has not been confirmed yet. Please contact your administrator.'
  const serverSide =
    status >= 500 || status === 0 || err.name === 'AuthRetryableFetchError' ||
    msg === '' || msg === '{}' || /fetch|network|timeout/i.test(msg)
  if (serverSide) return 'The server is busy and could not sign you in. Your password was not rejected — please wait a minute and try again.'
  return msg
}

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
    if (error) { setError(loginErrorMessage(error)); return }
    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-[340px]">
        {/* Full Larkin Building Group logo, centred (~300px). No "OnTheClock"
            wordmark on the login screen — matches the design gallery. */}
        <div className="text-center mb-8">
          <img src="/lb-full.svg" alt="Larkin Building Group" className="w-[300px] mx-auto" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelCls}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={`${inputCls} h-10`}
              placeholder="name@larkinbuildinggroup.com.au"
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
              className={`${inputCls} h-10`}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 border border-red-200">{error}</p>
          )}
          <button type="submit" disabled={loading} className={btnLogin}>
            {loading ? 'Signing in…' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  )
}
