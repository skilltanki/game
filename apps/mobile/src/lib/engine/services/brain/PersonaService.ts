// Hands every bot a persona and derives the gunner profile from it.
import { personaFor } from '../../../../classes/engine/BotPersona';
import { Rng } from '../../../../classes/engine/Rng';
import type { BotDifficulty } from '../../../../model/BattleConfig';
import type { BotPersona } from '../../../../model/engine/Persona';
import { GUNNER_PROFILES, type GunnerProfile } from '../tactics/GunnerService';

export class PersonaService {
  public create = (difficulty: BotDifficulty, seed: number): BotPersona => personaFor(difficulty, new Rng(seed ^ 0x9e3779b9));

  /** The difficulty's profile, sharpened or dulled by the persona's accuracy. */
  public gunnerProfile = (difficulty: BotDifficulty, persona: BotPersona): GunnerProfile => {
    const base = GUNNER_PROFILES[difficulty];
    const k = 1 / persona.accuracy;
    return {
      ...base,
      aimSpread: base.aimSpread * k,
      reactionMs: base.reactionMs * k,
      targetLagMs: base.targetLagMs * k,
      fireTolerance: base.fireTolerance * Math.sqrt(k),
    };
  };
}

export default PersonaService;
