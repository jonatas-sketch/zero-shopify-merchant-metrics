import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { POST } from "../app/api/merchant/route";
import { answerMerchantQuestion } from "../lib/merchant-assistant";
import { parseStoreOrders } from "../lib/orders";

const orders = parseStoreOrders([
  "order_id,line_item_id,order_date,customer_id,is_repeat_customer,product_id,product_title,product_category,quantity,line_total,returned,return_date,refund_amount",
  "demo-a,one,2025-10-12,customer-private-demo,false,j,Jacket,Outerwear,1,9.99,true,2025-10-21,9.99",
  "demo-b,two,2025-10-25,customer-private-demo,true,h,Hat,Accessories,2,10.00,false,,0.00",
].join("\n"));

function reply(message: object, finishReason: "stop" | "tool_calls") {
  return Response.json({
    id: "chatcmpl-fixture",
    object: "chat.completion",
    created: 1761868800,
    model: "mock/merchant-model",
    choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
}

test("OpenRouter conversation calls a metric and sends only the aggregate tool result back", async () => {
  const calls: Record<string, unknown>[] = [];
  const model = createOpenRouter({
    apiKey: "fixture-key",
    fetch: async (url, options) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(options?.method, "POST");
      const body = String(options?.body);
      assert.ok(!body.includes("customer-private-demo"));
      assert.ok(!body.includes("demo-a"));
      calls.push(JSON.parse(body));
      if (calls.length === 1) {
        return reply({
          content: null,
          tool_calls: [{
            id: "returns-fixture",
            type: "function",
            function: {
              name: "returns",
              arguments: JSON.stringify({
                startDate: "2025-10-20", endDate: "2025-10-26", category: "Outerwear",
              }),
            },
          }],
        }, "tool_calls");
      }

      assert.match(body, /refundCents/);
      assert.match(body, /999/);
      assert.match(body, /returnedLines/);
      assert.equal(calls[1].tool_choice, "none");
      return reply({ content: "One returned line and 9.99 refunded from October 20 to 26." }, "stop");
    },
  }).chat("mock/merchant-model");

  const result = await answerMerchantQuestion("What were last week's outerwear returns?", orders, model);
  assert.equal(calls.length, 2);
  const toolDefinitions = calls[0].tools as { function: { name: string } }[];
  assert.deepEqual(toolDefinitions.map((entry) => entry.function.name),
    ["sales", "bestSellers", "returns", "repeatCustomers"]);
  assert.match(JSON.stringify(calls[0].messages), /2025-10-20/);
  assert.deepEqual(result.metrics, [{
    metric: "returns",
    filters: { startDate: "2025-10-20", endDate: "2025-10-26", category: "Outerwear" },
    value: { returnedLines: 1, refundCents: 999 },
  }]);
  assert.match(result.answer, /October 20 to 26/);
});

test("a model proposing parallel calls can execute only one metric", async () => {
  const args = JSON.stringify({ startDate: "2025-10-20", endDate: "2025-10-26" });
  let calls = 0;
  const model = createOpenRouter({
    apiKey: "fixture-key",
    fetch: async () => ++calls === 1 ? reply({
      content: null,
      tool_calls: ["returns", "sales"].map((name) => ({
        id: name + "-fixture",
        type: "function",
        function: { name, arguments: args },
      })),
    }, "tool_calls") : reply({ content: "One returned line." }, "stop"),
  }).chat("mock/merchant-model");

  const result = await answerMerchantQuestion("What came back last week?", orders, model);
  assert.deepEqual(result.metrics.map(({ metric }) => metric), ["returns"]);
});

test("an unsupported question cannot render an ungrounded model total", async () => {
  const model = createOpenRouter({
    apiKey: "fixture-key",
    fetch: async () => reply({ content: "There were 999,999 customer complaints." }, "stop"),
  }).chat("mock/merchant-model");

  const result = await answerMerchantQuestion("How many complaints were there?", orders, model);
  assert.deepEqual(result.metrics, []);
  assert.doesNotMatch(result.answer, /999/);
});

test("a vague repeat-customer trend requests a snapshot with an explicit limitation", async () => {
  let requests = 0;
  const model = createOpenRouter({
    apiKey: "fixture-key",
    fetch: async (_url, options) => {
      if (++requests === 1) {
        assert.match(String(options?.body), /Show repeat customer share for the default period/);
        assert.match(String(options?.body), /one period cannot establish growth/);
        return reply({
          content: null,
          tool_calls: [{
            id: "repeat-fixture",
            type: "function",
            function: {
              name: "repeatCustomers",
              arguments: JSON.stringify({ startDate: "2025-09-01", endDate: "2025-10-27" }),
            },
          }],
        }, "tool_calls");
      }
      return reply({ content: "One repeat customer. One period cannot establish growth." }, "stop");
    },
  }).chat("mock/merchant-model");

  const result = await answerMerchantQuestion("Are repeat buyers increasing lately?", orders, model);
  assert.deepEqual(result.metrics, [{
    metric: "repeatCustomers",
    filters: { startDate: "2025-09-28", endDate: "2025-10-27" },
    value: { repeatCustomers: 1, totalCustomers: 1, repeatRate: 1 },
  }]);
  assert.match(result.answer, /cannot establish growth/);
});

test("a paired sales and returns question asks for the first metric using the merchant's filters", async () => {
  let requests = 0;
  const model = createOpenRouter({
    apiKey: "fixture-key",
    fetch: async (_url, options) => {
      if (++requests === 1) {
        const body = String(options?.body);
        assert.match(body, /Show the sales report using the merchant's period and filters/);
        assert.match(body, /sales and returns for accessories last week/);
        return reply({
          content: null,
          tool_calls: [{
            id: "sales-fixture",
            type: "function",
            function: {
              name: "sales",
              arguments: JSON.stringify({
                startDate: "2025-10-20", endDate: "2025-10-26", category: "Accessories",
              }),
            },
          }],
        }, "tool_calls");
      }
      return reply({ content: "The sales report shows one order for the requested range." }, "stop");
    },
  }).chat("mock/merchant-model");

  const result = await answerMerchantQuestion("Show sales and returns for accessories last week", orders, model);
  assert.deepEqual(result.metrics, [{
    metric: "sales",
    filters: { startDate: "2025-10-20", endDate: "2025-10-26", category: "Accessories" },
    value: { salesCents: 1000, orders: 1 },
  }]);
});

test("the HTTP route rejects empty or malformed questions before model access", async () => {
  for (const body of ["not-json", JSON.stringify({ question: "  " }), JSON.stringify({ question: 42 })]) {
    const response = await POST(new Request("http://localhost/api/merchant", { method: "POST", body }));
    assert.equal(response.status, 400);
  }
});
