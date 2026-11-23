import { answerMerchantQuestion } from "../../../lib/merchant-assistant";
import { prepareMerchantRequest } from "./prepare";

export async function POST(request: Request) {
  const prepared = await prepareMerchantRequest(request);
  if (prepared.error) return prepared.error;

  const { question, orders, model, signal } = prepared;
  try {
    return Response.json(await answerMerchantQuestion(question, orders, model, signal));
  } catch (error) {
    console.error("Merchant model request failed.", error instanceof Error ? error.name : "UnknownError");
    return Response.json({ error: "The analytics model did not answer. Try again shortly." }, { status: 502 });
  }
}
