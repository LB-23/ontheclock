import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Clock, ClipboardList, Palmtree, UserCircle,
  LayoutDashboard, Users, ChartBar, MapPinCheck,
  MapPin, Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

interface NavItem { to: string; label: string; Icon: LucideIcon }

const employeeNav: NavItem[] = [
  { to: '/clock',         label: 'Clock',      Icon: Clock },
  { to: '/my-timesheets', label: 'Timesheets', Icon: ClipboardList },
  { to: '/leave',         label: 'Leave',      Icon: Palmtree },
  { to: '/profile',       label: 'Profile',    Icon: UserCircle },
]

const adminNav: NavItem[] = [
  { to: '/dashboard',    label: 'Dashboard',  Icon: LayoutDashboard },
  { to: '/employees',    label: 'Team',       Icon: Users },
  { to: '/timesheets',   label: 'Timesheets', Icon: ClipboardList },
  { to: '/leave',        label: 'Leave',      Icon: Palmtree },
  { to: '/reports',      label: 'Reports',    Icon: ChartBar },
  { to: '/audit',        label: 'Audit',      Icon: MapPinCheck },
  { to: '/job-addresses',label: 'Sites',      Icon: MapPin },
  { to: '/stages',       label: 'Stages',     Icon: Wrench },
]

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
          <img src="/lb-icon.svg" alt="LB" className="w-7 h-7" />
          <span className="text-lg font-bold text-sky">OnTheClock</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky/10 text-sky'
                    : 'text-muted hover:bg-page hover:text-ink'
                }`
              }
            >
              <item.Icon className="w-5 h-5 flex-shrink-0" strokeWidth={1.5} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-page p-4">
          <p className="text-xs text-muted truncate mb-2">{profile?.email ?? profile?.full_name}</p>
          <button
            onClick={handleSignOut}
            className="w-full rounded-xl border border-page px-3 py-2 text-sm text-muted hover:bg-page hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-56 pb-20 md:pb-0">
        <header className="md:hidden sticky top-0 z-10 flex h-14 items-center justify-between bg-surface px-4 border-b border-page shadow-sm safe-top">
          <div className="flex items-center gap-2">
            <img src="/lb-icon.svg" alt="LB" className="w-6 h-6" />
            <span className="text-base font-bold text-sky">OnTheClock</span>
          </div>
          <button onClick={handleSignOut} className="text-xs text-muted">Sign out</button>
        </header>
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          {children}
        </div>
      </main>

      {/* Bottom nav — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 flex bg-surface border-t border-page shadow-lg safe-bottom">
        {nav.slice(0, 5).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-sky' : 'text-muted'
              }`
            }
          >
            <item.Icon className="w-6 h-6 mb-0.5" strokeWidth={1.5} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
