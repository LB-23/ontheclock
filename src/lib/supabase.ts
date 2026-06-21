import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ── Types ──────────────────────────────────────────────────────────────
export type AppRole = 'admin' | 'employee'
export type WeeklyHours = 38 | 40 | 42
export type EntryStatus = 'active' | 'completed' | 'submitted' | 'approved' | 'edited'
export type EntryType = 'regular' | 'annual_leave' | 'personal_leave' | 'time_in_lieu' | 'public_holiday'
export type TimesheetStatus = 'draft' | 'submitted' | 'approved' | 'rejected'
export type LeaveType = 'annual' | 'personal' | 'time_in_lieu' | 'unpaid'
export type LeaveStatus = 'pending' | 'approved' | 'declined' | 'withdrawn'
export type TilSource = 'auto_overtime' | 'leave_used' | 'manual_adjust'

export interface Profile {
  id: string
  full_name: string
  mobile_number: string
  job_role: string
  app_role: AppRole
  weekly_hours_category: WeeklyHours
  accrued_til_hours: number
  annual_leave_balance: number
  personal_leave_balance: number
  is_active: boolean
  created_at: string
  email?: string
  // Reminder schedule (HH:MM:SS) and notification gate
  clock_in_reminder:  string | null
  clock_out_reminder: string | null
  notifications_enabled: boolean
  push_subscriptions: PushSubscriptionJSON[]
  // Weekly leave accrual rates (hours added every Friday by the cron job)
  annual_accrual_per_week:   number
  personal_accrual_per_week: number
}

export interface JobAddress {
  id: string
  address: string
  is_active: boolean
  created_at: string
}

export interface Stage {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

export interface TimeEntry {
  id: string
  employee_id: string
  clock_in: string
  clock_out: string | null
  job_address_id: string | null
  stage_id: string | null
  clock_in_lat: number | null
  clock_in_lng: number | null
  clock_out_lat: number | null
  clock_out_lng: number | null
  lunch_included: boolean
  total_hours: number | null
  is_overtime: boolean
  status: EntryStatus
  week_start: string | null
  notes: string | null
  entry_type: EntryType
  source_leave_id: string | null
  created_at: string
  // joined
  job_addresses?: JobAddress
  stages?: Stage
  profiles?: Profile
}

export interface Timesheet {
  id: string
  employee_id: string
  week_start: string
  total_hours: number | null
  regular_hours: number | null
  overtime_hours: number | null
  status: TimesheetStatus
  admin_notes: string | null
  created_at: string
  submitted_at: string | null
  approved_by: string | null
  profiles?: Profile
  approver?: { full_name: string } | null
}

export interface LeaveRequest {
  id: string
  employee_id: string
  leave_type: LeaveType
  start_date: string
  end_date: string
  start_time: string | null   // 'HH:mm:ss' on start_date
  end_time:   string | null   // 'HH:mm:ss' on end_date
  total_hours: number | null
  reason: string | null
  status: LeaveStatus
  admin_notes: string | null
  withdrawal_reason: string | null
  withdrawn_at: string | null
  decided_by: string | null
  created_at: string
  profiles?: Profile
}

export interface TilLedger {
  id: string
  employee_id: string
  date: string
  hours_delta: number
  source: TilSource
  timesheet_id: string | null
  note: string | null
  created_at: string
}

export interface PublicHoliday {
  id: string
  date: string
  name: string
  state: string
  created_at: string
}
