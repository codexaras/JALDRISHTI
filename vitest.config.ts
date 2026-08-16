import { defineConfig } from "vitest/config";

// Deliberately standalone: the app's vite.config.ts loads the Cloudflare plugin,
// which spins up workerd. The engine is pure, so it tests fastest in plain Node.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
