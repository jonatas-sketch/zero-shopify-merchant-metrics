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
const lastWeek = { startDate: "2025-10-20", endDate: "2025-10-26" };
const october = { startDate: "2025-10-01", endDate: "2025-10-27" };
const cases: Case[] = [
  {
    id: "Winter jackets",
    question: "Which winter jackets were returned last week?",
    kind: "ranking",
    filters: { ...lastWeek, category: "Winter Jackets", groupBy: "returnedProduct" },
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
    kind: "ranking",
    filters: { ...lastWeek, category: "Jackets", groupBy: "returnedProduct" },
    expected: [4, 4],
  },
  {
    id: "AQ-04",
    question: "are repeat customers growing since summer",
    kind: "metric",
    filters: defaultDates,
    expected: [4, 12],
  },
  {
    id: "AQ-05",
    question: "sales and returns on jackets last week",
    kind: "line",
    filters: { ...lastWeek, category: "Jackets" },
    expected: [356.10],
  },
  {
    id: "AQ-06",
    question: "top 5 hoodies in august",
    kind: "ranking",
    filters: { startDate: "2025-08-01", endDate: "2025-08-31", category: "Hoodies", limit: 5 },
    expected: [],
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
    id: "AQ-09",
    question: "how much did i make since labor day",
    kind: "line",
    filters: { startDate: "2025-09-01", endDate: "2025-10-26" },
    expected: [2310.15],
  },
  {
    id: "AQ-10",
    question: "how many ppl bought twice in october",
    kind: "metric",
    filters: october,
    expected: [4, 12],
  },
  {
    id: "AQ-11",
    question: "what's selling rn",
    kind: "ranking",
    filters: defaultDates,
    expected: [4, 4, 3],
  },
  {
    id: "AQ-12",
    question: "return rate on boots lately?",
    kind: "rate",
    filters: { ...defaultDates, category: "Boots", groupBy: "returnRate" },
    expected: [],
  },
  {
    id: "AQ-13",
    question: "revenue by wk recently",
    kind: "line",
    filters: { ...defaultDates, groupBy: "week" },
    expected: [2261.25],
  },
  {
    id: "AQ-14",
    question: "repeat buyers lately on beanies and scarves",
    kind: "metric",
    filters: { ...defaultDates, categories: ["Beanies", "Scarves"] },
    expected: [1, 2],
  },
  {
    id: "AQ-15",
    question: "which sweaters sell best",
    kind: "ranking",
    filters: { ...defaultDates, category: "Sweaters" },
    expected: [2],
  },
  {
    id: "AQ-16",
    question: "top return reasons for jakets in september",
    kind: "ranking",
    filters: { startDate: "2025-09-01", endDate: "2025-09-30", category: "Jackets", groupBy: "returnReason" },
    expected: [0, 0],
  },
  {
    id: "AQ-17",
    question: "whats my pos vs online split",
    kind: "ranking",
    filters: { ...defaultDates, channels: ["Online Store", "Point of Sale"], groupBy: "channel" },
    expected: [1413.10, 290],
  },
  {
    id: "AQ-18",
    question: "repeat customer share",
    kind: "metric",
    filters: defaultDates,
    expected: [4, 12],
  },
  {
    id: "AQ-19",
    question: "refunds been bad lately?",
    kind: "bars",
    filters: defaultDates,
    expected: [6, 6],
  },
  {
    id: "AQ-20",
    question: "how many fleece vests do i have left in stock",
  },
];

function measuredValues(chart: MetricChart) {
  const values = chart.points.map(({ value }) => value);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (chart.returns) return [total, chart.returns.length];
  if (chart.kind === "ranking") return values.slice(0, 3);
  if (chart.kind === "metric" || chart.kind === "rate") return values;
  return [Number(total.toFixed(2))];
}

function canonicalFilters(filters: MetricInput) {
  return {
    ...filters,
    ...(filters.channels ? { channels: [...filters.channels].sort() } : {}),
    ...(filters.categories ? { categories: [...filters.categories].sort() } : {}),
  };
}

const endpoint = new URL("/api/merchant/stream", process.argv[2] ?? "http://127.0.0.1:3000");
const selected = new Set(process.argv.slice(3));
const runCases = selected.size ? cases.filter(({ id }) => selected.has(id)) : cases;
assert.ok(runCases.length > 0 && (!selected.size || selected.size === runCases.length), "No matching acceptance checks");

for (const testCase of runCases) {
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
      assert.deepEqual(canonicalFilters(chart.filters), canonicalFilters(testCase.filters!));
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
