import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev mode indicator (the round "N" badge that floats in
  // the bottom-left corner). It overlaps our sidebar footer.
  devIndicators: false,
};

export default nextConfig;
