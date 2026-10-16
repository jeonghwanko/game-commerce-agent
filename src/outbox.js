/** Trusted operator integration only. The sink must deduplicate by event.id.
 * A crash after sink acceptance but before acknowledge causes safe redelivery.
 * No arbitrary client-supplied metadata is accepted by Store.event.
 */
export async function deliverOutbox(store, sink, limit = 100) {
  const events = store.outbox(limit);
  for (const event of events) {
    await sink.accept(event);
    store.acknowledge([event.id]);
  }
  return events.length;
}
