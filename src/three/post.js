// Post-processing for the brick style: a soft bloom on glossy highlights and a
// tilt-shift blur toward the top and bottom of the screen, so the battlefield
// reads like a photograph of a tabletop diorama.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';

export class DioramaPost {
  constructor(renderer, scene, camera) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.1, 0.3, 1.4);
    this.composer.addPass(this.bloom);
    this.hBlur = new ShaderPass(HorizontalTiltShiftShader);
    this.vBlur = new ShaderPass(VerticalTiltShiftShader);
    this.composer.addPass(this.hBlur);
    this.composer.addPass(this.vBlur);
    this.composer.addPass(new OutputPass());
    this.strength = 1.6;
    this.focus = 0.5;
  }

  setSize(width, height, dpr) {
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(width, height);
    this.hBlur.uniforms.h.value = this.strength / (width * dpr);
    this.vBlur.uniforms.v.value = this.strength / (height * dpr);
    this.hBlur.uniforms.r.value = this.focus;
    this.vBlur.uniforms.r.value = this.focus;
  }

  render() {
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
  }
}
