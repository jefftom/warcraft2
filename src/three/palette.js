// Shared materials and colours for the 3D view. Models are vertex-coloured and
// drawn with a handful of shared materials, so the GPU switches state rarely.

import * as THREE from 'three';
import { TEAM_COLORS, NEUTRAL } from '../config.js';

// Material swatches shared by every model so the world reads as one place.
export const SWATCH = {
  stone: '#9a9284',
  stoneDark: '#6f685d',
  stoneLight: '#b9b1a1',
  wood: '#8a5f37',
  woodDark: '#5e3f22',
  woodLight: '#b08458',
  thatch: '#c9a24a',
  thatchDark: '#9d7c2f',
  slate: '#59606b',
  slateDark: '#40454d',
  plaster: '#e2d3b0',
  iron: '#8e959d',
  ironDark: '#5d636a',
  steel: '#d4d9de',
  gold: '#e8b923',
  goldDark: '#a57d10',
  leather: '#7a5230',
  cloth: '#9b7a4f',
  skin: '#e8b98f',
  skinDark: '#c9946a',
  hair: '#5a3a22',
  grass: '#5d8a34',
  leaf: '#3f7a2a',
  leafDark: '#2b5a1f',
  pine: '#24502a',
  pineDark: '#1b3f22',
  bark: '#5a3d22',
  rock: '#8a857c',
  rockDark: '#6a665e',
  dirt: '#87683f',
  glow: '#ffcf6a',
  fire: '#ff8a2a',
};

export function teamColors(owner) {
  const t = TEAM_COLORS[owner] || TEAM_COLORS[NEUTRAL];
  return { main: t.main, dark: t.dark, light: t.light };
}

export class Palette {
  constructor(fog) {
    // Matte, faceted surfaces: stone, wood, cloth, skin, roofs.
    this.matte = fog.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, flatShading: true }), { key: 'matte' });
    // Metal: armour, blades, helmets.
    this.metal = fog.patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.65, flatShading: true }), { key: 'metal' });
    // Self-lit bits: windows, torches, forge mouths, gold glints.
    // Unlit, so the vertex colour shows at full strength regardless of the sun.
    this.glow = fog.patch(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { key: 'glow' });
    // Tinted overlays (selection rings, markers): not fogged, no lighting.
    this.overlay = (color, opacity = 1) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
  }

  dispose() {
    this.matte.dispose();
    this.metal.dispose();
    this.glow.dispose();
  }
}
