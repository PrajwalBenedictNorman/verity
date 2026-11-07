export function buildAllowedSourceCodes(args: {
  sections: { code: string }[];
  claims: { code: string }[];
  verified?: string[];
}): Set<string> {
  const codes = new Set<string>();
  for (const section of args.sections) codes.add(section.code);
  for (const claim of args.claims) codes.add(claim.code);
  for (const code of args.verified ?? []) codes.add(code);
  return codes;
}
