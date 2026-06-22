import type { NPCDialogueRequest, NPCDialogueResponse } from '../dialogue/contracts'

/**
 * Provider seam for NPC dialogue (ADR-0017).
 *
 * Returned text is display DATA only: never executable JavaScript, Three.js,
 * React, or scene-script code, and never evaluated. The v0 fake performs no
 * network I/O; a future real provider implements this same contract at the
 * composition root and must validate its external output before returning it.
 */
export interface NPCDialogueProvider {
  reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse>
}
