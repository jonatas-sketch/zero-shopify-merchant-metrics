# Merchant metrics

A Next.js App Router exercise using the order history supplied in the Shopify scenario. Stage 1 implements four metric functions and a date resolver.

## Run with the course CSV

Copy the CSV from the Zero brief to `data/store-orders.csv` or point `SHOPIFY_ORDER_CSV` to a local copy. The CSV is kept out of version control.

```sh
npm ci
npm test
npm run --silent metrics -- last-week
npm run dev
```

## Metric definitions

| Function | Date field | Calculation |
| --- | --- | --- |
| `sales` | `order_date` | Sum line totals after discounts in integer cents. Count distinct orders. |
| `bestSellers` | `order_date` | Group by product ID and rank by sold units, then revenue and product ID. |
| `returns` | `return_date` | Count returned order lines and sum refunds. The CSV does not report units returned. |
| `repeatCustomers` | `order_date` | Count distinct customers and those flagged as repeat. Use an unavailable rate when there are no customers. |

All metric inputs use inclusive ISO dates and accept optional exact product IDs or titles, categories, and sales channels. The Jackets and Winter Jackets groups match garment names within Outerwear. Sales and refunds are tracked separately because their reporting dates differ.

The stage 1 submission used 2025-10-31 as its exercise anchor. The dashboard acceptance branch uses 2025-10-27, the cutoff in the acceptance workbook and the latest order date in the sample. The resolver uses calendar dates in UTC and weeks begin on Monday.

| Question uses | Inclusive range at this anchor |
| --- | --- |
| Last week | October 20–26 |
| This week | October 27 |
| This month | October 1–27 |
| Last month | September 1–30 |
| Last 30 completed days | September 27–October 26 |
| No date or vague date | September 28–October 27 |

## Prompt and review

The instruction proposed to Erik was to create a Next.js App Router project in TypeScript, validate the CSV server-side and write one pure function per metric with inclusive dates and optional product filters. The instruction also specified integer cents, a separate date resolver and tests for boundary dates and empty ranges.

During implementation, the returns function was verified against the date of the return and reports returned lines because the CSV does not state returned quantities. Repeat customers are deduplicated by customer ID to avoid counting an order with multiple items more than once.

## Verified last-week run

`npm run --silent metrics -- last-week` produced the following output for October 20–26. The results below preserve the four calculations and exclude order-level and customer-level rows.

```json
{
  "period": { "startDate": "2025-10-20", "endDate": "2025-10-26" },
  "sales": { "salesCents": 54350, "orders": 4 },
  "bestSellers": [
    { "productId": "P-1010", "name": "Wool Beanie", "units": 3, "salesCents": 7200 },
    { "productId": "P-1001", "name": "Alpine Down Parka", "units": 1, "salesCents": 19710 },
    { "productId": "P-1002", "name": "Northridge Insulated Jacket", "units": 1, "salesCents": 15900 },
    { "productId": "P-1009", "name": "Utility Chino", "units": 1, "salesCents": 7400 },
    { "productId": "P-1011", "name": "Leather Gloves", "units": 1, "salesCents": 4140 }
  ],
  "returns": { "returnedLines": 4, "refundCents": 79215 },
  "repeatCustomers": { "repeatCustomers": 2, "totalCustomers": 4, "repeatRate": 0.5 }
}
```

## Verified October run

The terminal run against the 28 course order lines resolved the period to October 1–31, 2025.

| Output | Result |
| --- | --- |
| Sales after discounts | 226125 cents across 13 orders |
| Best sellers | Alpine Down Parka and Wool Beanie at 4 units each, with the parka first on the revenue tiebreaker |
| Returns | 6 returned lines and 99494 cents refunded |
| Repeat customers | 4 of 12 distinct customers |

Four automated tests cover the calendar resolver, date and filter boundaries, grouping, validated CSV records and empty periods. The Next.js production build and a local HTTP smoke test also passed.

## OpenRouter integration

This branch adds server-side APIs for merchant questions. Create a local `.env.local` file with owner-only permissions. Set `OPENROUTER_API_KEY` to your OpenRouter key and `OPENROUTER_MODEL` to `nvidia/nemotron-3.5-lightning:free`, the tool-capable model used for the live check. Configure the course CSV as above, then restart Next.js. The key and CSV are Git-ignored.

The metric descriptions are based on the merchant questions from the exercise:

| Metric | Merchant question | Tool result |
| --- | --- | --- |
| Sales | “How much did we sell, and how many orders did we get?” | Sales after discounts and distinct orders using order dates. The chart shows sales by day. |
| Best sellers | “What products sold the most?” | Products ranked by units sold. Sales break ties before product ID. |
| Returns | “How many jacket order lines came back last week?” | Returned lines and total refunds using return dates, optionally scoped to the requested product or category. |
| Repeat customers | “How many customers came back?” | Distinct repeat customers, total customers, and the repeat share in the requested window. |

The Vercel AI SDK's `streamText` lets the model pick one tool and supply required ISO dates. The route disables parallel tool calls and enforces one metric execution on the server. A second model step streams the explanation with tool calls disabled. When several metrics are requested for one period, the dashboard shows the first supported report. The provider receives the question and aggregate tool output. Order and customer records stay on the server.

```sh
curl -fNsS http://localhost:3000/api/merchant/stream \
  -H 'Content-Type: application/json' \
  -d '{"question":"How many Outerwear order lines were returned last week?"}'
```

The live OpenRouter run returned one chart event with `startDate: 2025-10-20`, `endDate: 2025-10-26`, and `category: Outerwear`. It showed one returned line each on October 21, 23, 24 and 26, followed by the streamed answer reporting four lines and a completion event.

Automated tests use a simulated OpenRouter transport and cover the tool call, the follow-up response, the one-call limit, API validation and incremental stream parsing. The production build and live route were also verified locally.

## Streaming charts

The dashboard accepts a merchant's question and sends it to `POST /api/merchant/stream` as JSON. The response delivers newline-delimited chart, answer, error and completion events. Charts use the result of the selected metric function and appear as soon as its data arrives. The answer can continue streaming after the chart is shown.

| Report | Visualization | Merchant decision |
| --- | --- | --- |
| Sales | Line on a calendar axis | Spot changes in sales after discounts over the requested period. |
| Best sellers | Horizontal ranking bars | Compare units sold while keeping product labels readable. |
| Returns | Daily bars and a returned-line table | To investigate a spike, see each product, variant, return date, reason and refund. |
| Repeat customers | Metric card | Read the repeat share and its numerator and denominator for one period. |

The loading message and placeholder appear as soon as a report starts. The first chart event replaces the placeholder and the status changes while the answer streams below. Empty or unsupported requests show a message, and in-flight requests can be stopped. Each report shows its exact dates and filters and provides a table of the plotted numeric values.

The local browser check with the live model showed four Outerwear returns from October 20 through 26, 2025. The return table used the same filters as the chart. It was built from the local CSV and excludes order and customer IDs. Only the aggregate tool result reaches OpenRouter. The original `POST /api/merchant` route remains available for a single JSON response with the answer and metric result.

### Dashboard implementation prompt

> Build a merchant reporting dashboard page where a merchant enters a plain-language question and every supported answer renders its metric visualization directly in chat before the streamed text explanation. Use a line for sales, bars for rankings and returns, a returned-line table for row detail, and a metric card for repeat share. Show the exact range and filters on every visualization.
>
> On submit, show a chart placeholder, announce that the report is being prepared, and offer a Stop control. Replace the placeholder as soon as the chart event arrives and keep streaming the explanation underneath.

I verified the preparing state and return table in the browser. Live route checks also confirmed the sales line for October 20–26, the product ranking for October, and four repeat customers out of twelve for October.

## Deployment and acceptance

The exercise requires a public Vercel URL. The deployment must read the original complete CSV, including returned lines. The Node.js runtime can load it from the sensitive server-only `SHOPIFY_ORDER_CSV_BASE64` variable, alongside the server-only `OPENROUTER_API_KEY` and the free `OPENROUTER_MODEL`. Do not commit those values or expose them to the browser.

> Deploy the reviewed dashboard branch to a dedicated Vercel project with a public URL. Load the full course CSV server-side with returned rows included. Configure the sensitive OpenRouter key and the free model. Verify the public URL anonymously and run the winter jacket report and the acceptance questions. Record the URL, chart selection, exact filters, values, and seconds to first chart.

```sh
npm run verify:acceptance -- http://127.0.0.1:3000
```

The command accepts the public URL when it is available. It checks the winter jacket question and all 20 acceptance cases. Pass an optional list of case IDs after the URL to retry specific questions. Out-of-scope questions should give a clear no-data response. Supported questions with an empty result keep the chosen filters and show an empty state.

### Local acceptance results

The latest localhost run with the original CSV produced the expected report or no-data outcome for all 20 workbook cases. Three charts arrived above the five-second target. AQ-01 took 6.54 seconds, AQ-03 took 8.27 seconds, and AQ-06 took 37.00 seconds. The separate winter-jacket report showed four returns and appeared in 1.46 seconds. The browser also rendered both sales channels and the no-records state for boots. The release built from a clean archive without the CSV or the OpenRouter key. Public deployment and public timings are pending.
