/** Trusted operator integration only. The sink must deduplicate by event.id.
 * A crash after sink acceptance but before acknowledge causes safe redelivery.
 * No arbitrary client-supplied metadata is accepted by Store.event.
 */
import { eventLimit } from "./events.js";
export async function deliverOutbox(store, sink, limit = 100) {
  const events = await store.outbox(eventLimit(limit));
  for (const event of events) {
    const id = event.id;
    const ack = await sink.accept(Object.freeze({ ...event }));
    if (ack?.id !== id || !["accepted", "duplicate"].includes(ack.status))
      throw new Error("invalid_outbox_ack");
    await store.acknowledge([id]);
  }
  return events.length;
}
