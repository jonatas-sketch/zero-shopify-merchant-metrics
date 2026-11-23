import { metricInputSchema, type MetricInput } from "./dates";
import type { OrderLine } from "./orders";

type DateColumn = "order_date" | "return_date";
type ProductRanking = { productId: string; name: string; units: number; salesCents: number };
const apparelGroups = {
  jackets: { from: "outerwear", pattern: /\b(jacket|parka|shell)\b/i },
  "winter jackets": { from: "outerwear", pattern: /\b(insulated jacket|down parka)\b/i },
  sweaters: { from: "knitwear", pattern: /\bsweater\b/i },
  beanies: { from: "accessories", pattern: /\bbeanie\b/i },
  scarves: { from: "accessories", pattern: /\b(scarf|scarves)\b/i },
};

function matchesCategory(row: OrderLine, category: string) {
  const actual = row.product_category.toLowerCase();
  if (category === actual) return true;
  if (!Object.hasOwn(apparelGroups, category)) return false;
  const group = apparelGroups[category as keyof typeof apparelGroups];
  return group.from === actual && group.pattern.test(row.product_title);
}

function eligibleOrders(
  orders: readonly OrderLine[],
  input: MetricInput,
  dateColumn: DateColumn,
) {
  const dateRange = metricInputSchema.parse(input);
  const product = dateRange.product?.toLowerCase();
  const categories = (dateRange.categories ?? (dateRange.category ? [dateRange.category] : [])).map(
    (category) => category.toLowerCase(),
  );
  const channels = (dateRange.channels ?? (dateRange.channel ? [dateRange.channel] : [])).map(
    (channel) => channel.toLowerCase(),
  );

  return orders.filter((row) => {
    const date = row[dateColumn];
    const matchesProduct = !product ||
      product === row.product_id.toLowerCase() ||
      product === row.product_title.toLowerCase();
    const categoryMatches = categories.length === 0 || categories.some((category) => matchesCategory(row, category));
    const matchesChannel = channels.length === 0 || channels.includes(row.sales_channel?.toLowerCase() ?? "");
    return date >= dateRange.startDate && date <= dateRange.endDate &&
      matchesProduct && categoryMatches && matchesChannel;
  });
}

export function sales(orders: readonly OrderLine[], input: MetricInput) {
  const eligible = eligibleOrders(orders, input, "order_date");
  return {
    salesCents: eligible.reduce((sum, line) => sum + line.line_total, 0),
    orders: new Set(eligible.map((line) => line.order_id)).size,
  };
}

export function salesByDay(orders: readonly OrderLine[], input: MetricInput) {
  const totals = new Map<string, number>();
  for (const row of eligibleOrders(orders, input, "order_date")) {
    totals.set(row.order_date, (totals.get(row.order_date) ?? 0) + row.line_total);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
}

export function salesBreakdown(orders: readonly OrderLine[], input: MetricInput) {
  if (input.groupBy !== "week" && input.groupBy !== "channel") return undefined;
  const totals = new Map<string, number>();
  for (const row of eligibleOrders(orders, input, "order_date")) {
    let label = row.sales_channel || "Unknown channel";
    if (input.groupBy === "week") {
      const day = new Date(row.order_date);
      day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
      const monday = day.toISOString().slice(0, 10);
      label = monday < input.startDate ? input.startDate : monday;
    }
    totals.set(label, (totals.get(label) ?? 0) + row.line_total);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
}

export function bestSellers(orders: readonly OrderLine[], input: MetricInput) {
  const products = new Map<string, ProductRanking>();
  for (const line of eligibleOrders(orders, input, "order_date")) {
    const product = products.get(line.product_id) ?? {
      productId: line.product_id,
      name: line.product_title,
      units: 0,
      salesCents: 0,
    };
    product.units += line.quantity;
    product.salesCents += line.line_total;
    products.set(product.productId, product);
  }

  const ranking = [...products.values()].sort((a, b) =>
    b.units - a.units || b.salesCents - a.salesCents || a.productId.localeCompare(b.productId)
  );
  return input.limit === undefined ? ranking : ranking.slice(0, input.limit);
}

export function returnBreakdown(orders: readonly OrderLine[], input: MetricInput) {
  if (input.groupBy !== "returnReason" && input.groupBy !== "returnedProduct") return undefined;
  const totals = new Map<string, number>();
  for (const row of eligibleOrders(orders, input, "return_date")) {
    const label = input.groupBy === "returnReason" ? row.return_reason || "Unavailable" : row.product_title;
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }
  return [...totals].sort(([a, first], [b, second]) => second - first || a.localeCompare(b));
}

export function orderLineReturnRate(orders: readonly OrderLine[], input: MetricInput) {
  const cohort = eligibleOrders(orders, input, "order_date");
  const returned = cohort.filter((row) => row.returned && row.return_date <= input.endDate).length;
  return { returned, total: cohort.length };
}

export function returns(orders: readonly OrderLine[], input: MetricInput) {
  const returnedLines = eligibleOrders(orders, input, "return_date");
  return {
    returnedLines: returnedLines.length,
    refundCents: returnedLines.reduce((sum, line) => sum + line.refund_amount, 0),
  };
}

export function returnedLinesByDay(orders: readonly OrderLine[], input: MetricInput) {
  const totals = new Map<string, number>();
  for (const row of eligibleOrders(orders, input, "return_date")) {
    totals.set(row.return_date, (totals.get(row.return_date) ?? 0) + 1);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
}

export function returnedLineDetails(orders: readonly OrderLine[], input: MetricInput) {
  return eligibleOrders(orders, input, "return_date")
    .map((row) => ({
      product: row.product_title,
      variant: row.variant || null,
      returnedOn: row.return_date,
      reason: row.return_reason || null,
      refundCents: row.refund_amount,
    }))
    .sort((a, b) => a.returnedOn.localeCompare(b.returnedOn) || a.product.localeCompare(b.product));
}

export function repeatCustomers(orders: readonly OrderLine[], input: MetricInput) {
  const eligible = eligibleOrders(orders, input, "order_date");
  const customers = new Set(eligible.map((row) => row.customer_id));
  const repeats = new Set(eligible.filter((row) => row.is_repeat_customer).map((row) => row.customer_id));
  return {
    repeatCustomers: repeats.size,
    totalCustomers: customers.size,
    repeatRate: customers.size ? repeats.size / customers.size : null,
  };
}
