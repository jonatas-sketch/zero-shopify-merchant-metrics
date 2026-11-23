import { streamMerchantQuestion } from "../../../../lib/merchant-assistant";
import { prepareMerchantRequest } from "../prepare";

export async function POST(request: Request) {
  const prepared = await prepareMerchantRequest(request);
  if (prepared.error) return prepared.error;

  const { question, orders, model, signal } = prepared;
  const events = streamMerchantQuestion(question, orders, model, signal);
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await events.next();
        if (next.done) {
          controller.close();
        } else {
          controller.enqueue(encoder.encode(JSON.stringify(next.value) + "\n"));
        }
      } catch {
        controller.enqueue(encoder.encode('{"type":"error","message":"The response was interrupted."}\n'));
        controller.close();
      }
    },
    async cancel() {
      await events.return();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
