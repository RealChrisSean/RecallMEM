import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // Hide the Next.js dev mode indicator (the round "N" badge that floats in
  // the bottom-left corner). It overlaps our sidebar footer.
  devIndicators: false,
  // Expose the version from package.json so any client component can show it.
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
};

export default nextConfig;
