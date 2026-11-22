import { ImageResponse } from "next/og";

/**
 * The app's icon in the sizes the browser and the phone's home screen ask for, one design: the violet tile with the M.
 *  - "32": the tab icon.
 *  - "192" and "512": the installed app's icon (the manifest lists them; an install prompt needs both).
 *  - "maskable": a full-bleed square with the M held inside the middle 60%, so Android can cut it to a circle or a squircle
 *    without clipping the letter.
 * Served at /icon/<id>; both the PIN gate (proxy.ts) and the manifest know that path.
 */
const ICONS = [
  { id: "32", size: 32, radius: 7, font: 20 },
  { id: "192", size: 192, radius: 42, font: 120 },
  { id: "512", size: 512, radius: 112, font: 320 },
  { id: "maskable", size: 512, radius: 0, font: 220 },
] as const;

export function generateImageMetadata() {
  return ICONS.map(({ id, size }) => ({ id, size: { width: size, height: size }, contentType: "image/png" }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const key = String(await id);
  const icon = ICONS.find((i) => i.id === key) ?? ICONS[0];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#7869fc",
          borderRadius: icon.radius,
          color: "#f5f5f5",
          fontSize: icon.font,
          fontWeight: 700,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        M
      </div>
    ),
    { width: icon.size, height: icon.size },
  );
}
