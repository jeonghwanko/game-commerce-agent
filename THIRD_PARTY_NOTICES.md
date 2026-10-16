# Third-party notices

## OneSub entitlement core (MIT)

Copyright (c) 2026 onesub. Full license: [src/vendor/onesub/LICENSE](src/vendor/onesub/LICENSE).

Source pinned to [jeonghwanko/onesub, commit 2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f](https://github.com/jeonghwanko/onesub/tree/2b7dcd7ff5e21e252a7d8fdcf72769f651dc737f):

- `packages/server/src/routes/entitlements.ts`: `evaluateEntitlementFrom`, `evaluateEntitlement`.
- `packages/shared/src/constants.ts`: `isSubscriptionEntitled`, applicable status and purchase constants.
- `packages/shared/src/types.ts`: `Entitlement`, `EntitlementsConfig`, `EntitlementStatus`.

Changes: extracted dependency-free functions, erased TypeScript annotations for Node.js runtime, narrowed input declarations to the fields the evaluator reads, and applied repository formatting. The original evaluator's subscription/non-consumable semantics are preserved. The host wrapper excludes held, unverified and mismatched-owner ledger records before evaluation. No Express router, mobile SDK, platform receipt implementation, or query-based identity handling is copied. PayPal is a distinct provider; it is never represented as Apple/Google.

## Prettier (development dependency)

MIT; see the installed package license. No runtime dependency.

No private game source/assets, private development brief or mimi-seed-sdk code is included.
