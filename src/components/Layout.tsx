import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useProfile } from '../hooks/useProfile'

interface NavItem { to: string; label: string; icon: string }

const employeeNav: NavItem[] = [
  { to: '/clock',         label: 'Clock',      icon: '⏱' },
  { to: '/my-timesheets', label: 'Timesheets',  icon: '📋' },
  { to: '/leave',         label: 'Leave',       icon: '🌴' },
  { to: '/profile',       label: 'Profile',     icon: '👤' },
]

const adminNav: NavItem[] = [
  { to: '/dashboard',    label: 'Dashboard',   icon: '📊' },
  { to: '/employees',    label: 'Team',        icon: '👥' },
  { to: '/timesheets',   label: 'Timesheets',  icon: '📋' },
  { to: '/leave',        label: 'Leave',       icon: '🌴' },
  { to: '/reports',      label: 'Reports',     icon: '📈' },
  { to: '/job-addresses',label: 'Sites',       icon: '📍' },
  { to: '/stages',       label: 'Stages',      icon: '🔧' },
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
      <aside className="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-gray-100 shadow-sm">
        <div className="flex h-16 items-center gap-2 px-6 border-b border-gray-100">
          <img src="/logo.svg" alt="LB" className="w-7 h-7" />
          <span className="text-lg font-bold text-[#1c9fda]">OnTheClock</span>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {nav.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1c9fda]/10 text-[#1c9fda]'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-100 p-4">
          <p className="text-xs text-gray-500 truncate mb-2">{profile?.email ?? profile?.full_name}</p>
          <button
            onClick={handleSignOut}
            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 md:ml-56 pb-20 md:pb-0">
        {/* Mobile top bar */}
        <header className="md:hidden sticky top-0 z-10 flex h-14 items-center justify-between bg-white px-4 border-b border-gray-100 shadow-sm safe-top">
          <div className="flex items-center gap-2">
            <img src="/logo.svg" alt="LB" className="w-6 h-6" />
            <span className="text-base font-bold text-[#1c9fda]">OnTheClock</span>
          </div>
          <button onClick={handleSignOut} className="text-xs text-gray-500">Sign out</button>
        </header>
        <div className="p-4 md:p-8 max-w-5xl mx-auto">
          {children}
        </div>
      </main>

      {/* Bottom nav — mobile only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 flex bg-white border-t border-gray-100 shadow-lg safe-bottom">
        {nav.slice(0, 5).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center justify-center py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-[#1c9fda]' : 'text-gray-400'
              }`
            }
          >
            <span className="text-xl leading-none mb-0.5">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
