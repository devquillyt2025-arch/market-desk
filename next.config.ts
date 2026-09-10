import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The route badge is dev-only (never renders in a production build or on
  // Vercel) but it overlaps the sidebar footer here, so keep it off locally.
  devIndicators: false,
};

export default nextConfig;
