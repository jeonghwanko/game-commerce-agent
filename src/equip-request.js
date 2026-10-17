import { requireThat } from "./catalog.js";
export function equipRequestId(value) {
  requireThat(
    typeof value === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        value,
      ),
    "invalid_equip_request_id",
  );
  return value;
}
