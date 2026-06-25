// deno-lint-ignore-file no-explicit-any
//
// Event-triggered Web Push: when an admin approves a leave request, the client
// invokes this function, which pushes "Leave Request Approved" to the employee
// who made the request. No schedule - fired on approval. VAPID keys come from
// function secrets.
//
import { createClient } from 'npm:@supabase/supabase-js@2.45.1'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC  = Deno.env.get('VAPID_PUBLIC')!
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE')!
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:laura.butera@larkinbuildinggroup.com.au'
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
)

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { leave_request_id } = await req.json().catch(() => ({} as any))
  if (!leave_request_id) return json({ error: 'leave_request_id required' }, 400)

  // Resolve the employee who made the request
  const { data: lr } = await supabase
    .from('leave_requests')
    .select('id, employee_id')
    .eq('id', leave_request_id)
    .single()
  if (!lr) return json({ error: 'leave request not found' }, 404)

  // Their push subscriptions (respect the mute toggle)
  const { data: prof, error } = await supabase
    .from('profiles')
    .select('id, push_subscriptions, notifications_enabled')
    .eq('id', lr.employee_id)
    .single()
  if (error) return json({ error: error.message }, 500)
  if (!prof || prof.notifications_enabled === false) return json({ sent: 0, skipped: 'muted-or-missing' })

  const payload = JSON.stringify({
    title: 'Leave Request Approved',
    body: '',
    url: '/leave',
    kind: 'leave_approved',
  })

  const subs = (prof.push_subscriptions ?? []) as any[]
  let sent = 0, failed = 0
  const survivors: any[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 60 * 60, urgency: 'high' })
      sent++; survivors.push(sub)
    } catch (err: any) {
      failed++
      if (err?.statusCode !== 410 && err?.statusCode !== 404) survivors.push(sub)
    }
  }
  if (survivors.length !== subs.length) {
    await supabase.from('profiles').update({ push_subscriptions: survivors }).eq('id', prof.id)
  }

  return json({ sent, failed })
})
