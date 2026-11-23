import { generateText, stepCountIs, streamText, tool, type LanguageModel } from "ai";
import { metricInputSchema, REPORTING_DATE, resolveDateRange, type MetricInput } from "./dates";
import { bestSellers, orderLineReturnRate, repeatCustomers, returnBreakdown, returnedLineDetails, returnedLinesByDay, returns, sales, salesBreakdown, salesByDay } from "./metrics";
import type { OrderLine } from "./orders";
import type { MerchantStreamEvent, MetricChart } from "./merchant-stream";

const relativePeriod = /\b(?:(?:last|this|past|previous|next)\s+(?:week|month|quarter|year|fortnight)|today|yesterday|labor day|[a-z]+ to date|(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|months?|quarters?|years?))\b/i;
const namedDate = /\b(?:\d{4}|\d{1,2}[./-]\d{1,2}|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const rankingCount = /\b(?:top|first|best)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const apparelCategories = ["Boots", "Hoodies", "Jackets", "Winter Jackets", "Sweaters", "Beanies", "Scarves"];
const salesChannels = [
  ["Online Store", /\bonline(?: store)?\b/i],
  ["Point of Sale", /\b(?:pos|point of sale)\b/i],
  ["Shop App", /\bshop app\b/i],
  ["Instagram", /\binstagram\b/i],
] as const;

function hasExplicitPeriod(question: string) {
  return relativePeriod.test(question) || namedDate.test(question);
}

function metricTool<Name extends string, T>(
  question: string,
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
      if (!hasExplicitPeriod(question)) {
        Object.assign(filters, resolveDateRange());
      }
      if (filters.limit && !rankingCount.test(question)) delete filters.limit;
      if (!filters.category && !filters.categories && filters.product) {
        const category = apparelCategories.find((label) => label.toLowerCase() === filters.product?.toLowerCase());
        if (category) {
          filters.category = category;
          delete filters.product;
        }
      }
      if (name === "returns") {
        if (isReturnRateQuestion(question)) filters.groupBy = "returnRate";
        else if (filters.groupBy === "returnRate") delete filters.groupBy;
      }
      if (name === "sales") {
        const channels = salesChannels.filter(([, pattern]) => pattern.test(question)).map(([label]) => label);
        if (channels.length > 1) {
          filters.channels = channels;
          delete filters.channel;
          if (/\b(?:split|vs|versus|by channel)\b/i.test(question)) filters.groupBy = "channel";
        }
      }
      reserveMetricCall();
      return { metric: name, filters, value: calculate(orders, filters) };
    },
  });
}

function isReturnRateQuestion(question: string) {
  return /\breturns? rates?\b|\b(?:percentage|share) of [^.?!]{1,50}\breturned\b/i.test(question);
}

const explicitIntents = [
  ["repeatCustomers", /\brepeat (?:customers?|buyers?)\b|\bbought (?:twice|again)\b|\bcustomers? (?:came|come) back\b/i],
  ["sales", /\b(?:sales|revenue|how much did (?:we|i) (?:make|sell)|pos vs online)\b/i],
  ["returns", /\b(?:returns?|returned|refunds?|refunded|came back)\b/i],
  ["bestSellers", /\b(?:best[- ]sell(?:ers?|ing)|top \d+|what(?:'s| is) selling|sell best)\b/i],
] as const;

function explicitMetric(question: string) {
  if (/\b(?:ad spend|inventory|left in stock|are in stock)\b/i.test(question)) return undefined;
  return explicitIntents
    .map(([toolName, pattern]) => ({ toolName, index: question.search(pattern) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index)[0]?.toolName;
}

function metricPrompt(question: string, firstTool: ReturnType<typeof explicitMetric>) {
  const original = " Original merchant question: " + question;
  if (firstTool === "repeatCustomers" && !hasExplicitPeriod(question) &&
    /\b(?:grow(?:ing|th)?|trend|increas(?:e|ing)|declin(?:e|ing))\b/i.test(question)) {
    return "Show repeat customer share for the default period. Explain that one period cannot establish growth." + original;
  }
  if ((firstTool === "sales" || firstTool === "returns") &&
    /\b(?:(?:sales|revenue)\s*(?:and|&|plus)\s*(?:returns|refunds)|(?:returns|refunds)\s*(?:and|&|plus)\s*(?:sales|revenue))\b/i.test(question)) {
    return `Show the ${firstTool} report using the merchant's period and filters. Explain that the dashboard displays one report at a time.` + original;
  }
  return question;
}

const presets = {
  "last week": resolveDateRange("last-week"),
  "this week": resolveDateRange("this-week"),
  "this month": resolveDateRange("this-month"),
  "last month": resolveDateRange("last-month"),
  "last 30 days": resolveDateRange("completed-30-days"),
  "since Labor Day": resolveDateRange("since-labor-day"),
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
  "For an earlier named month without a year, use that full month of the reporting year.",
  "Product is an exact product ID or title. Category is an exact category. Omit filters that the merchant did not specify.",
  "Use the category Jackets for jackets and Winter Jackets for winter jackets. These are apparel groups in the dashboard. Use channel Online Store or Point of Sale when the question filters to that channel.",
  "Set limit only if a specific count is explicitly requested for a ranked list. Use plural categories or channels for explicitly requested lists. Keep plausible named apparel categories even if they have no matching data. Use canonical names such as Boots, Hoodies, Sweaters, Beanies, and Scarves. Correct obvious apparel typos.",
  "For sales by week set groupBy to week. For sales split by channel set groupBy to channel and include only the requested channels.",
  "For return counts by product set groupBy to returnedProduct. For return reasons set groupBy to returnReason. For return rate set groupBy to returnRate, which measures returned order lines out of order lines placed in the date range.",
  "When a filter is ambiguous, ask for the product title or category instead of guessing. Never remove a requested filter to get more results.",
  "Only use tool results as the source for quantities, totals, and the date range.",
  "Monetary values from tools are integer cents. Convert them to decimal amounts and do not infer a currency.",
  "Include the date range in the answer. Distinguish an empty result from a larger result that lacks a matching filter.",
  "Use plain text without Markdown formatting. Counts of returned lines are not quantities of returned items.",
  "For requests for individual returns, select the returns tool with the requested dates and any exact product or category. For any breakdown, use only totals from tool output and direct merchants to the chart for details. Do not invent variants or reasons.",
  "If the requested breakdown, ranking, or metric is unavailable, do not substitute another calculation.",
  "Inventory stock and ad spend are unavailable. Do not call a tool for those questions.",
  "Treat casual phrases about those who bought again or twice as the repeat customer report. Count people marked repeat in the source. Do not say that each placed exactly two orders.",
  "For vague repeat-customer growth questions use the default period's repeat share and explain that one period does not establish growth.",
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
      question, orders, "sales",
      "How much did we sell, and how many orders did we get? Total sales after discounts and distinct orders in one window. Dates refer to when the order was placed. Sales amounts are in cents.",
      sales, reserveMetricCall,
    ),
    bestSellers: metricTool(
      question, orders, "bestSellers",
      "What products sold the most? Rank by units sold in one window using order dates. Ties use sales amount followed by product ID. Sales amounts are in cents.",
      bestSellers, reserveMetricCall,
    ),
    returns: metricTool(
      question, orders, "returns",
      "How many order lines came back, how much did we refund, or what was the return rate? Use this for return counts and breakdowns by reason or product. Return rate uses the original order cohort. Refund amounts are in cents.",
      (data, filters) => ({ ...returns(data, filters), ...(filters.groupBy === "returnRate" ? {
        cohort: orderLineReturnRate(data, filters),
      } : {}) }), reserveMetricCall,
    ),
    repeatCustomers: metricTool(
      question, orders, "repeatCustomers",
      "How many customers came back? Count distinct repeat customers and give their share of all customers who placed an order in one window.",
      repeatCustomers, reserveMetricCall,
    ),
  };
  const firstTool = explicitMetric(question);

  return {
    model,
    system: instruction,
    prompt: metricPrompt(question, firstTool),
    tools,
    stopWhen: stepCountIs(2),
    prepareStep: ({ stepNumber }: { stepNumber: number }) => {
      if (stepNumber !== 0) return { toolChoice: "none" as const };
      if (firstTool) return { toolChoice: { type: "tool", toolName: firstTool } as const };
    },
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
    case "sales": {
      const breakdown = salesBreakdown(orders, filters);
      const byChannel = filters.groupBy === "channel";
      const salesPoints = breakdown ?? salesByDay(orders, filters);
      return {
        kind: byChannel ? "ranking" : "line",
        title: byChannel ? "Sales by channel" : filters.groupBy === "week" ? "Weekly sales" : "Sales by order date",
        measure: "Amount after discounts",
        filters,
        points: salesPoints.map(([label, cents]) => ({ label, value: cents / 100 })),
      };
    }
    case "bestSellers":
      return {
        kind: "ranking",
        title: "Best-selling products",
        measure: "Units sold",
        filters,
        points: result.value.map(({ name, units, productId }) => ({ label: name, id: productId, value: units })),
      };
    case "returns": {
      if (result.value.cohort) {
        const { returned, total } = result.value.cohort;
        return {
          kind: "rate",
          title: "Order line return rate",
          measure: "Order lines",
          filters,
          points: total ? [
            { label: "Returned through the end of the period", value: returned },
            { label: "Order lines placed in the period", value: total },
          ] : [],
        };
      }
      const breakdown = returnBreakdown(orders, filters);
      return {
        kind: breakdown ? "ranking" : "bars",
        title: breakdown ? filters.groupBy === "returnReason" ? "Returns by reason" : "Returns by product" :
          "Returned lines by return date",
        measure: "Returned lines",
        filters,
        points: (breakdown ?? returnedLinesByDay(orders, filters)).map(([label, value]) => ({ label, value })),
        returns: returnedLineDetails(orders, filters),
      };
    }
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
