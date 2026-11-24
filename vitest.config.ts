import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

// Testovi nikad ne koriste produkcijsku bazu: setup briše DATABASE_URL i
// svaka DB proba radi u vlastitom privremenom direktoriju.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["tests/db/**/*.test.ts"],
          environment: "node",
          setupFiles: ["tests/setup.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
