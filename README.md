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

All metric inputs use inclusive ISO dates and accept optional exact product ID or title and category filters. Sales and refunds are tracked separately because their reporting dates differ.

The exercise anchor is 2025-10-31. The resolver uses calendar dates in UTC and weeks begin on Monday.

| Question uses | Inclusive range at this anchor |
| --- | --- |
| Last week | October 20–26 |
| This week | October 27–31 |
| This month | October 1–31 |
| Last month | September 1–30 |
| No date | October 2–31 |

This stage prepares the tool inputs and outputs for the model and streaming charts in later stages.

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

This branch adds a server-side API for merchant questions. Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` for a model with tool calling in the server environment. Configure the course CSV as above before starting Next.js.

```sh
curl -fsS http://localhost:3000/api/merchant \
  -H 'Content-Type: application/json' \
  -d '{"question":"What were last week’s outerwear returns?"}'
```

The response contains an answer alongside structured tool results. Each tool result includes its exact date range, optional filters and computed metric. The API sends the merchant question and aggregate tool results to OpenRouter. The order history is read locally.

The OpenRouter test supplies recorded-shaped chat completions through the SDK's test transport. It exercises the full tool call and follow-up message without contacting OpenRouter. The route checks and production build run locally. A live model run and submission in Zero are still pending.
