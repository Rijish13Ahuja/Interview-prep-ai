const MUST_SIGNALS = [
  "required",
  "must have",
  "must-have",
  "you must",
  "is required",
  "requirement",
  "need to have",
  "mandatory",
];

const NICE_SIGNALS = [
  "nice to have",
  "nice-to-have",
  "bonus",
  "a plus",
  "preferred but not required",
  "bonus points for",
  "plus if",
  "would be a plus",
];

const EVIDENCE_TOKEN_OVERLAP_THRESHOLD = 0.7;
const MIN_TOKEN_LENGTH = 3;

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Verifies a requirement's `evidence` string is actually grounded in the JD,
 * without becoming a fuzzy-matching subsystem: normalized substring match
 * first, then a simple token-overlap ratio to tolerate minor paraphrasing
 * or formatting differences.
 */
export function isEvidenceGrounded(evidence: string, jdText: string): boolean {
  const normEvidence = normalize(evidence);
  const normJd = normalize(jdText);

  if (normEvidence.length === 0) return false;
  if (normJd.includes(normEvidence)) return true;

  const evidenceTokens = normEvidence.split(" ").filter((t) => t.length >= MIN_TOKEN_LENGTH);
  if (evidenceTokens.length === 0) return false;

  const jdTokenSet = new Set(normJd.split(" "));
  const matchedCount = evidenceTokens.filter((t) => jdTokenSet.has(t)).length;

  return matchedCount / evidenceTokens.length >= EVIDENCE_TOKEN_OVERLAP_THRESHOLD;
}

/**
 * Narrow safety net over the LLM's must/nice judgment: only overrides when
 * the evidence text contains an explicit, unambiguous signal phrase that
 * contradicts the assigned priority. Ambiguous language (no explicit
 * signal) is left entirely to the LLM's judgment.
 */
export function resolveContradictedPriority(evidence: string, assigned: "must" | "nice"): "must" | "nice" {
  const normEvidence = normalize(evidence);
  const hasMustSignal = MUST_SIGNALS.some((sig) => normEvidence.includes(normalize(sig)));
  const hasNiceSignal = NICE_SIGNALS.some((sig) => normEvidence.includes(normalize(sig)));

  if (assigned === "must" && hasNiceSignal && !hasMustSignal) return "nice";
  if (assigned === "nice" && hasMustSignal && !hasNiceSignal) return "must";
  return assigned;
}
