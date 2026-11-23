import { generateText, stepCountIs, tool, type LanguageModel } from "ai";
import { metricInputSchema, REPORTING_DATE, resolveDateRange, type MetricInput } from "./dates";
import { bestSellers, repeatCustomers, returns, sales } from "./metrics";
import type { OrderLine } from "./orders";

function metricTool<T>(
  orders: readonly OrderLine[],
  description: string,
  calculate: (orders: readonly OrderLine[], input: MetricInput) => T,
) {
  return tool({
    description,
    inputSchema: metricInputSchema,
    execute: async (input) => {
      const filters = metricInputSchema.parse(input);
      return { filters, value: calculate(orders, filters) };
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

export async function answerMerchantQuestion(
  question: string,
  orders: readonly OrderLine[],
  model: LanguageModel,
  abortSignal?: AbortSignal,
) {
  const tools = {
    sales: metricTool(orders, "Return sales after discounts in cents and distinct order count by order date. Refunds are a separate return metric.", sales),
    bestSellers: metricTool(orders, "Rank products by quantity sold by order date, using sales cents and product ID as tiebreakers.", bestSellers),
    returns: metricTool(orders, "Count returned order lines and refund cents by return date. Does not report units returned.", returns),
    repeatCustomers: metricTool(orders, "Count distinct repeat and total customers by order date, and return their ratio when there are customers.", repeatCustomers),
  };

  const result = await generateText({
    model,
    system: instruction,
    prompt: question,
    tools,
    stopWhen: stepCountIs(4),
    maxRetries: 0,
    maxOutputTokens: 600,
    abortSignal,
  });

  const metrics = result.steps.flatMap((step) =>
    step.staticToolResults.map(({ toolName, output }) => ({ metric: toolName, ...output })),
  );

  if (metrics.length === 0) {
    return {
      answer: "Ask about sales, best-selling products, returned order lines, or repeat customers. You can specify a date range or an exact product or category.",
      metrics,
    };
  }

  return { answer: result.text || "Here are the results from the order history.", metrics };
}
