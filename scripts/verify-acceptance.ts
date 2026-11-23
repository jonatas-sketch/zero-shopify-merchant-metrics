import assert from "node:assert/strict";
import { readMerchantStream, type MetricChart } from "../lib/merchant-stream";
import type { MetricInput } from "../lib/dates";

type Case = {
  id: string;
  question: string;
  kind?: MetricChart["kind"];
  filters?: MetricInput;
  expected?: number[];
};

const defaultDates = { startDate: "2025-09-28", endDate: "2025-10-27" };
const cases: Case[] = [
  {
    id: "Winter jackets",
    question: "Which winter jackets were returned last week?",
    kind: "bars",
    filters: { startDate: "2025-10-20", endDate: "2025-10-26", category: "Winter Jackets" },
    expected: [4, 4],
  },
  {
    id: "AQ-01",
    question: "sales last 30 days online store only",
    kind: "line",
    filters: { startDate: "2025-09-27", endDate: "2025-10-26", channel: "Online Store" },
    expected: [1230.90],
  },
  {
    id: "AQ-02",
    question: "best sellers this season",
    kind: "ranking",
    filters: defaultDates,
    expected: [4, 4, 3],
  },
  {
    id: "AQ-03",
    question: "which jackets came back the most last week",
    kind: "bars",
    filters: { startDate: "2025-10-20", endDate: "2025-10-26", category: "Jackets" },
    expected: [4, 4],
  },
  {
    id: "AQ-07",
    question: "what's my ad spend on Meta this month",
  },
  {
    id: "AQ-08",
    question: "how are returns doing",
    kind: "bars",
    filters: defaultDates,
    expected: [6, 6],
  },
  {
    id: "AQ-10",
    question: "how many ppl bought twice in october",
    kind: "metric",
    filters: { startDate: "2025-10-01", endDate: "2025-10-27" },
    expected: [4, 12],
  },
  {
    id: "AQ-20",
    question: "how many fleece vests do i have left in stock",
  },
];

function measuredValues(chart: MetricChart) {
  const values = chart.points.map(({ value }) => value);
  if (chart.kind === "ranking") return values.slice(0, 3);
  if (chart.kind === "metric") return values;
  const total = values.reduce((sum, value) => sum + value, 0);
  if (chart.kind === "bars") return [total, chart.returns?.length ?? 0];
  return [Number(total.toFixed(2))];
}

const endpoint = new URL("/api/merchant/stream", process.argv[2] ?? "http://127.0.0.1:3000");

for (const testCase of cases) {
  const started = performance.now();
  let chartSeconds: number | undefined;
  let answer = "";
  let done = false;
  const charts: MetricChart[] = [];
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: testCase.question }),
      signal: AbortSignal.timeout(50_000),
    });
    assert.ok(response.ok && response.body, `HTTP ${response.status}`);
    for await (const event of readMerchantStream(response.body)) {
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "chart") {
        chartSeconds ??= (performance.now() - started) / 1000;
        charts.push(event.chart);
      }
      if (event.type === "text") answer += event.text;
      if (event.type === "done") done = true;
    }
    assert.ok(done, "Stream did not complete");
    assert.equal(charts.length, testCase.kind ? 1 : 0, "Unexpected chart count");
    const [chart] = charts;
    if (chart) {
      assert.equal(chart.kind, testCase.kind);
      assert.deepEqual(chart.filters, testCase.filters);
      assert.deepEqual(measuredValues(chart), testCase.expected);
      assert.ok(chartSeconds !== undefined && chartSeconds < 5,
        `Correct chart arrived after ${chartSeconds?.toFixed(2)} seconds, above the 5 second target`);
      console.log(`${testCase.id}: ${chart.kind} passed, ${chartSeconds?.toFixed(2)} seconds to first chart`);
    } else {
      assert.match(answer, /no data is available/i);
      console.log(`${testCase.id}: no-data response passed, no chart expected`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${testCase.id}: ${message}`);
    process.exitCode = 1;
  }
}
