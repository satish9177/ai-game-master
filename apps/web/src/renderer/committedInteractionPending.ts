export type CommittedInteractionExitGuard =
  | { blocked: false }
  | { blocked: true; message: string }

export function evaluateCommittedInteractionExitGuard(
  inFlightCount: number,
): CommittedInteractionExitGuard {
  return inFlightCount > 0
    ? { blocked: true, message: 'Wait — something is still happening here.' }
    : { blocked: false }
}

export async function awaitCommittedInteractionCallback(
  inFlightRef: { current: number },
  callback: () => void | Promise<void>,
): Promise<void> {
  inFlightRef.current = Math.max(0, inFlightRef.current) + 1
  try {
    await callback()
  } finally {
    inFlightRef.current = Math.max(0, inFlightRef.current - 1)
  }
}
