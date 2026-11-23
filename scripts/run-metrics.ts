import { datePresetSchema, resolveDateRange } from "../lib/dates";
import { bestSellers, repeatCustomers, returns, sales } from "../lib/metrics";
import { loadStoreOrders } from "../lib/orders";

const preset = datePresetSchema.parse(process.argv[2] ?? "this-month");
const period = resolveDateRange(preset);
const orders = await loadStoreOrders();
console.log(JSON.stringify({
  period,
  sales: sales(orders, period),
  bestSellers: bestSellers(orders, period),
  returns: returns(orders, period),
  repeatCustomers: repeatCustomers(orders, period),
}, null, 2));
