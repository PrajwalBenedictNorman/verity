export function cleanBlockText(input: string) {
  return input.replace(/\r\n/g, "\n").replace(/\n/g, " ").replace(/[ \t]+/g, " ").trim();
}

export function splitParagraphs(input: string): string[] {
  return input
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((chunk) => cleanBlockText(chunk))
    .filter((chunk) => chunk.length > 0);
}
