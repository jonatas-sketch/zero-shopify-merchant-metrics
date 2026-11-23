import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { z } from "zod";

const money = z.string().regex(/^\d+(\.\d{1,2})?$/).transform((amount) => {
  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}).pipe(z.number().int().nonnegative());

const bool = z.enum(["true", "false"]).transform((value) => value === "true");

const orderLineSchema = z.object({
  order_id: z.string().min(1),
  line_item_id: z.string().min(1),
  order_date: z.iso.date(),
  customer_id: z.string().min(1),
  is_repeat_customer: bool,
  product_id: z.string().min(1),
  product_title: z.string().min(1),
  product_category: z.string().min(1),
  variant: z.string().trim().optional(),
  quantity: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().positive()),
  line_total: money,
  returned: bool,
  return_date: z.union([z.literal(""), z.iso.date()]),
  return_reason: z.string().trim().optional(),
  refund_amount: z.union([z.literal("").transform(() => 0), money]),
}).refine((row) => row.returned === Boolean(row.return_date), {
  path: ["return_date"],
  message: "A returned line must have a return date.",
}).refine((row) => !row.return_date || row.return_date >= row.order_date, {
  path: ["return_date"],
  message: "Return date cannot precede order date.",
}).refine((row) => row.returned || row.refund_amount === 0, {
  path: ["refund_amount"],
  message: "A refund requires a returned line.",
});

export type OrderLine = z.infer<typeof orderLineSchema>;

export function parseStoreOrders(csv: string): OrderLine[] {
  const records: unknown[] = parse(csv, { columns: true, bom: true, skip_empty_lines: true });
  const lines = z.array(orderLineSchema).parse(records);
  const unique = new Set<string>();

  for (const line of lines) {
    const identifier = `${line.order_id}:${line.line_item_id}`;
    if (unique.has(identifier)) {
      throw new Error(`Duplicate order line ${identifier}.`);
    }
    unique.add(identifier);
  }

  return lines;
}

export async function loadStoreOrders() {
  const source = resolve(process.env.SHOPIFY_ORDER_CSV ?? "data/store-orders.csv");
  return parseStoreOrders(await readFile(source, "utf8"));
}
