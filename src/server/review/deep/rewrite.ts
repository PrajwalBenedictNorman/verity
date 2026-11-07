export function pickSafeRewrite(
  rewrite: string | null,
  approvedClaims: { text: string }[],
): string | null {
  if (!rewrite) return null;
  const candidate = rewrite.trim();
  if (!candidate) return null;
  const lower = candidate.toLowerCase();
  const insideApprovedClaim = approvedClaims.some((claim) =>
    claim.text.toLowerCase().includes(lower),
  );
  return insideApprovedClaim ? candidate : null;
}
