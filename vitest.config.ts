import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Stub `server-only` so we can import lib files that transitively
    // pull it in. The package throws when loaded outside a Next.js server
    // context, which would block every test.
    alias: {
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
