// The bots' pecking order, shared by the no-ramming rule (LocalAvoidanceService)
// and the staggered start (BotEngineService): botN -> N, the player last,
// anything else by name hash. Deterministic, so every hull agrees on it.
export function ordinalOf(id: string): number {
  const m = /^bot(\d+)$/.exec(id);
  if (m != null) return Number(m[1]);
  if (id === 'player') return 1e9;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return 1e6 + (hash % 1e6);
}
