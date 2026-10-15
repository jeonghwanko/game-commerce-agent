export const CATALOG_VERSION = 1;
export const catalog = Object.freeze([
  Object.freeze({
    sku: "rosalyn-gala",
    name: "Rosalyn Gala Outfit",
    description:
      "A formal outfit for the guard’s dress check. Seal and rumor quests still required.",
    amount: 199,
    currency: "USD",
    version: CATALOG_VERSION,
    active: true,
    effect: "formal",
  }),
  Object.freeze({
    sku: "rosalyn-traveler",
    name: "Traveler’s Cloak",
    description:
      "A cosmetic travel outfit. Does not satisfy the formal dress check.",
    amount: 99,
    currency: "USD",
    version: CATALOG_VERSION,
    active: true,
    effect: "cosmetic",
  }),
]);
export function product(sku) {
  const p = catalog.find((p) => p.sku === sku && p.active);
  if (!p) throw new CommerceError("unknown_sku");
  return p;
}
export class CommerceError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function requireThat(ok, code, status = 400) {
  if (!ok) throw new CommerceError(code, status);
}
export const money = (minor) => (minor / 100).toFixed(2);
