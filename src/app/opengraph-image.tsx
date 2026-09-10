import { ImageResponse } from "next/og";

export const alt = "MarketDesk — options P&L calculator";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b1220 0%, #131b2e 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 84,
              height: 84,
              borderRadius: 18,
              background: "#3b82f6",
              color: "#ffffff",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: "#f1f5f9" }}>
            MarketDesk
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 36, fontSize: 30, color: "#94a3b8", maxWidth: 900 }}>
          Multi-leg options-selling P&L calculator for Nifty, Bank Nifty, and Sensex.
        </div>
      </div>
    ),
    { ...size },
  );
}
