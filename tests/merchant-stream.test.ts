import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { POST } from "../app/api/merchant/stream/route";
import { streamMerchantQuestion } from "../lib/merchant-assistant";
import { readMerchantStream } from "../lib/merchant-stream";
import { parseStoreOrders } from "../lib/orders";

function completion(chunks: { delta: object; finishReason?: string }[]) {
  const formatted = chunks.map(({ delta, finishReason }) => "data: " + JSON.stringify({
    id: "chatcmpl-stream-fixture",
    object: "chat.completion.chunk",
    created: 1761868800,
    model: "mock/merchant-model",
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  }) + "\n\n");
  return new Response(formatted.join("") + "data: [DONE]\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  });
}

test("stream exposes a calculated chart before the model finishes writing", async () => {
  const orders = parseStoreOrders([
    "order_id,line_item_id,order_date,customer_id,is_repeat_customer,product_id,product_title,product_category,quantity,line_total,returned,return_date,refund_amount,variant,return_reason",
    "demo-a,one,2025-10-12,c1,false,j,Jacket,Outerwear,1,9.99,true,2025-10-21,9.99,Blue / M,Fit",
    "demo-b,two,2025-10-25,c1,true,h,Hat,Accessories,2,10.00,false,,0.00,,",
  ].join("\n"));
  let requests = 0;
  const model = createOpenRouter({
    apiKey: "fixture-key",
    fetch: async (_url, options) => {
      requests++;
      assert.doesNotMatch(String(options?.body), /Blue \/ M|demo-a|return_reason/);
      return requests === 1 ? completion([
        { delta: { role: "assistant", tool_calls: [{
          id: "returns-fixture", index: 0, type: "function",
          function: { name: "returns", arguments: '{"startDate":"2025-10-20","endDate":"2025-10-26","category":"Outerwear"}' },
        }] } },
        { delta: {}, finishReason: "tool_calls" },
      ]) : completion([
        { delta: { role: "assistant", content: "One outerwear line was returned." } },
        { delta: {}, finishReason: "stop" },
      ]);
    },
  }).chat("mock/merchant-model");

  const first = streamMerchantQuestion("What were last week's outerwear returns?", orders, model);
  assert.deepEqual((await first.next()).value, {
    type: "chart",
    id: "returns-fixture",
    chart: {
      kind: "bars",
      title: "Returned lines by return date",
      measure: "Returned lines",
      filters: { startDate: "2025-10-20", endDate: "2025-10-26", category: "Outerwear" },
      points: [{ label: "2025-10-21", value: 1 }],
      returns: [{ product: "Jacket", variant: "Blue / M", returnedOn: "2025-10-21", reason: "Fit", refundCents: 999 }],
    },
  });
  assert.deepEqual((await first.next()).value, { type: "text", text: "One outerwear line was returned." });
  assert.deepEqual((await first.next()).value, { type: "done" });
  assert.equal((await first.next()).done, true);
});

test("stream parser handles split lines and split UTF-8 characters", async () => {
  const bytes = new TextEncoder().encode('{"type":"text","text":"Devolução"}\n{"type":"done"}\n');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of bytes) controller.enqueue(Uint8Array.of(value));
      controller.close();
    },
  });

  const items = [];
  for await (const item of readMerchantStream(body)) items.push(item);
  assert.deepEqual(items, [{ type: "text", text: "Devolução" }, { type: "done" }]);
});

test("stream route validates input before starting a model run", async () => {
  const response = await POST(new Request("http://localhost/api/merchant/stream", {
    method: "POST",
    body: JSON.stringify({ question: " " }),
  }));
  assert.equal(response.status, 400);
});
