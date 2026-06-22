import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

interface NavItem { to: string; label: string; icon: string }

const employeeNav: NavItem[] = [
  { to: '/clock',         label: 'Clock',      icon: 'clock' },
  { to: '/my-timesheets', label: 'Timesheets', icon: 'timesheet' },
  { to: '/leave',         label: 'Leave',      icon: 'leave' },
  { to: '/profile',       label: 'Profile',    icon: 'profile' },
]

const adminNav: NavItem[] = [
  { to: '/dashboard',    label: 'Dashboard',  icon: 'dashboard' },
  { to: '/employees',    label: 'Team',       icon: 'team' },
  { to: '/timesheets',   label: 'Timesheets', icon: 'timesheet' },
  { to: '/leave',        label: 'Leave',      icon: 'leave' },
  { to: '/reports',      label: 'Reports',    icon: 'reports' },
  { to: '/audit',        label: 'Audit',      icon: 'audit' },
  { to: '/job-addresses',label: 'Sites',      icon: 'sites' },
  { to: '/stages',       label: 'Stages',     icon: 'stages' },
  // Admin self-service: mobile number + push notification opt-in. Same
  // EmployeeProfile component is re-used at /profile for admins (route in
  // App.tsx). Sidebar-only — bottom nav still caps at the 5 most-used.
  { to: '/profile',      label: 'Profile',    icon: 'profile' },
]

/** Renders the brand SVG icons with CSS mask so they inherit currentColor for tinting. */
function NavIcon({ name, className = 'w-5 h-5' }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block flex-shrink-0 ${className}`}
      style={{
        backgroundColor: 'currentColor',
        WebkitMaskImage: `url(/icons/${name}.svg)`,
        maskImage: `url(/icons/${name}.svg)`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  )
}

export default function Layout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const isAdmin = profile?.app_role === 'admin'
  const nav = isAdmin ? adminNav : employeeNav

  const handleSignOut = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar — visible on md+ */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 bg-surface border-r border-page shadow-sm">
        <div className="flex h-16 items-center gap-2 px-6 border-b border-page">
          <img src="/lb-icon.svg" alt="LB" className="h-10 w-auto" />
          <span className="text-[15px] font-condensed font-bold text-sky">OnTheClock</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              /* Active state used to lean only on bg-sky/10 (low-contrast on
               * the light sidebar). Added a 2px sky left rail so the active
               * item reads at a glance regardless of theme/brightness. */
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 text-[13px] font-clock transition-colors border-l-2 ${
                  isActive
                    ? 'bg-sky/10 text-sky border-sky'
                    : 'text-muted hover:bg-page hover:text-ink border-transparent'
                }`
              }
            >
              <NavIcon name={item.icon} className="w-5 h-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-page p-4">
          {/* Title attr surfaces the full email/name to sighted users on hover
             and to assistive tech, so the silent truncate doesn't hide info. */}
          <p
            className="text-tag font-medium text-muted truncate mb-2"
            title={profile?.email ?? profile?.full_name ?? undefined}
          >
            {profile?.email ?? profile?.full_name}
          </p>
          <button
            onClick={handleSignOut}
            className="w-[90px] border border-[#3A3A3A] px-3 py-2 text-[9px] font-semibold font-forma uppercase tracking-[0.04em] text-muted hover:bg-page hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-56 pb-20 md:pb-0">
        <header className="md:hidden sticky top-0 z-10 flex h-14 items-center justify-between bg-surface px-4 border-b border-page safe-top">
          <div className="flex items-center gap-2">
            <img src="/lb-icon.svg" alt="LB" className="h-10 w-auto" />
            <span className="text-[15px] font-condensed font-bold text-sky">OnTheClock</span>
          </div>
          {/* Real tap-target — was a 12px text link, well below 44pt minimum */}
          <button
            type="button"
            onClick={handleSignOut}
            className="inline-flex items-center justify-center min-h-11 w-[90px] px-3 py-2 text-[9px] font-semibold font-forma uppercase tracking-[0.04em] text-muted hover:text-ink border border-[#3A3A3A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky"
          >
            Sign Out
          </button>
        </header>
        {/* p-3 on the smallest viewport (≤320px) gives 12px gutters so the
            content doesn't crowd the screen edge; sm:p-4 / md:p-8 restores
            the normal scale on regular phones and desktop. */}
        <div className="p-3 sm:p-4 md:p-8 max-w-5xl mx-auto">
          {children}
        </div>
      </main>

      {/* Bottom nav — mobile only.
       *  min-h-[56px] per Material bottom-nav guidance so each tap target
       *  reads ≥48dp even after the safe-area inset eats into the height. */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 flex overflow-x-auto bg-surface border-t border-page shadow-lg safe-bottom">
        {/* Every page is reachable — items past the 5th scroll horizontally
            (basis-1/5 shows five at a time). */}
        {nav.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 min-w-[20%] flex-col items-center justify-center min-h-[56px] py-2 text-tag font-clock transition-colors ${
                isActive ? 'text-sky' : 'text-muted'
              }`
            }
          >
            <NavIcon name={item.icon} className="w-6 h-6 mb-0.5" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
