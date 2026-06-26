const NPC_REQUEST_PATTERNS: readonly RegExp[] = [
  /\bnpcs?\b(?!-)/u,
  /\bsurvivors?\b(?!-)/u,
  /\bguards?\b(?!-)/u,
  /\bmerchants?\b(?!-)/u,
  /\bstrangers?\b(?!-)/u,
  /\bpersons?\b(?!-)/u,
  /\bpeople\b(?!-)/u,
  /\bsomeone\b(?!-)/u,
  /\bsomebody\b(?!-)/u,
  /\bcharacters?\b(?!-)/u,
  /\ball(?:y|ies)\b(?!-)/u,
  /\bcompanions?\b(?!-)/u,
  /\bprisoners?\b(?!-)/u,
  /\brefugees?\b(?!-)/u,
  /\bcaptives?\b(?!-)/u,
  /\btalk\s+to\b/u,
  /\bspeak\s+to\b/u,
  /\bspeak\s+with\b/u,
]

export function detectsNpcRequest(prompt: string): boolean {
  const normalized = prompt.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ')
  if (normalized.length === 0) return false
  return NPC_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))
}
