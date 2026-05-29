/** Branded callout for admin-authored notes attached to leave requests,
 *  timesheets, etc. Uses the design-system documented admin-note palette:
 *  bg #BBDDEC, border #1C8DBF, text #1C8DBF. Replaces the ad-hoc
 *  "💬 …" paragraphs that were scattered across the admin pages —
 *  no emoji-as-icon and a real component the design system can point to. */
export default function AdminNoteBanner({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`border px-3 py-2 text-xs leading-snug ${className}`}
      style={{ backgroundColor: '#BBDDEC', borderColor: '#1C8DBF', color: '#1C8DBF' }}
      role="note"
    >
      <span className="font-semibold uppercase tracking-[0.04em] mr-1.5">Note</span>
      {children}
    </div>
  )
}
