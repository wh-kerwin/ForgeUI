import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/ui/**/*.test.tsx"],
    setupFiles: ["./tests/ui/setup.ts"],
    watch: false,
    fileParallelism: false,
    // Real AntD renders and user-event accessibility checks are slower in jsdom.
    testTimeout: 30_000,
    environmentOptions: { jsdom: { url: "http://localhost/generate" } },
  },
});
