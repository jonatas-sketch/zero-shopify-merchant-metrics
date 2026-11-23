import { metricInputSchema, resolveDateRange } from "../lib/dates";
import { bestSellers, repeatCustomers, returns, sales } from "../lib/metrics";
import { loadStoreOrders } from "../lib/orders";

export const dynamic = "force-dynamic";

function amount(cents: number) {
  return (cents / 100).toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const params = await searchParams;
  const defaults = resolveDateRange();
  const input = metricInputSchema.safeParse({
    startDate: params.startDate ?? defaults.startDate,
    endDate: params.endDate ?? defaults.endDate,
  });

  return (
    <main>
      <h1>Merchant metrics</h1>
      <form>
        <label>Start date <input type="date" name="startDate" defaultValue={params.startDate ?? defaults.startDate} required /></label>
        <label>End date <input type="date" name="endDate" defaultValue={params.endDate ?? defaults.endDate} required /></label>
        <button>Apply range</button>
      </form>
      {input.success
        ? <Summary range={input.data} />
        : <p role="alert">Enter a valid start and end date in chronological order.</p>}
    </main>
  );
}

async function Summary({ range }: { range: ReturnType<typeof metricInputSchema.parse> }) {
  const orders = await loadStoreOrders();
  const salesTotal = sales(orders, range);
  const returned = returns(orders, range);
  const repeat = repeatCustomers(orders, range);
  const products = bestSellers(orders, range);

  return (
    <>
      <dl>
        <div><dt>Sales after discounts</dt><dd>{amount(salesTotal.salesCents)}</dd></div>
        <div><dt>Returned order lines</dt><dd>{returned.returnedLines}</dd></div>
        <div><dt>Refunds issued</dt><dd>{amount(returned.refundCents)}</dd></div>
        <div><dt>Repeat customers</dt><dd>{repeat.repeatCustomers} of {repeat.totalCustomers}</dd></div>
      </dl>
      <h2>Best sellers</h2>
      {products.length === 0
        ? <p>There are no orders in this period.</p>
        : <table>
            <thead><tr><th scope="col">Product</th><th scope="col">Units</th><th scope="col">Sales</th></tr></thead>
            <tbody>{products.map((item) => <tr key={item.productId}><th scope="row">{item.name}</th><td>{item.units}</td><td>{amount(item.salesCents)}</td></tr>)}</tbody>
          </table>}
    </>
  );
}
