// Optional differential check against a pinned local public upstream checkout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import { evaluateEntitlementFrom } from "../src/vendor/onesub/entitlements.js";
const root = process.argv[2];
assert.ok(root, "Pass a local OneSub checkout path");
assert.equal(
  execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  "2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f",
);
const routes = readFileSync(
  join(root, "packages/server/src/routes/entitlements.ts"),
  "utf8",
);
const constants = readFileSync(
  join(root, "packages/shared/src/constants.ts"),
  "utf8",
);
const core = routes.slice(
  routes.indexOf("export function evaluateEntitlementFrom("),
  routes.indexOf("const userIdSchema"),
);
const predicate = constants.slice(
  constants.indexOf("export function isSubscriptionEntitled("),
  constants.indexOf("/**\n * Canonical error codes"),
);
const source = stripTypeScriptTypes(predicate + core).replaceAll("export ", "");
const context = vm.createContext({
  ENTITLED_SUBSCRIPTION_STATUSES: ["active", "grace_period"],
  PURCHASE_TYPE: { NON_CONSUMABLE: "non_consumable" },
});
vm.runInContext(source, context);
let cases = 0;
for (const status of [
  "active",
  "grace_period",
  "expired",
  "revoked",
  "paused",
  "pending",
])
  for (const expiresAt of ["1970-01-01", "2099-01-01", "invalid"])
    for (const gracePeriodExpiresAt of [undefined, "2099-01-01", "invalid"])
      for (const type of ["non_consumable", "consumable", "subscription"])
        for (const productId of ["gala", "other"]) {
          const subs = [{ productId, status, expiresAt, gracePeriodExpiresAt }],
            purchases = [{ productId, type }],
            entitlement = { productIds: ["gala"] };
          const a = context.evaluateEntitlementFrom(
              subs,
              purchases,
              entitlement,
              1000,
            ),
            b = evaluateEntitlementFrom(subs, purchases, entitlement, 1000);
          assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
          cases++;
        }
console.log(
  `PASS ${cases} differential OneSub evaluations against pinned upstream; no network calls.`,
);
