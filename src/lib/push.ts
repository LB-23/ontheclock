import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string

/** Convert a base64url string to a Uint8Array (required by PushManager.subscribe). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' &&
         'serviceWorker' in navigator &&
         'PushManager' in window &&
         'Notification' in window
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  try {
    const reg = await navigator.serviceWorker.ready
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

/** Request permission + subscribe + persist subscription to profile. */
export async function enablePushForCurrentUser(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: 'Push not supported on this device/browser' }
  if (!VAPID_PUBLIC_KEY) return { ok: false, error: 'VAPID public key missing' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return { ok: false, error: 'Notification permission denied' }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    // Copy into a fresh ArrayBuffer to satisfy strict DOM types (rejects SharedArrayBuffer-backed views)
    const keyBuf = new ArrayBuffer(keyBytes.byteLength)
    new Uint8Array(keyBuf).set(keyBytes)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBuf,
    })
  }

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, error: 'Not signed in' }

  // Pull current subscriptions, append this one if new, save back
  const { data: prof } = await supabase
    .from('profiles')
    .select('push_subscriptions')
    .eq('id', auth.user.id)
    .single()
  const current: PushSubscriptionJSON[] = (prof?.push_subscriptions as PushSubscriptionJSON[]) ?? []
  const json = sub.toJSON()
  const already = current.some(s => s.endpoint === json.endpoint)
  const next = already ? current : [...current, json]
  await supabase.from('profiles').update({ push_subscriptions: next }).eq('id', auth.user.id)
  return { ok: true }
}

/** Unsubscribe + clear from profile. */
export async function disablePushForCurrentUser(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()

  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return
  const endpoint = sub?.endpoint
  if (!endpoint) return
  const { data: prof } = await supabase
    .from('profiles')
    .select('push_subscriptions')
    .eq('id', auth.user.id)
    .single()
  const current: PushSubscriptionJSON[] = (prof?.push_subscriptions as PushSubscriptionJSON[]) ?? []
  const next = current.filter(s => s.endpoint !== endpoint)
  await supabase.from('profiles').update({ push_subscriptions: next }).eq('id', auth.user.id)
}
