import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Compact prev/next pager for admin tables ("51–100 of 5,968"). */
export default function AdminPager({ page, pageSize, total, onPage, busy = false }: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  busy?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = 'flex h-8 w-8 items-center justify-center rounded border border-[#e5e5e5] text-[#555] hover:bg-[#f5f5f5] disabled:opacity-30';
  return (
    <nav aria-label="Pagination" className="flex items-center justify-end gap-2 px-4 py-3 text-[12px] text-[#666]">
      <span aria-live="polite" className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        {busy && <span className="ml-2 text-[#aaa]">Loading…</span>}
      </span>
      <button type="button" className={btn} onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page">
        <ChevronLeft size={14} />
      </button>
      <span className="tabular-nums">{page} / {pages}</span>
      <button type="button" className={btn} onClick={() => onPage(page + 1)} disabled={page >= pages} aria-label="Next page">
        <ChevronRight size={14} />
      </button>
    </nav>
  );
}
