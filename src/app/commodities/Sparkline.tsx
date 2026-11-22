import { useId } from "react";

import { sparkShape } from "@/lib/commodityBoard";
import type { MoveDirection } from "@/lib/watchlist";

import { DIRECTION } from "./direction";

const W = 112;
const H = 48;

/**
 * The last few minutes of a contract's price, drawn as a soft curve over a fading fill. Until two ticks have arrived it
 * is a dotted baseline, so the card doesn't jump when the trace appears.
 */
export default function Sparkline({ prices, direction, className = "h-12 w-28" }: { prices: readonly number[]; direction: MoveDirection; className?: string }) {
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const shape = sparkShape(prices, W, H);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`${className} shrink-0 overflow-visible ${DIRECTION[direction].text}`} aria-hidden="true">
      {shape ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={shape.area} fill={`url(#${gradientId})`} />
          <path d={shape.line} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={shape.end.x} cy={shape.end.y} r="5" fill="currentColor" opacity="0.18" />
          <circle cx={shape.end.x} cy={shape.end.y} r="2.5" fill="currentColor" />
        </>
      ) : (
        <line x1="3" y1={H / 2} x2={W - 3} y2={H / 2} stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="1 5" strokeLinecap="round" />
      )}
    </svg>
  );
}
