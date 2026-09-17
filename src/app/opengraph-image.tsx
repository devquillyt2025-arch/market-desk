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
          background: "linear-gradient(135deg, #0a0a0a 0%, #141416 100%)",
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
              background: "#7869fc",
              color: "#f5f5f5",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            M
          </div>
          <div style={{ display: "flex", fontSize: 60, fontWeight: 700, color: "#f5f5f5" }}>
            MarketDesk
          </div>
        </div>
        <div style={{ display: "flex", marginTop: 36, fontSize: 30, color: "#b0b0b0", maxWidth: 900 }}>
          Multi-leg options-selling P&L calculator for Nifty, Bank Nifty, and Sensex.
        </div>
      </div>
    ),
    { ...size },
  );
}
