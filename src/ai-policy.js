// Legacy Node evaluation policy; Sites uses its separately reviewed policy.
export const AI_MODEL = "gpt-4.1-mini-2025-04-14";
export const AI_COST_POLICY = {
  maxCalls: 100,
  reservedUsdPerCall: 0.05,
  maxUsd: 5,
  maxRequestBytes: 16000,
  maxOutputTokens: 250,
  inputUsdPerMillion: 0.4,
  cachedInputUsdPerMillion: 0.1,
  outputUsdPerMillion: 1.6,
  reviewed: "2026-10-15",
  reviewExpires: "2026-10-22T00:00:00Z",
};
