import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useProfile } from './hooks/useProfile'
import Layout from './components/Layout'
import Login from './pages/Login'
import PunchClock from './pages/employee/PunchClock'
import MyTimesheets from './pages/employee/MyTimesheets'
import LeaveAndTIL from './pages/employee/LeaveAndTIL'
import EmployeeProfile from './pages/employee/Profile'
import Dashboard from './pages/admin/Dashboard'
import Employees from './pages/admin/Employees'
import JobAddresses from './pages/admin/JobAddresses'
import Stages from './pages/admin/Stages'
import TimesheetReview from './pages/admin/TimesheetReview'
import LeaveManagement from './pages/admin/LeaveManagement'
import Reports from './pages/admin/Reports'

function AppRoutes() {
  const { user, loading: authLoading } = useAuth()
  const { profile, loading: profileLoading } = useProfile()

  if (authLoading || (user && profileLoading)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1c9fda] border-t-transparent" />
      </div>
    )
  }

  if (!user) return <Routes><Route path="*" element={<Login />} /></Routes>

  const isAdmin = profile?.app_role === 'admin'

  return (
    <Layout>
      <Routes>
        {isAdmin ? (
          <>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/employees" element={<Employees />} />
            <Route path="/job-addresses" element={<JobAddresses />} />
            <Route path="/stages" element={<Stages />} />
            <Route path="/timesheets" element={<TimesheetReview />} />
            <Route path="/leave" element={<LeaveManagement />} />
            <Route path="/reports" element={<Reports />} />
          </>
        ) : (
          <>
            <Route path="/" element={<Navigate to="/clock" replace />} />
            <Route path="/clock" element={<PunchClock />} />
            <Route path="/my-timesheets" element={<MyTimesheets />} />
            <Route path="/leave" element={<LeaveAndTIL />} />
            <Route path="/profile" element={<EmployeeProfile />} />
          </>
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
