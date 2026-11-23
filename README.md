# Merchant metrics

A Next.js App Router exercise using the order history supplied in the Shopify scenario. Stage 1 implements four metric functions and a date resolver.

## Run with the course CSV

Copy the CSV from the Zero brief to `data/store-orders.csv` or point `SHOPIFY_ORDER_CSV` to a local copy. The CSV is kept out of version control.

```sh
npm ci
npm test
npm run metrics
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

The exercise anchor is 2025-10-31. “Last week” resolves to October 20–26, “this month” is October 1–31 and a missing date uses October 2–31. The week begins on Monday. The resolver uses calendar dates in UTC.

`npm run metrics` prints the four October outputs from the supplied local fixture. This stage prepares the tool inputs and outputs for the model and streaming charts in later stages.

## Verified October run

The terminal run against the 28 course order lines resolved the period to October 1–31, 2025.

| Output | Result |
| --- | --- |
| Sales after discounts | 226125 cents across 13 orders |
| Best sellers | Alpine Down Parka and Wool Beanie at 4 units each, with the parka first on the revenue tiebreaker |
| Returns | 6 returned lines and 99494 cents refunded |
| Repeat customers | 4 of 12 distinct customers |

Four automated tests cover the calendar resolver, date and filter boundaries, grouping, validated CSV records and empty periods. The Next.js production build and a local HTTP smoke test also passed.
