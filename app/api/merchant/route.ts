import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { answerMerchantQuestion } from "../../../lib/merchant-assistant";
import { loadStoreOrders } from "../../../lib/orders";

const requestSchema = z.object({ question: z.string().trim().min(1).max(600) }).strict();

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const input = requestSchema.safeParse(payload);
  if (!input.success) {
    return Response.json({ error: "Send a question between 1 and 600 characters." }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;
  if (!apiKey || !modelId) {
    return Response.json({ error: "The analytics model is not configured." }, { status: 503 });
  }

  let orders;
  try {
    orders = await loadStoreOrders();
  } catch (error) {
    console.error("Could not load merchant order history.", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "The sample order history could not be loaded." }, { status: 503 });
  }

  try {
    const model = createOpenRouter({ apiKey }).chat(modelId);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]);
    return Response.json(await answerMerchantQuestion(input.data.question, orders, model, signal));
  } catch (error) {
    console.error("Merchant model request failed.", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "The analytics model did not answer. Try again shortly." }, { status: 502 });
  }
}
