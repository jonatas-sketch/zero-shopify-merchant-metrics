import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { loadStoreOrders } from "../../../lib/orders";

const requestSchema = z.object({ question: z.string().trim().min(1).max(600) }).strict();

export async function prepareMerchantRequest(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  const input = requestSchema.safeParse(payload);
  if (!input.success) {
    return { error: Response.json({ error: "Send a question between 1 and 600 characters." }, { status: 400 }) };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelId = process.env.OPENROUTER_MODEL;
  if (!apiKey || !modelId) {
    return { error: Response.json({ error: "The analytics model is not configured." }, { status: 503 }) };
  }

  try {
    return {
      question: input.data.question,
      orders: await loadStoreOrders(),
      model: createOpenRouter({ apiKey }).chat(modelId),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    };
  } catch (error) {
    console.error("Could not prepare merchant reporting.", error instanceof Error ? error.name : "UnknownError");
    return { error: Response.json({ error: "The sample order history could not be loaded." }, { status: 503 }) };
  }
}
