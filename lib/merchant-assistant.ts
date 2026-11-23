import { generateText, stepCountIs, streamText, tool, type LanguageModel } from "ai";
import { metricInputSchema, REPORTING_DATE, resolveDateRange, type MetricInput } from "./dates";
import { bestSellers, repeatCustomers, returnedLinesByDay, returns, sales, salesByDay } from "./metrics";
import type { OrderLine } from "./orders";
import type { MerchantStreamEvent, MetricChart } from "./merchant-stream";

function metricTool<Name extends string, T>(
  orders: readonly OrderLine[],
  name: Name,
  description: string,
  calculate: (orders: readonly OrderLine[], input: MetricInput) => T,
) {
  return tool({
    description,
    inputSchema: metricInputSchema,
    execute: async (input) => {
      const filters = metricInputSchema.parse(input);
      return { metric: name, filters, value: calculate(orders, filters) };
    },
  });
}

const presets = {
  "last week": resolveDateRange("last-week"),
  "this week": resolveDateRange("this-week"),
  "this month": resolveDateRange("this-month"),
  "last month": resolveDateRange("last-month"),
  "no date": resolveDateRange(),
};

const instruction = [
  "You answer merchant questions using the sample order history and the available tools.",
  "Translate the question into a supported metric. Use multiple calls when asked to compare periods or metrics.",
  "Use exact inclusive ISO dates. The reporting date is " + REPORTING_DATE + ".",
  "Use these exact date ranges for relative phrases: " + JSON.stringify(presets) + ".",
  "Product is an exact product ID or title. Category is an exact category. Omit filters that the merchant did not specify.",
  "When a filter is ambiguous, ask for the product title or category instead of guessing. Never remove a requested filter to get more results.",
  "Only use tool results as the source for quantities, totals, and the date range.",
  "Monetary values from tools are integer cents. Convert them to decimal amounts and do not infer a currency.",
  "Include the date range in the answer. Distinguish an empty result from a larger result that lacks a matching filter.",
  "If the question is unsupported, explain that sales, best sellers, returned lines and repeat customers are available.",
].join("\n");

const fallback = "Ask about sales, best-selling products, returned order lines, or repeat customers. You can specify a date range or an exact product or category.";

function merchantParameters(
  question: string,
  orders: readonly OrderLine[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
) {
  const tools = {
    sales: metricTool(orders, "sales", "Return sales after discounts in cents and distinct order count by order date. Refunds are a separate return metric.", sales),
    bestSellers: metricTool(orders, "bestSellers", "Rank products by quantity sold by order date, using sales cents and product ID as tiebreakers.", bestSellers),
    returns: metricTool(orders, "returns", "Count returned order lines and refund cents by return date. Does not report units returned.", returns),
    repeatCustomers: metricTool(orders, "repeatCustomers", "Count distinct repeat and total customers by order date, and return their ratio when there are customers.", repeatCustomers),
  };

  return {
    model,
    system: instruction,
    prompt: question,
    tools,
    stopWhen: stepCountIs(4),
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
        title: "Sales by order date",
        measure: "Amount after discounts",
        filters,
        points: salesByDay(orders, filters).map(([label, cents]) => ({ label, value: cents / 100 })),
      };
    case "bestSellers":
      return {
        title: "Best-selling products",
        measure: "Units sold",
        filters,
        horizontal: true,
        points: result.value.map(({ name, units, productId }) => ({ label: name, id: productId, value: units })),
      };
    case "returns":
      return {
        title: "Returned lines by return date",
        measure: "Returned lines",
        filters,
        points: returnedLinesByDay(orders, filters).map(([label, value]) => ({ label, value })),
      };
    case "repeatCustomers": {
      const { repeatCustomers: repeat, totalCustomers } = result.value;
      return {
        title: "Repeat customers",
        measure: "Customers",
        filters,
        points: totalCustomers ? [
          { label: "Repeat", value: repeat },
          { label: "Other", value: totalCustomers - repeat },
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
