// Dev only: a lobby listing for laying out the rooms list without a backend
// full of players. `?rooms=mock` on the dev server makes LobbyApiService
// answer with this instead of /api/rooms (never in a production build). One
// room per state the card can be in: open, locked, nearly full, full, in
// battle, every mode, a long call sign.
import type { RoomListing } from '../model/Lobby';

const now = Date.now();

export const MOCK_ROOMS: RoomListing[] = [
  { id: 'mock-1', mode: 'dm', mapId: 'kolhoz_old_summer', mapName: 'Kolhoz', host: 'Pahom', players: 3, maxPlayers: 8, phase: 'open', locked: false, createdAt: now - 120000, updatedAt: now - 5000, playingSince: null, durationMs: 600000 },
  { id: 'mock-2', mode: 'ctf', mapId: 'island_old_summer', mapName: 'Island', host: 'Viper', players: 2, maxPlayers: 6, phase: 'open', locked: true, createdAt: now - 300000, updatedAt: now - 20000, playingSince: null, durationMs: 600000 },
  { id: 'mock-3', mode: 'tdm', mapId: 'kungur_old_summer', mapName: 'Kungur', host: 'Granit', players: 5, maxPlayers: 6, phase: 'open', locked: false, createdAt: now - 600000, updatedAt: now - 40000, playingSince: null, durationMs: 600000 },
  { id: 'mock-4', mode: 'assault', mapId: 'magadan_old_summer', mapName: 'Magadan', host: 'Kometa', players: 4, maxPlayers: 4, phase: 'open', locked: false, createdAt: now - 900000, updatedAt: now - 60000, playingSince: null, durationMs: 600000 },
  { id: 'mock-5', mode: 'dm', mapId: 'labyrinth_old_summer', mapName: 'Labyrinth', host: 'Shturm', players: 6, maxPlayers: 8, phase: 'playing', locked: false, createdAt: now - 1200000, updatedAt: now - 90000, playingSince: null, durationMs: 600000 },
  { id: 'mock-6', mode: 'ctf', mapId: 'lost_temple_old_summer', mapName: 'Lost Temple', host: 'VeryLongCallSign20ch', players: 1, maxPlayers: 8, phase: 'open', locked: true, createdAt: now - 1500000, updatedAt: now - 120000, playingSince: null, durationMs: 600000 },
];
