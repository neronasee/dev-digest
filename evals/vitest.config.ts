import { defineConfig } from "vitest/config";
import TrendReporter from "./src/trend-reporter.js";

export default defineConfig({
  test: {
    // *.eval.ts = model-backed evals; src/**/*.test.ts = the pure stats unit tests.
    include: ["**/*.eval.ts", "src/**/*.test.ts"],
    // Real Claude sessions (and a subagent dispatch) are slow — give them room. 600s: on the
    // proxied glm backend generation runs ~55-60 tok/s plus a ~50s judge call, so the big
    // report-shaped cases need more than the template's 240s (content+judge passed past the
    // cutoff there; judges were green whenever they got to run).
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // One session per test; a few files can run concurrently. Keep it modest to stay cheap.
    fileParallelism: true,
    reporters: ["default", new TrendReporter()],
  },
});
