// deno-lint-ignore-file no-explicit-any
//
// Source of truth for the `send-reminders` Supabase Edge Function. Deploy with
// the Supabase MCP `deploy_edge_function` tool (or `supabase functions deploy
// send-reminders` from the CLI). The function is pg_cron'd every minute and:
//   1. Bails immediately if today (Australia/Melbourne) is a weekend or a VIC
//      public holiday.
//   2. For each active+notif-enabled employee whose reminder time matches the
//      current minute, sends a Web Push unless either (a) the same reminder
//      already fired today (reminder_log) or (b) the employee has approved
//      leave covering today.
//
import { createClient } from 'npm:@supabase/supabase-js@2.45.1'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC  = '***REMOVED-VAPID-PUBLIC***'
const VAPID_PRIVATE = '***REMOVED-VAPID-PRIVATE***'
const VAPID_SUBJECT = 'mailto:laura.butera@larkinbuildinggroup.com.au'

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

function melbDateAndTime() {
  const tz = 'Australia/Melbourne'
  const fmt = new Intl.DateTimeFormat('en-AU', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  })
  const parts = fmt.formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)!.value
  return {
    hhmm: `${get('hour')}:${get('minute')}`,
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'), // 'Mon', 'Tue', ..., 'Sat', 'Sun'
  }
}

// ── Victorian Public Holidays ────────────────────────────────────────────────
// Mirrors src/lib/holidays.ts on the client. Inlined because edge functions
// can't import from the src tree.
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

function easterSunday(y: number): { m: number; d: number } {
  const a = y % 19
  const b = Math.floor(y / 100)
  const c = y % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { m: month, d: day }
}

function nthWeekday(y: number, monthIdx0: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(y, monthIdx0, 1))
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return 1 + offset + (n - 1) * 7
}

function isWeekendDate(y: number, m: number, d: number): boolean {
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return wd === 0 || wd === 6
}

function vicHolidays(year: number): Set<string> {
  const out = new Set<string>()

  // New Year's Day — sub Mon if Sat/Sun
  if (isWeekendDate(year, 1, 1)) {
    const sub = new Date(Date.UTC(year, 0, 1)).getUTCDay() === 6 ? 3 : 2
    out.add(iso(year, 1, sub))
  } else {
    out.add(iso(year, 1, 1))
  }

  // Australia Day — sub Mon if Sat/Sun
  if (isWeekendDate(year, 1, 26)) {
    const sub = new Date(Date.UTC(year, 0, 26)).getUTCDay() === 6 ? 28 : 27
    out.add(iso(year, 1, sub))
  } else {
    out.add(iso(year, 1, 26))
  }

  // Labour Day — 2nd Mon Mar
  out.add(iso(year, 3, nthWeekday(year, 2, 1, 2)))

  // Easter Fri/Sat/Sun/Mon
  const easter = easterSunday(year)
  const es = Date.UTC(year, easter.m - 1, easter.d)
  const offsetDay = (offsetDays: number) => {
    const d = new Date(es + offsetDays * 86_400_000)
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  out.add(offsetDay(-2)) // Good Friday
  out.add(offsetDay(-1)) // Easter Saturday
  out.add(offsetDay( 0)) // Easter Sunday
  out.add(offsetDay(+1)) // Easter Monday

  // ANZAC Day — observed on actual date in VIC
  out.add(iso(year, 4, 25))

  // King's Birthday — 2nd Mon Jun
  out.add(iso(year, 6, nthWeekday(year, 5, 1, 2)))

  // AFL Grand Final Friday — explicit table; date varies year to year
  const afl: Record<number, string> = {
    2024: '2024-09-27',
    2025: '2025-09-26',
    2026: '2026-09-25',
    2027: '2027-09-24',
    2028: '2028-09-29',
  }
  if (afl[year]) out.add(afl[year])

  // Melbourne Cup — 1st Tue Nov
  out.add(iso(year, 11, nthWeekday(year, 10, 2, 1)))

  // Christmas Day & Boxing Day — sub when on weekend
  if (isWeekendDate(year, 12, 25)) {
    const wd = new Date(Date.UTC(year, 11, 25)).getUTCDay()
    out.add(iso(year, 12, wd === 6 ? 27 : 26))
  } else {
    out.add(iso(year, 12, 25))
  }
  if (isWeekendDate(year, 12, 26)) {
    const wd = new Date(Date.UTC(year, 11, 26)).getUTCDay()
    out.add(iso(year, 12, wd === 6 ? 28 : 27))
  } else {
    out.add(iso(year, 12, 26))
  }

  return out
}

Deno.serve(async () => {
  const errors: any[] = []
  const debug: any[] = []
  const result: any = {
    processed: 0, sent: 0, failed: 0, skipped: 0,
    errors, debug, nowHHMM: '', date: '', weekday: '', skipReason: '',
  }

  const { hhmm: nowHHMM, date: today, weekday } = melbDateAndTime()
  result.nowHHMM = nowHHMM
  result.date = today
  result.weekday = weekday

  // ── Global skip: weekends + VIC public holidays ──────────────────────────
  if (weekday === 'Sat' || weekday === 'Sun') {
    result.skipReason = 'weekend'
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
  }
  const year = Number(today.slice(0, 4))
  if (vicHolidays(year).has(today)) {
    result.skipReason = 'public_holiday'
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
  }

  const { data: profs, error } = await supabase
    .from('profiles')
    .select('id, full_name, clock_in_reminder, clock_out_reminder, notifications_enabled, push_subscriptions')
    .eq('is_active', true)
    .eq('notifications_enabled', true)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  // ── Per-employee skip: anyone whose approved leave covers today ──────────
  // Single query for all approved leave intersecting today, then look up by id.
  const { data: onLeaveRows } = await supabase
    .from('leave_requests')
    .select('employee_id')
    .eq('status', 'approved')
    .lte('start_date', today)
    .gte('end_date', today)
  const onLeaveIds = new Set<string>((onLeaveRows ?? []).map((r: any) => r.employee_id))

  for (const p of profs ?? []) {
    const subs = (p.push_subscriptions ?? []) as any[]
    if (!Array.isArray(subs) || subs.length === 0) continue

    if (onLeaveIds.has(p.id)) {
      result.skipped++
      debug.push({ name: p.full_name, skipped: 'on_approved_leave' })
      continue
    }

    for (const kind of ['clock_in', 'clock_out'] as const) {
      const remTime = kind === 'clock_in' ? p.clock_in_reminder : p.clock_out_reminder
      if (!remTime) continue
      if ((remTime as string).slice(0, 5) !== nowHHMM) continue

      const { data: existing } = await supabase
        .from('reminder_log')
        .select('id')
        .eq('employee_id', p.id)
        .eq('reminder_kind', kind)
        .eq('fired_date', today)
        .limit(1)
      if (existing && existing.length > 0) continue

      result.processed++

      const payload = JSON.stringify({
        title: kind === 'clock_in' ? 'Reminder to Clock-In' : 'Reminder to Clock-Out',
        body:  '',
        url:   '/clock',
        kind,
      })

      const survivors: any[] = []
      for (const sub of subs) {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 60 * 30, urgency: 'high' })
          result.sent++
          survivors.push(sub)
        } catch (err: any) {
          result.failed++
          const msg = { name: p.full_name, kind, statusCode: err?.statusCode, message: String(err?.body || err?.message || err), endpoint: sub?.endpoint?.slice(0, 60) }
          errors.push(msg)
          console.error('[send-reminders] push failed', msg)
          if (err.statusCode !== 410 && err.statusCode !== 404) survivors.push(sub)
        }
      }
      if (survivors.length !== subs.length) {
        await supabase.from('profiles').update({ push_subscriptions: survivors }).eq('id', p.id)
      }

      await supabase.from('reminder_log').insert({ employee_id: p.id, reminder_kind: kind })
      debug.push({ name: p.full_name, kind, subs: subs.length, survivors: survivors.length })
    }
  }

  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } })
})
