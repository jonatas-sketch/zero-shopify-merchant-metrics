import { generateText, stepCountIs, streamText, tool, type LanguageModel } from "ai";
import { metricInputSchema, REPORTING_DATE, resolveDateRange, type MetricInput } from "./dates";
import { bestSellers, repeatCustomers, returnedLineDetails, returnedLinesByDay, returns, sales, salesByDay } from "./metrics";
import type { OrderLine } from "./orders";
import type { MerchantStreamEvent, MetricChart } from "./merchant-stream";

function metricTool<Name extends string, T>(
  orders: readonly OrderLine[],
  name: Name,
  description: string,
  calculate: (orders: readonly OrderLine[], input: MetricInput) => T,
  reserveMetricCall: () => void,
) {
  return tool({
    description,
    inputSchema: metricInputSchema,
    execute: async (input) => {
      const filters = metricInputSchema.parse(input);
      reserveMetricCall();
      return { metric: name, filters, value: calculate(orders, filters) };
    },
  });
}

const presets = {
  "last week": resolveDateRange("last-week"),
  "this week": resolveDateRange("this-week"),
  "this month": resolveDateRange("this-month"),
  "last month": resolveDateRange("last-month"),
  "last 30 days": resolveDateRange("completed-30-days"),
  "no date": resolveDateRange(),
};

const instruction = [
  "You answer merchant questions using the sample order history and the available tools.",
  "Choose one supported metric and make exactly one tool call for an unambiguous supported question.",
  "For multiple available metrics in one range, use the first metric requested and explain that the dashboard shows one report at a time. For multiple date windows, ask for one at a time without calling tools.",
  "Use exact inclusive ISO dates. The reporting date is " + REPORTING_DATE + ".",
  "Use these exact date ranges for relative phrases: " + JSON.stringify(presets) + ".",
  "For vague dates such as lately, this season, right now, or no dates, use the no-date range and include it in the answer.",
  "A broad request about sales, top products, returns or repeat customers is supported even with no dates or filters. Call the corresponding tool.",
  "For October without a year, use the this-month range, with its reporting cutoff.",
  "Product is an exact product ID or title. Category is an exact category. Omit filters that the merchant did not specify.",
  "Use the category Jackets for jackets and Winter Jackets for winter jackets. These are apparel groups in the dashboard. Use channel Online Store or Point of Sale when the question filters to that channel.",
  "When a filter is ambiguous, ask for the product title or category instead of guessing. Never remove a requested filter to get more results.",
  "Only use tool results as the source for quantities, totals, and the date range.",
  "Monetary values from tools are integer cents. Convert them to decimal amounts and do not infer a currency.",
  "Include the date range in the answer. Distinguish an empty result from a larger result that lacks a matching filter.",
  "Use plain text without Markdown formatting. Counts of returned lines are not quantities of returned items.",
  "For requests for individual returns, select the returns tool with the requested dates and any exact product or category. Give the aggregate result and direct the merchant to the dashboard table for line details. Do not invent variants or reasons.",
  "If the requested breakdown, ranking, or metric is unavailable, do not substitute another calculation.",
  "Inventory stock and ad spend are unavailable. Do not call a tool for those questions.",
  "Treat casual phrases about those who bought again or twice as the repeat customer report. Count people marked repeat in the source. Do not say that each placed exactly two orders.",
].join("\n");

const fallback = "No data is available for that request as asked. I can look up sales, products ranked by units sold, returned order lines, or repeat customers. Choose one metric and one date range. Use the exact product, category, or sales channel if you want to filter.";

function merchantParameters(
  question: string,
  orders: readonly OrderLine[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
) {
  let metricCalled = false;
  function reserveMetricCall() {
    if (metricCalled) throw new Error("Only one metric call is allowed per question.");
    metricCalled = true;
  }

  const tools = {
    sales: metricTool(
      orders, "sales",
      "How much did we sell, and how many orders did we get? Total sales after discounts and distinct orders in one window. Dates refer to when the order was placed. Sales amounts are in cents.",
      sales, reserveMetricCall,
    ),
    bestSellers: metricTool(
      orders, "bestSellers",
      "What products sold the most? Rank by units sold in one window using order dates. Ties use sales amount followed by product ID. Sales amounts are in cents.",
      bestSellers, reserveMetricCall,
    ),
    returns: metricTool(
      orders, "returns",
      "How many jacket order lines came back last week, and how much did we refund? Count returned order lines and total refunds in one window using the return dates. An exact product or category can narrow the totals. Refund amounts are in cents.",
      returns, reserveMetricCall,
    ),
    repeatCustomers: metricTool(
      orders, "repeatCustomers",
      "How many customers came back? Count distinct repeat customers and give their share of all customers who placed an order in one window.",
      repeatCustomers, reserveMetricCall,
    ),
  };

  return {
    model,
    system: instruction,
    prompt: question,
    tools,
    stopWhen: stepCountIs(2),
    prepareStep: ({ stepNumber }: { stepNumber: number }) =>
      stepNumber === 0 ? undefined : { toolChoice: "none" as const },
    maxRetries: 0,
    maxOutputTokens: 600,
    abortSignal,
  };
}

export async function answerMerchantQuestion(
  question: string,
  orders: readonly OrderLine[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
) {
  const result = await generateText(merchantParameters(question, orders, model, abortSignal));
  const metrics = result.steps.flatMap((step) =>
    step.staticToolResults.map(({ output }) => output),
  );

  if (metrics.length === 0) {
    return { answer: fallback, metrics };
  }

  return { answer: result.text || "Here are the results from the order history.", metrics };
}

type MetricResult = Awaited<ReturnType<typeof answerMerchantQuestion>>["metrics"][number];

function chartFor(orders: readonly OrderLine[], result: MetricResult): MetricChart {
  const filters = result.filters;
  switch (result.metric) {
    case "sales":
      return {
        kind: "line",
        title: "Sales by order date",
        measure: "Amount after discounts",
        filters,
        points: salesByDay(orders, filters).map(([label, cents]) => ({ label, value: cents / 100 })),
      };
    case "bestSellers":
      return {
        kind: "ranking",
        title: "Best-selling products",
        measure: "Units sold",
        filters,
        points: result.value.map(({ name, units, productId }) => ({ label: name, id: productId, value: units })),
      };
    case "returns":
      return {
        kind: "bars",
        title: "Returned lines by return date",
        measure: "Returned lines",
        filters,
        points: returnedLinesByDay(orders, filters).map(([label, value]) => ({ label, value })),
        returns: returnedLineDetails(orders, filters),
      };
    case "repeatCustomers": {
      const { repeatCustomers: repeat, totalCustomers } = result.value;
      return {
        kind: "metric",
        title: "Repeat customers",
        measure: "Customers",
        filters,
        points: totalCustomers ? [
          { label: "Repeat customers", value: repeat },
          { label: "All customers", value: totalCustomers },
        ] : [],
      };
    }
  }
}

export async function* streamMerchantQuestion(
  question: string,
  orders: readonly OrderLine[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
): AsyncGenerator<MerchantStreamEvent, void> {
  const { fullStream } = streamText(merchantParameters(question, orders, model, abortSignal));
  let hasMetric = false;
  let hasAnswer = false;
  for await (const part of fullStream) {
    if (part.type === "tool-result" && !part.dynamic) {
      hasMetric = true;
      yield { type: "chart", id: part.toolCallId, chart: chartFor(orders, part.output) };
    } else if (part.type === "text-delta" && hasMetric) {
      hasAnswer ||= Boolean(part.text.trim());
      yield { type: "text", text: part.text };
    } else if (part.type === "error" || part.type === "abort") {
      yield { type: "error", message: "The response was interrupted. Try asking again." };
      return;
    }
  }
  if (!hasAnswer) {
    yield { type: "text", text: hasMetric ? "Here are the results from the order history." : fallback };
  }
  yield { type: "done" };
}
