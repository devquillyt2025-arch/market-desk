/** What the Natural gas tab shows while its code or its first answer is on the way: the shape of what is coming, so nothing jumps. */
export default function NatgasSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <p className="sr-only">Loading natural gas…</p>
      <div className="h-8 w-64 max-w-full animate-pulse rounded-full bg-muted/60" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted/60" />
      <div className="h-80 animate-pulse rounded-2xl bg-muted/60" />
    </div>
  );
}
