/** Skeleton placeholder rows for lists that are loading. Replaces the
 *  plain "Loading…" text scattered through the app with shimmer-styled
 *  rows that match the real content shape — list items, cards, etc.
 *
 *  Renders `count` rows (default 3) at 56px each, separated by 1px page
 *  borders to mirror the divide-y divide-page pattern used by lists. The
 *  shimmer animation is pure CSS (defined in src/index.css) so there's no
 *  JS overhead, and it respects prefers-reduced-motion via the global
 *  reset (animation-duration collapses to 0.01ms).
 *
 *  Use:  <Skeleton />          // 3 rows
 *        <Skeleton count={6} /> // n rows
 */
export default function Skeleton({ count = 3, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`bg-surface border border-page divide-y divide-page ${className}`} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-14 px-5 py-4 flex items-center gap-3">
          <div className="skeleton-shimmer h-3 flex-1 max-w-[40%]" />
          <div className="skeleton-shimmer h-3 w-16" />
        </div>
      ))}
    </div>
  )
}
