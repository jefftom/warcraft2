// RTS camera: looks down at a ground target from a fixed pitch, pans across
// the map and zooms in and out. Also converts between screen pixels and the
// ground plane for picking.

import * as THREE from 'three';

const PITCH = THREE.MathUtils.degToRad(56);

export class CameraRig {
  constructor(mapW, mapH) {
    this.mapW = mapW;
    this.mapH = mapH;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.target = new THREE.Vector3(mapW / 2, 0, mapH / 2);
    this.distance = 25;
    this.goalDistance = 25;
    this.minDistance = 11;
    this.maxDistance = 44;
    this.width = 1;
    this.height = 1;
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this.apply();
  }

  setSize(w, h) {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.apply();
  }

  /** Eases zoom toward its goal; call every frame. */
  update(dt) {
    const k = Math.min(1, dt * 10);
    this.distance += (this.goalDistance - this.distance) * k;
    this.clamp();
    this.apply();
  }

  apply() {
    const d = this.distance;
    this.camera.position.set(this.target.x, this.target.y + Math.sin(PITCH) * d, this.target.z + Math.cos(PITCH) * d);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  // Keep the view over the map, allowing a small margin past each edge.
  clamp() {
    const halfW = this.visibleHalfWidth();
    const mx = Math.min(halfW * 0.85, this.mapW / 2);
    this.target.x = THREE.MathUtils.clamp(this.target.x, mx - 2, this.mapW - mx + 2);
    // How far the top and bottom screen edges reach past the target on the ground.
    const half = THREE.MathUtils.degToRad(this.camera.fov) / 2;
    const camH = Math.sin(PITCH) * this.distance;
    const back = Math.cos(PITCH) * this.distance;
    const far = camH / Math.tan(PITCH - half) - back;
    const near = back - camH / Math.tan(PITCH + half);
    const lo = Math.min(far - 2, this.mapH / 2);
    const hi = Math.max(this.mapH - near + 2, this.mapH / 2);
    this.target.z = THREE.MathUtils.clamp(this.target.z, lo, hi);
  }

  visibleHalfWidth() {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    return Math.tan(vfov / 2) * this.distance * this.camera.aspect;
  }

  /** World units per screen pixel around the view centre. */
  unitsPerPixel() {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    return (2 * Math.tan(vfov / 2) * this.distance) / this.height;
  }

  centerOn(x, z) {
    this.target.x = x;
    this.target.z = z;
    this.clamp();
    this.apply();
  }

  panBy(dxPx, dyPx) {
    const k = this.unitsPerPixel();
    this.target.x += dxPx * k;
    this.target.z += (dyPx * k) / Math.sin(PITCH);
    this.clamp();
    this.apply();
  }

  zoomBy(delta) {
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * Math.exp(delta * 0.0012), this.minDistance, this.maxDistance);
  }

  /** Screen pixel -> point on the ground plane (y = 0), or null. */
  screenToGround(sx, sy, out = new THREE.Vector3()) {
    this._ndc.set((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.plane, out);
  }

  /** World point -> screen pixel. `z` of the result is NDC depth (< 1 is in front). */
  project(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    this._v.set(x, y, z).project(this.camera);
    out.x = (this._v.x * 0.5 + 0.5) * this.width;
    out.y = (-this._v.y * 0.5 + 0.5) * this.height;
    out.z = this._v.z;
    return out;
  }

  /** Approximate on-screen size in pixels of `size` world units at a point. */
  pixelsAt(x, y, z, size) {
    const d = this.camera.position.distanceTo(this._v.set(x, y, z));
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    return (size / (2 * Math.tan(vfov / 2) * d)) * this.height;
  }
}
