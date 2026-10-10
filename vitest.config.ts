import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // chain tests share one in-process EVM per worker file; run files sequentially for determinism
    fileParallelism: false,
    pool: "forks",
  },
});
