export type FindingKind =
  | "Terminology"
  | "Voice"
  | "Claim check"
  | "Unapproved claim"
  | "Tone";

export type Finding = {
  id: string;
  tier: "fast" | "deep";
  kind: FindingKind;
  severity: "error" | "warn" | "question";
  confidence: number;
  blockId: string;
  start: number;
  end: number;
  matchedText: string;
  message: string;
  source: { type: "guideline" | "claim" | "glossary"; code: string; snapshot: string };
  suggestion: string | null;
  state: "open" | "applied" | "dismissed";
  dismissReason?: string;
};

export type Disclosure = {
  promptVersion: string;
  fast: { ran: boolean; externalCalls: number };
  deep: {
    status: "done" | "skipped" | "failed" | "pending" | "running";
    provider: string | null;
    chatModel: string | null;
    embeddingModel: string | null;
    externalCalls: number;
    sentToExternal: string;
    retrieval: "vector" | "keyword" | "none";
  };
  dropped: number;
  verifiedClaims: string[];
  log?: string[];
};
