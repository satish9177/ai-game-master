export function interactionFlagKey(
  explicitFlag: string | undefined,
  ref: string | undefined,
): string | undefined {
  return explicitFlag ?? (ref ? `interaction:${ref}` : undefined)
}
