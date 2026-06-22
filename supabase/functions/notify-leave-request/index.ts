// deno-lint-ignore-file no-explicit-any
//
// Event-triggered Web Push: when an employee submits a leave request, the
// client invokes this function, which pushes "<employee> has requested leave"
// to every admin who has push enabled. No schedule — fired on submission.
// Deploy with the Supabase MCP `deploy_edge_function` (or `supabase functions
// deploy notify-leave-request`). VAPID keys come from function secrets.
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

  // Resolve the requesting employee's name (don't trust the client for it)
  const { data: lr } = await supabase
    .from('leave_requests')
    .select('id, profiles:profiles!leave_requests_employee_id_fkey(full_name)')
    .eq('id', leave_request_id)
    .single()
  if (!lr) return json({ error: 'leave request not found' }, 404)
  const name = (lr.profiles as { full_name?: string } | null)?.full_name ?? 'An employee'

  // Every admin with notifications on + at least one push subscription
  const { data: admins, error } = await supabase
    .from('profiles')
    .select('id, push_subscriptions')
    .eq('app_role', 'admin')
    .eq('notifications_enabled', true)
  if (error) return json({ error: error.message }, 500)

  const payload = JSON.stringify({
    title: `${name} has requested leave`,
    body: '',
    url: '/leave',
    kind: 'leave_request',
  })

  let sent = 0, failed = 0
  for (const a of admins ?? []) {
    const subs = (a.push_subscriptions ?? []) as any[]
    if (!Array.isArray(subs) || subs.length === 0) continue
    const survivors: any[] = []
    for (const sub of subs) {
      try {
        await webpush.sendNotification(sub, payload, { TTL: 60 * 60, urgency: 'high' })
        sent++; survivors.push(sub)
      } catch (err: any) {
        failed++
        // Drop dead subscriptions (gone/expired); keep the rest
        if (err?.statusCode !== 410 && err?.statusCode !== 404) survivors.push(sub)
      }
    }
    if (survivors.length !== subs.length) {
      await supabase.from('profiles').update({ push_subscriptions: survivors }).eq('id', a.id)
    }
  }

  return json({ sent, failed, recipientName: name })
})
