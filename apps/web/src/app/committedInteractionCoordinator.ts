import type { NpcActionReactionResult } from './npcBeliefActionReaction'

export async function coordinateCommittedInteractionFollowups(input: {
  promoteInteractionMemories: () => Promise<unknown>
  runBeliefGatedNpcActionReaction: () => Promise<NpcActionReactionResult | null>
  refreshDerivedViews: (state: Extract<NpcActionReactionResult, { status: 'committed' }>['state']) => void
}): Promise<void> {
  void input.promoteInteractionMemories()
  const result = await input.runBeliefGatedNpcActionReaction()
  if (result?.status === 'committed') input.refreshDerivedViews(result.state)
}
