import { resolveDateRange } from "../lib/dates";
import { bestSellers, repeatCustomers, returns, sales } from "../lib/metrics";
import { loadStoreOrders } from "../lib/orders";

const orders = await loadStoreOrders();
const period = resolveDateRange("this-month");
console.log(JSON.stringify({
  period,
  sales: sales(orders, period),
  bestSellers: bestSellers(orders, period),
  returns: returns(orders, period),
  repeatCustomers: repeatCustomers(orders, period),
}, null, 2));
