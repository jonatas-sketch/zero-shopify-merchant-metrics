import { metricInputSchema, type MetricInput } from "./dates";
import type { OrderLine } from "./orders";

type DateColumn = "order_date" | "return_date";
type ProductRanking = { productId: string; name: string; units: number; salesCents: number };
const outerwearAliases = {
  jackets: /\b(jacket|parka|shell)\b/i,
  "winter jackets": /\b(insulated jacket|down parka)\b/i,
};

function eligibleOrders(
  orders: readonly OrderLine[],
  input: MetricInput,
  dateColumn: DateColumn,
) {
  const dateRange = metricInputSchema.parse(input);
  const product = dateRange.product?.toLowerCase();
  const category = dateRange.category?.toLowerCase();
  const channel = dateRange.channel?.toLowerCase();
  const outerwearAlias = category && Object.hasOwn(outerwearAliases, category)
    ? outerwearAliases[category as keyof typeof outerwearAliases]
    : undefined;

  return orders.filter((row) => {
    const date = row[dateColumn];
    const matchesProduct = !product ||
      product === row.product_id.toLowerCase() ||
      product === row.product_title.toLowerCase();
    const productCategory = row.product_category.toLowerCase();
    const matchesCategory = !category || category === productCategory ||
      (productCategory === "outerwear" && outerwearAlias?.test(row.product_title));
    const matchesChannel = !channel || channel === row.sales_channel?.toLowerCase();
    return date >= dateRange.startDate && date <= dateRange.endDate &&
      matchesProduct && matchesCategory && matchesChannel;
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

  return [...products.values()].sort((a, b) =>
    b.units - a.units || b.salesCents - a.salesCents || a.productId.localeCompare(b.productId)
  );
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
