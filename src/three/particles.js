// Billboard particles (fire, smoke, sparks, dust) drawn as one Points object
// per blend mode. Particles fade out under fog of war like everything else.

import * as THREE from 'three';

function spriteTexture(kind) {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (kind === 'smoke') {
    // A lumpy puff built from overlapping soft blobs.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const r = i === 0 ? 0 : 9 + (i % 3) * 3;
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + Math.sin(a) * r;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
  } else if (kind === 'spark') {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  } else {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
varying vec2 vXZ;
void main() {
  vColor = aColor;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vXZ = wp.xz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max( 0.001, -mv.z );
}`;

const FRAG = `
uniform sampler2D uTex;
uniform sampler2D uFogTex;
uniform vec2 uFogSize;
varying vec4 vColor;
varying vec2 vXZ;
void main() {
  vec4 t = texture2D( uTex, gl_PointCoord );
  float vis = smoothstep( 0.5, 0.9, texture2D( uFogTex, vXZ / uFogSize ).r );
  gl_FragColor = vec4( vColor.rgb * t.rgb, vColor.a * t.a * vis );
  if ( gl_FragColor.a < 0.004 ) discard;
}`;

export class Particles {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./fog.js').FogOfWar} fog
   * @param {{max?: number, additive?: boolean, texture?: 'soft'|'smoke'|'spark'}} opts
   */
  constructor(scene, fog, opts = {}) {
    const max = opts.max || 2048;
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.color = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4);
    this.c1 = new Float32Array(max * 4);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
    this.texture = spriteTexture(opts.texture || 'soft');
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTex: { value: this.texture },
        uScale: { value: 400 },
        uFogTex: fog.uniforms.uFogTex,
        uFogSize: fog.uniforms.uFogSize,
      },
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = opts.additive ? 12 : 11;
    scene.add(this.points);
  }

  /**
   * Emits one particle. Units are world units and seconds.
   * @param {{x:number,y:number,z:number,vx?:number,vy?:number,vz?:number,life:number,
   *   size:number,size1?:number,color:number[],color1?:number[],gravity?:number,drag?:number}} p
   *   colours are [r, g, b, a] in 0..1.
   */
  emit(p) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx || 0;
    this.vel[i * 3 + 1] = p.vy || 0;
    this.vel[i * 3 + 2] = p.vz || 0;
    this.life[i] = p.life;
    this.age[i] = 0;
    this.s0[i] = p.size;
    this.s1[i] = p.size1 ?? p.size;
    const c1 = p.color1 || p.color;
    for (let k = 0; k < 4; k++) {
      this.c0[i * 4 + k] = p.color[k];
      this.c1[i * 4 + k] = c1[k];
    }
    this.gravity[i] = p.gravity || 0;
    this.drag[i] = p.drag || 0;
  }

  /** Call once per frame with the canvas height in CSS px and the camera. */
  update(dt, viewportHeight, camera) {
    this.material.uniforms.uScale.value = viewportHeight * 0.5 * camera.projectionMatrix.elements[5];
    const { pos, vel, size, color, life, age, s0, s1, c0, c1, gravity, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      const k = age[i] / life[i];
      if (k >= 1) {
        life[i] = 0;
        size[i] = 0;
        color[i * 4 + 3] = 0;
        continue;
      }
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i * 3] *= d;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d - gravity[i] * dt;
      vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = s0[i] + (s1[i] - s0[i]) * k;
      for (let c = 0; c < 4; c++) color[i * 4 + c] = c0[i * 4 + c] + (c1[i * 4 + c] - c0[i * 4 + c]) * k;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
  }

  dispose() {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
