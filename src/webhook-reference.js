import { requireThat } from "./catalog.js";
export function paypalLinkId(links, kind) {
  const href = links?.find((link) => link.rel === "up")?.href;
  if (!href) return undefined;
  let url;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (
    ![
      "https://api-m.sandbox.paypal.com",
      "https://api.sandbox.paypal.com",
    ].includes(url.origin) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return undefined;
  const prefix =
    kind === "capture" ? "/v2/payments/captures/" : "/v2/checkout/orders/";
  if (!url.pathname.startsWith(prefix)) return undefined;
  const id = url.pathname.slice(prefix.length);
  return /^[A-Za-z0-9-]+$/.test(id) ? id : undefined;
}
export function isRefundResource(event) {
  const reversal = [
    "PAYMENT.CAPTURE.REFUNDED",
    "PAYMENT.CAPTURE.REVERSED",
  ].includes(event.event_type);
  requireThat(
    !event.resource_type || ["refund", "capture"].includes(event.resource_type),
    "unsupported_resource_type",
  );
  requireThat(
    event.resource_type !== "refund" || reversal,
    "invalid_event_resource",
  );
  return (
    reversal &&
    (event.resource_type === "refund" ||
      (!event.resource_type &&
        (event.event_type === "PAYMENT.CAPTURE.REFUNDED" ||
          !!paypalLinkId(event.resource?.links, "capture"))))
  );
}
export function eventReference(event) {
  const r = event.resource;
  const related = r?.supplementary_data?.related_ids;
  const refund = isRefundResource(event);
  const captureId =
    related?.capture_id ?? (refund ? paypalLinkId(r?.links, "capture") : r?.id);
  const providerId = related?.order_id;
  for (const id of [captureId, providerId])
    requireThat(
      id === undefined ||
        (typeof id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(id)),
      "invalid_event_reference",
    );
  return { captureId, providerId };
}
