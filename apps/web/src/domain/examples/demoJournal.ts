import type { JournalSpec } from '../journal/journalSpec'

export const demoJournalSpec: JournalSpec = {
  journalId: 'demo-consequence-journal',
  title: 'Consequence Journal',
  anchorRoomId: 'throne-room',
  entries: [
    {
      id: 'claimed-tribute-coin',
      text: 'You claimed the tribute coin.',
      condition: { kind: 'room-flag', roomId: 'throne-room', flag: 'interaction:offering-coffer' },
    },
    {
      id: 'dealt-with-malik',
      text: 'You dealt with Steward Malik.',
      condition: { kind: 'room-flag', roomId: 'throne-room', flag: 'encounter:malik-encounter' },
    },
    {
      id: 'entered-safehouse',
      text: 'You entered the ruined safehouse.',
      condition: { kind: 'room-visited', roomId: 'ruined-safehouse' },
    },
    {
      id: 'became-infected',
      text: 'You became infected.',
      condition: { kind: 'has-status', status: 'infected' },
    },
    {
      id: 'faced-the-walker',
      text: 'You faced a reanimated walker.',
      condition: { kind: 'room-flag', roomId: 'ruined-safehouse', flag: 'encounter:walker-encounter' },
    },
    {
      id: 'secured-royal-writ',
      text: 'You secured a royal writ.',
      condition: { kind: 'has-item', itemId: 'royal-writ' },
    },
  ],
}
