import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tmp_repro/*.test.ts"] } });
