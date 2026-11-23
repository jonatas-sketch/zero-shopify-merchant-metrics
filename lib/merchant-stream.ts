import type { MetricInput } from "./dates";

export type MetricChart = {
  title: string;
  measure: string;
  filters: MetricInput;
  horizontal?: boolean;
  points: { id?: string; label: string; value: number }[];
};

export type MerchantStreamEvent =
  | { type: "chart"; id: string; chart: MetricChart }
  | { type: "text"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };

export async function* readMerchantStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<MerchantStreamEvent, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const lines = (pending + decoder.decode(value, { stream: true })).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line) yield JSON.parse(line) as MerchantStreamEvent;
      }
    }
    pending += decoder.decode();
    if (pending.trim()) yield JSON.parse(pending) as MerchantStreamEvent;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
