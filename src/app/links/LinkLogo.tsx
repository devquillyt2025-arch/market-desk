"use client";

import { useState } from "react";

import { logoDisplaySize, logoUrlFor } from "./linkMeta";

/**
 * A site's icon, laid over the monogram tile it belongs to. The monogram is always there underneath; the icon
 * fades in on top only once it has really loaded, so there is no empty box while it's on its way and nothing
 * shifts when it arrives. If the site has no icon (/api/logo answers 404) or it can't be loaded, the monogram
 * simply stays - the placeholder is the default, not an error state.
 *
 * Mount with `key={host}`: a new host starts over.
 */
export function LinkLogo({ host }: { host: string }) {
  const src = logoUrlFor(host);
  const [failed, setFailed] = useState(false);
  /** The icon's own width once it has loaded; null until then. */
  const [naturalWidth, setNaturalWidth] = useState<number | null>(null);

  if (!src || failed) return null;
  const size = logoDisplaySize(naturalWidth ?? 28);

  return (
    <span
      className={`absolute inset-px flex items-center justify-center rounded-[11px] bg-[color-mix(in_srgb,white_92%,var(--tone))] transition-opacity duration-200 ${
        naturalWidth === null ? "opacity-0" : "opacity-100"
      }`}
    >
      {/* A plain <img>: a tiny decorative icon from this app's own route - next/image's optimiser adds nothing here.
          The name beside the tile already says what the site is. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={(e) => {
          // A tracking-pixel-sized answer is no icon at all.
          if (e.currentTarget.naturalWidth < 8) setFailed(true);
          else setNaturalWidth(e.currentTarget.naturalWidth);
        }}
        onError={() => setFailed(true)}
        className="object-contain"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
