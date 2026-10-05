// Fog of war for the 3D view. The game's per-tile visibility is copied into a
// small texture (one texel per tile) that eases toward its target each frame,
// so revealed ground fades in instead of popping. Materials are patched to
// sample it by world position: unexplored is black, explored-but-not-visible
// is dim and desaturated, visible is untouched.

import * as THREE from 'three';

const EXPLORED = 0.42;

export class FogOfWar {
  constructor(game) {
    this.game = game;
    const { w, h } = game.map;
    this.w = w;
    this.h = h;
    this.level = new Float32Array(w * h);
    this.data = new Uint8Array(w * h * 4);
    this.texture = new THREE.DataTexture(this.data, w, h, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms = {
      uFogTex: { value: this.texture },
      uFogSize: { value: new THREE.Vector2(w, h) },
      uTime: { value: 0 },
    };
    this.update(0, 0, true);
  }

  /** Visibility (0..1) at a tile, after easing; for culling things in the dark. */
  levelAt(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.level[y * this.w + x];
  }

  update(dt, time, snap = false) {
    const fog = this.game.fog;
    const reveal = this.game.revealMap;
    const k = snap ? 1 : Math.min(1, dt * 5);
    const { level, data } = this;
    for (let i = 0, n = level.length; i < n; i++) {
      const target = reveal || fog.visible[i] ? 1 : fog.explored[i] ? EXPLORED : 0;
      let v = level[i];
      v += (target - v) * k;
      if (Math.abs(target - v) < 0.004) v = target;
      level[i] = v;
      const b = (v * 255) | 0;
      data[i * 4] = b;
      data[i * 4 + 1] = b;
      data[i * 4 + 2] = b;
      data[i * 4 + 3] = 255;
    }
    this.texture.needsUpdate = true;
    this.uniforms.uTime.value = time;
  }

  /**
   * Adds fog-of-war to a built-in material (Standard, Lambert, Basic, Phong...).
   * opts.beginVertex: GLSL run after `transformed` is set, e.g. wind sway.
   *   It may use `uTime`. With instancing, `instanceMatrix` is available.
   * opts.uniforms: extra uniforms to declare and bind ({ name: { value } }),
   *   declared as `uniform float name;` unless opts.uniformTypes says otherwise.
   * opts.key: distinct string when beginVertex differs between materials.
   */
  patch(material, opts = {}) {
    const fogUniforms = this.uniforms;
    const extra = opts.uniforms || {};
    const types = opts.uniformTypes || {};
    const decl = Object.keys(extra)
      .map((n) => `uniform ${types[n] || 'float'} ${n};`)
      .join('\n');
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, fogUniforms, extra);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec2 vFogXZ;
uniform float uTime;
${decl}`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
${opts.beginVertex || ''}`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
vec4 fogWp = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  fogWp = instanceMatrix * fogWp;
#endif
fogWp = modelMatrix * fogWp;
vFogXZ = fogWp.xz;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform sampler2D uFogTex;
uniform vec2 uFogSize;
varying vec2 vFogXZ;`,
        )
        .replace(
          '#include <dithering_fragment>',
          `float fogV = texture2D( uFogTex, vFogXZ / uFogSize ).r;
vec3 fogC = gl_FragColor.rgb;
float fogL = dot( fogC, vec3( 0.299, 0.587, 0.114 ) );
fogC = mix( vec3( fogL ) * vec3( 0.86, 0.9, 1.05 ), fogC, smoothstep( 0.35, 1.0, fogV ) );
gl_FragColor.rgb = fogC * fogV;
#include <dithering_fragment>`,
        );
    };
    const key = `fog:${opts.key || ''}`;
    material.customProgramCacheKey = () => key;
    material.needsUpdate = true;
    return material;
  }

  dispose() {
    this.texture.dispose();
  }
}
