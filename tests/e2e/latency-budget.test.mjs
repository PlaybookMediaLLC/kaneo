/**
 * Lean latency-budget verification (#307).
 *
 * Runs against a running Kaneo API base URL (KANEO_API_URL, default http://127.0.0.1:1337)
 * and asserts p95 latency stays within strict interactive budgets.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const BASE_URL = (process.env.KANEO_API_URL || "http://127.0.0.1:1337").replace(
  /\/$/,
  "",
);
const P95_BUDGET_MS = Number(process.env.KANEO_LATENCY_P95_MS || 250);
const SAMPLES = Number(process.env.KANEO_LATENCY_SAMPLES || 10);

async function measureEndpoint(path) {
  const times = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    const res = await fetch(`${BASE_URL}${path}`);
    await res.arrayBuffer();
    const elapsed = performance.now() - start;
    assert.strictEqual(
      res.status,
      200,
      `Expected HTTP 200 from ${path}, received ${res.status}`,
    );
    times.push(elapsed);
  }
  times.sort((a, b) => a - b);
  const p95 =
    times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)];
  return {
    path,
    p95: Math.round(p95 * 10) / 10,
    max: Math.round(times.at(-1) * 10) / 10,
  };
}

async function main() {
  const endpoints = ["/api/health"];
  for (const endpoint of endpoints) {
    const stats = await measureEndpoint(endpoint);
    console.log(
      `[latency-budget] ${stats.path}: p95=${stats.p95}ms max=${stats.max}ms (budget=${P95_BUDGET_MS}ms)`,
    );
    assert.ok(
      stats.p95 <= P95_BUDGET_MS,
      `Latency budget exceeded on ${stats.path}: p95=${stats.p95}ms > ${P95_BUDGET_MS}ms`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
