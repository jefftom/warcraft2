// Toy soldiers modelled and animated in Blender (tools/blender/figures.py)
// and loaded as glTF. Each figure is one skinned mesh with vertex colours;
// parts painted pure magenta take the owner's team colour. Clips: Idle, Walk,
// Attack. The player fields humans; the enemy fields orcs.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { teamColors } from '../palette.js';

import { PLAYER } from '../../config.js';

const MODELS = {
  'human:footman': 'assets/models/human_footman.glb',
  'orc:footman': 'assets/models/orc_grunt.glb',
};

export const factionOf = (owner) => (owner === PLAYER ? 'human' : 'orc');
export const figureKey = (u) => `${factionOf(u.owner)}:${u.type}`;

class FigureAsset {
  constructor(gltf) {
    this.scene = gltf.scene;
    this.clips = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
    this.mesh = null;
    this.scene.traverse((o) => {
      if (o.isSkinnedMesh && !this.mesh) this.mesh = o;
    });
    this.teamGeos = new Map();
  }

  // The base geometry with magenta replaced by a team colour (cached per team).
  teamGeometry(owner) {
    if (this.teamGeos.has(owner)) return this.teamGeos.get(owner);
    const geo = this.mesh.geometry.clone();
    const col = geo.attributes.color;
    const team = new THREE.Color(teamColors(owner).main);
    if (col) {
      const out = new Float32Array(col.count * 3);
      for (let i = 0; i < col.count; i++) {
        const r = col.getX(i);
        const g = col.getY(i);
        const b = col.getZ(i);
        const marker = r > 0.85 && b > 0.85 && g < 0.15;
        out[i * 3] = marker ? team.r : r;
        out[i * 3 + 1] = marker ? team.g : g;
        out[i * 3 + 2] = marker ? team.b : b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
    }
    this.teamGeos.set(owner, geo);
    return geo;
  }

  dispose() {
    for (const g of this.teamGeos.values()) g.dispose();
  }
}

/** Loads every Blender figure; resolves to { 'faction:unitType': FigureAsset }. */
export function loadFigures(base = '') {
  const loader = new GLTFLoader();
  const entries = Object.entries(MODELS).map(
    ([type, path]) =>
      new Promise((resolve) => {
        loader.load(
          base + path,
          (gltf) => resolve([type, new FigureAsset(gltf)]),
          undefined,
          (err) => {
            console.warn(`Could not load ${path}; using the built-in figure.`, err);
            resolve(null);
          },
        );
      }),
  );
  return Promise.all(entries).then((list) => Object.fromEntries(list.filter(Boolean)));
}

/** One animated instance of a figure in the world. */
export class GltfFigure {
  constructor(asset, u, material) {
    this.asset = asset;
    this.type = u.type;
    this.key = figureKey(u);
    this.root = new THREE.Group();
    const model = cloneSkinned(asset.scene);
    model.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.geometry = asset.teamGeometry(u.owner);
        o.material = material;
        o.castShadow = true;
        o.receiveShadow = true;
        // Skinned bounds are stale once animated; the layer handles visibility.
        o.frustumCulled = false;
      }
    });
    this.root.add(model);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const [name, clip] of Object.entries(asset.clips)) this.actions[name] = this.mixer.clipAction(clip);
    const attack = this.actions.Attack;
    if (attack) {
      attack.setLoop(THREE.LoopOnce, 1);
      attack.clampWhenFinished = false;
    }
    this.current = null;
    this.lastAttackAnim = 0;
    this.yaw = Math.atan2(u.dirX || 0, u.dirY || 1);
    // Start each figure at a different point so crowds don't move in lockstep.
    this.play('Idle', 0);
    if (this.current) this.current.time = (u.id * 0.37) % 2;
  }

  play(name, fade = 0.15) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && fade > 0) next.crossFadeFrom(this.current, fade, false);
    else if (this.current) this.current.stop();
    this.current = next;
  }

  update(u, dt) {
    // A new swing starts whenever the game resets attackAnim upward.
    const swinging = u.attackAnim > 0;
    if (swinging && u.attackAnim > this.lastAttackAnim + 0.01) {
      const a = this.actions.Attack;
      if (a) {
        if (this.current === a) a.reset();
        this.play('Attack', 0.06);
        a.timeScale = a.getClip().duration / 0.42;
      }
    }
    this.lastAttackAnim = u.attackAnim;
    const attacking = this.current === this.actions.Attack && this.current.isRunning();
    if (!attacking) {
      if (u.moving) {
        this.play('Walk');
        // Match the stride to the unit's speed (one cycle is about 0.9 tiles).
        if (this.actions.Walk) this.actions.Walk.timeScale = (u.def.speed / 0.9) * this.actions.Walk.getClip().duration;
      } else {
        this.play('Idle', 0.25);
      }
    }
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
