import { requireThat } from "./catalog.js";
// The reservation covers headers, bounded body consumption, parsing and cancellation.
export async function consumeAIJSON(response, signal) {
  if (!response.ok && response.body === null) return null;
  requireThat(
    response.body && typeof response.body.getReader === "function",
    "invalid_ai_response",
    502,
  );
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0,
    done = false,
    cancellation;
  const cancel = () => (cancellation ??= reader.cancel().catch(() => {}));
  const abort = () => {
    void cancel();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const part = await reader.read();
      signal.throwIfAborted();
      if (part.done) {
        done = true;
        break;
      }
      bytes += part.value.byteLength;
      requireThat(bytes <= 65536, "ai_response_too_large", 502);
      chunks.push(part.value);
    }
    if (!response.ok) return null;
    try {
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(joined));
    } catch {
      requireThat(false, "invalid_ai_response", 502);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (!done || cancellation) await cancel();
    reader.releaseLock();
  }
}
