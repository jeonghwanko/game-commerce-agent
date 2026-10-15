import { requireThat } from "./catalog.js";
export const intentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goals: {
      type: "array",
      items: { type: "string", enum: ["story", "collection"] },
      maxItems: 2,
    },
    style: { type: "string", enum: ["formal", "cloak", "any", "unspecified"] },
    avoidStyles: {
      type: "array",
      items: { type: "string", enum: ["formal", "cloak"] },
      maxItems: 2,
    },
    spending: { type: "string", enum: ["optional", "free"] },
    clarify: { type: "boolean" },
  },
  required: ["goals", "style", "avoidStyles", "spending", "clarify"],
};
export function validateIntent(value) {
  requireThat(
    value &&
      Object.keys(value).sort().join(",") ===
        intentSchema.required.slice().sort().join(","),
    "invalid_ai_intent",
    502,
  );
  for (const key of ["goals", "avoidStyles"])
    requireThat(
      Array.isArray(value[key]) &&
        value[key].length <= 2 &&
        new Set(value[key]).size === value[key].length &&
        value[key].every((v) =>
          intentSchema.properties[key].items.enum.includes(v),
        ),
      "invalid_ai_intent",
      502,
    );
  for (const key of ["style", "spending"])
    requireThat(
      intentSchema.properties[key].enum.includes(value[key]),
      "invalid_ai_intent",
      502,
    );
  requireThat(typeof value.clarify === "boolean", "invalid_ai_intent", 502);
  return value;
}
/** Offline rehearsal parser only. The live interpreter replaces this entire function.
 * Unsupported/contradictory language asks for clarification; no model-quality claim.
 */
export function offlineIntent(goal) {
  const text = goal.toLowerCase();
  const clauses = text.split(/[;.!?]|\bbut\b|하지만/);
  const avoidStyles = [];
  const positive = clauses
    .filter((c) => {
      if (
        /(?:do not|don't|no|not|without|싫|원하지)/.test(c) &&
        /formal|정장/.test(c) &&
        !/buy|purchase|pay|구매/.test(c)
      ) {
        avoidStyles.push("formal");
        return false;
      }
      return true;
    })
    .join(" ");
  const story = /guard|gate|gathering|enter|manor|경비|저택|입장|모임/.test(
    positive,
  );
  const formal = /formal|gala|violet|gold embroidery|정장|보라/.test(positive);
  const cloak = /travel|cloak|teal|망토|청록/.test(positive);
  const collection =
    /collect|collection|look|style|violet|teal|gold embroidery|수집|외형/.test(
      positive,
    ) ||
    (!story && (formal || cloak || /outfit|clothes|옷|의상/.test(positive)));
  return {
    goals: [...(story ? ["story"] : []), ...(collection ? ["collection"] : [])],
    style:
      formal && cloak
        ? "unspecified"
        : formal
          ? "formal"
          : cloak
            ? "cloak"
            : "any",
    avoidStyles: [...new Set(avoidStyles)],
    spending:
      /free|no purchase|do not buy|don't buy|without paying|무료|사지|구매하지/.test(
        text,
      )
        ? "free"
        : "optional",
    clarify: formal && cloak,
  };
}
