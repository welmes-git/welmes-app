/**
 * WELMES wordmark: Cormorant Garamond 500 with wide tracking over a small BUSINESS line.
 * Letter-spacing also adds space after the last letter, so each line takes a negative
 * right margin of the same amount — that keeps both lines optically centred.
 */
const SIZES = {
  header: { gap: 'gap-1', mark: 'text-[18px] md:text-[21px]', sub: 'text-[10px] md:text-[11px]' },
  auth: { gap: 'gap-1.5', mark: 'text-[30px]', sub: 'text-[12px]' },
  print: { gap: 'gap-1', mark: 'text-[26px]', sub: 'text-[11px]' },
};

export default function Logo({ size = 'header' }: { size?: keyof typeof SIZES }) {
  const s = SIZES[size];
  return (
    <span className={`inline-flex flex-col items-center ${s.gap}`}>
      <span className={`-mr-[0.32em] font-logo font-medium leading-none tracking-[0.32em] text-ink-900 ${s.mark}`}>WELMES</span>
      <span className={`-mr-[0.5em] leading-none tracking-[0.5em] text-ink-500 ${s.sub}`}>BUSINESS</span>
    </span>
  );
}
