import type { QuestSpec } from '../quests/questSpec'

export const demoQuestSpec: QuestSpec = {
  questId: 'the-stewards-toll',
  title: "The Steward's Toll",
  anchorRoomId: 'throne-room',
  objectives: [
    {
      id: 'claim-tribute-coin',
      text: 'Claim the tribute coin',
      condition: { kind: 'room-flag', roomId: 'throne-room', flag: 'interaction:offering-coffer' },
    },
    {
      id: 'get-past-steward-malik',
      text: 'Get past Steward Malik',
      condition: { kind: 'room-flag', roomId: 'throne-room', flag: 'encounter:malik-encounter' },
    },
    {
      id: 'enter-the-safehouse',
      text: 'Enter the safehouse',
      condition: { kind: 'room-visited', roomId: 'ruined-safehouse' },
    },
  ],
}
