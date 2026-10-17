// Operator-owned scheduled/queue integration only. Never mounted as a public API.
// No destination, credentials, retry scheduler or network call is configured here.
import { D1Ledger } from "./d1.js";
import { deliverOutbox } from "../src/outbox.js";
export function deliverSitesOutbox(db, sink, limit = 100) {
  return deliverOutbox(new D1Ledger(db), sink, limit);
}
