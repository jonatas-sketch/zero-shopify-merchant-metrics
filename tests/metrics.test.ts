import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDateRange } from "../lib/dates";
import { bestSellers, repeatCustomers, returns, sales } from "../lib/metrics";
import { parseStoreOrders } from "../lib/orders";

const fixture = [
  "order_id,line_item_id,order_date,customer_id,is_repeat_customer,product_id,product_title,product_category,quantity,line_total,returned,return_date,refund_amount",
  "a,a1,2025-10-19,c1,false,j,Jacket,Outerwear,1,10.00,true,2025-10-20,10.00",
  "b,b1,2025-10-20,c1,true,h,Hat,Accessories,2,6.00,false,,0.00",
  "b,b2,2025-10-20,c1,true,j,Jacket,Outerwear,1,9.99,true,2025-10-27,9.99",
  "c,c1,2025-10-26,c2,false,j,Jacket,Outerwear,1,7.00,false,,0.00",
].join("\n");

const orders = parseStoreOrders(fixture);
const lastWeek = resolveDateRange("last-week");

test("calendar dates use the exercise anchor and include both endpoints", () => {
  assert.deepEqual(lastWeek, { startDate: "2025-10-20", endDate: "2025-10-26" });
  assert.deepEqual(resolveDateRange("this-month"), { startDate: "2025-10-01", endDate: "2025-10-31" });
  assert.deepEqual(resolveDateRange("this-week"), { startDate: "2025-10-27", endDate: "2025-10-31" });
  assert.deepEqual(resolveDateRange("last-month", "2026-01-02"), { startDate: "2025-12-01", endDate: "2025-12-31" });
  assert.deepEqual(resolveDateRange("last-month", "2024-03-04"), { startDate: "2024-02-01", endDate: "2024-02-29" });
  assert.deepEqual(resolveDateRange(), { startDate: "2025-10-02", endDate: "2025-10-31" });
  assert.deepEqual(resolveDateRange("last-week", "2025-11-03"), { startDate: "2025-10-27", endDate: "2025-11-02" });
  assert.throws(() => sales(orders, { startDate: "2025-02-29", endDate: "2025-03-01" }));
  assert.throws(() => sales(orders, { startDate: "2025-03-02", endDate: "2025-03-01" }));
});

test("sales, product ranking and repeat customers group the right records", () => {
  assert.deepEqual(sales(orders, lastWeek), { salesCents: 2299, orders: 2 });
  assert.deepEqual(bestSellers(orders, lastWeek).map(({ productId, units }) => [productId, units]), [["j", 2], ["h", 2]]);
  assert.deepEqual(repeatCustomers(orders, lastWeek), { repeatCustomers: 1, totalCustomers: 2, repeatRate: 0.5 });
  assert.deepEqual(sales(orders, { ...lastWeek, product: "hAT" }), { salesCents: 600, orders: 1 });
});

test("returns use their own date and support filters", () => {
  assert.deepEqual(returns(orders, { ...lastWeek, category: "Outerwear" }), { returnedLines: 1, refundCents: 1000 });
  assert.deepEqual(returns(orders, { ...lastWeek, category: "Accessories" }), { returnedLines: 0, refundCents: 0 });
  assert.deepEqual(returns(orders, { startDate: "2025-10-27", endDate: "2025-10-27" }), { returnedLines: 1, refundCents: 999 });
});

test("empty periods return empty aggregates and duplicate lines are rejected", () => {
  const empty = { startDate: "2025-04-01", endDate: "2025-04-30" };
  assert.deepEqual(sales(orders, empty), { salesCents: 0, orders: 0 });
  assert.deepEqual(bestSellers(orders, empty), []);
  assert.deepEqual(returns(orders, empty), { returnedLines: 0, refundCents: 0 });
  assert.deepEqual(repeatCustomers(orders, empty), { repeatCustomers: 0, totalCustomers: 0, repeatRate: null });
  assert.throws(() => parseStoreOrders(fixture + "\n" + fixture.split("\n").at(-1)), /Duplicate order line/);
});
