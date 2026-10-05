// What the human player is allowed to see, shared by every renderer.

import { PLAYER, NEUTRAL } from './config.js';

export function isEntityVisible(game, e) {
  if (e.dead || e.hidden) return false;
  if (e.owner === PLAYER || game.revealMap) return true;
  if (e.kind === 'building') {
    if (e.owner === NEUTRAL) return game.fog.rectExplored(e.rect());
    return e.seen;
  }
  return game.fog.isVisible(e.tx, e.ty) || game.isExposed(e.owner);
}
