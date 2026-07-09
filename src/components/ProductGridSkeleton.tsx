/**
 * Placeholder shown while the real product catalogue is still loading from
 * Supabase, so pages don't flash the demo/fallback catalogue and then swap
 * it out a moment later once the real data arrives.
 */
export default function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-square rounded-lg bg-[#f0f0f0] mb-3" />
          <div className="h-3 w-1/3 bg-[#f0f0f0] rounded mb-2" />
          <div className="h-3.5 w-4/5 bg-[#f0f0f0] rounded mb-2" />
          <div className="h-4 w-1/2 bg-[#f0f0f0] rounded" />
        </div>
      ))}
    </div>
  );
}
