// A bot's character: the same difficulty plays differently from bot to bot,
// and a player can learn who is reckless and who waits in ambush.
export type PersonaKind = 'rusher' | 'balanced' | 'sniper';

export interface BotPersona {
  kind: PersonaKind;
  /** 0..1: how readily it picks fights over its mission. */
  aggression: number;
  /** 0..1: health fraction below which it retreats and heals (scaled). */
  caution: number;
  /** 0..1: how much it sticks with the squad (escort, waiting for a buddy). */
  teamwork: number;
  /** 0..1: willingness to wait in ambush / stage before a rush. */
  patience: number;
  /** 0..1: gunnery quality multiplier around the difficulty profile. */
  accuracy: number;
  /** 0..1: keeps moving while shooting (a sideways shuffle at the hold distance) instead of standing; >= 0.5 jinks. */
  mobility: number;
}

/** What the utility planner can choose between on top of the mode's mission. */
export type ActionKind = 'mission' | 'hunt' | 'retreat' | 'ambush';
