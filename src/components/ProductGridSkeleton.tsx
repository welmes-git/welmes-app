/**
 * Placeholder shown while the real product catalogue is still loading from
 * Supabase, so pages don't flash the demo/fallback catalogue and then swap
 * it out a moment later once the real data arrives.
 */
export default function ProductGridSkeleton({ count = 12, className = 'product-grid' }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-square rounded-sm bg-sunken" />
          <div className="mt-2 h-[26px] w-1/3 rounded-sm bg-sunken" />
          <div className="mt-[2px] h-5 w-4/5 rounded-sm bg-sunken" />
          <div className="h-5 w-1/2 rounded-sm bg-sunken" />
          <div className="mt-3 h-[34px] w-2/3 rounded-sm bg-sunken" />
        </div>
      ))}
    </div>
  );
}
