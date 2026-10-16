// Persona generation: the difficulty sets the centre, the seed spreads
// each bot around it, and a "kind" tilts the weights toward rushing or sniping.
import type { BotDifficulty } from '../../model/BattleConfig';
import type { BotPersona, PersonaKind } from '../../model/engine/Persona';
import type { Rng } from './Rng';

const BASE: Record<BotDifficulty, Omit<BotPersona, 'kind'>> = {
  easy: { aggression: 0.5, caution: 0.8, teamwork: 0.3, patience: 0.3, accuracy: 0.7, mobility: 0 },
  normal: { aggression: 0.6, caution: 0.5, teamwork: 0.6, patience: 0.5, accuracy: 1, mobility: 0.3 },
  // Hard shoots on the move: the owner's Shaft took 9 hulls standing at the hold distance in 3 min.
  hard: { aggression: 0.7, caution: 0.3, teamwork: 0.9, patience: 0.7, accuracy: 1.35, mobility: 0.8 },
};

const KINDS: PersonaKind[] = ['rusher', 'balanced', 'balanced', 'sniper'];

export function personaFor(difficulty: BotDifficulty, rng: Rng): BotPersona {
  const base = BASE[difficulty];
  const kind = rng.pick(KINDS);
  const noise = (): number => 1 + rng.range(-0.2, 0.2);
  const clamp = (v: number): number => Math.max(0, Math.min(1, v));
  const persona: BotPersona = {
    kind,
    aggression: clamp(base.aggression * noise()),
    caution: clamp(base.caution * noise()),
    teamwork: clamp(base.teamwork * noise()),
    patience: clamp(base.patience * noise()),
    accuracy: Math.max(0.4, base.accuracy * noise()),
    mobility: clamp(base.mobility * noise()),
  };
  if (kind === 'rusher') {
    persona.aggression = clamp(persona.aggression + 0.25);
    persona.caution = clamp(persona.caution - 0.2);
    persona.patience = clamp(persona.patience - 0.3);
    persona.mobility = clamp(persona.mobility + 0.15);
  } else if (kind === 'sniper') {
    persona.aggression = clamp(persona.aggression - 0.2);
    persona.patience = clamp(persona.patience + 0.3);
    persona.accuracy += 0.15;
    persona.mobility = clamp(persona.mobility - 0.3);
  }
  return persona;
}
