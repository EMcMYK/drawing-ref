import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TABLE, findFreeSpot, moveTo, settle } from './layout.js';
import {
  CAMERA_PRESETS,
  LIGHT_PRESETS,
  LIMITS,
  defaultLight,
  newObject,
  randomScene,
} from './model.js';
import { geometryFor, shadeColor } from './shapes.js';

const LIGHT_RADIUS = 4.5;
const LIGHT_TARGET = new THREE.Vector3(0, 0.5, 0);
const ACCENT = 0xe8833a;
const deg = THREE.MathUtils.degToRad;

// A curved studio backdrop: flat floor that sweeps up into a back wall.
function sweepGeometry() {
  const profile = [];
  const floorY = -0.9;
  const radius = 2.5;
  const backZ = -TABLE.halfZ - 2.5;
  profile.push([10, floorY], [backZ + radius, floorY]);
  for (let i = 1; i <= 16; i++) {
    const t = (i / 16) * (Math.PI / 2);
    profile.push([backZ + radius - Math.sin(t) * radius, floorY + radius - Math.cos(t) * radius]);
  }
  profile.push([backZ, 12]);
  const width = 40;
  const positions = [];
  const indices = [];
  profile.forEach(([z, y]) => positions.push(-width / 2, y, z, width / 2, y, z));
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export class StillLife {
  constructor(container, { onChange } = {}) {
    this.container = container;
    this.onChange = onChange ?? (() => {});
    this.objects = []; // plain data, see model.js
    this.views = new Map(); // id -> { group, pivot, mesh }
    this.selectedId = null;
    this.light = defaultLight();
    this.coarse = window.matchMedia('(pointer: coarse)').matches;

    this.#initRenderer();
    this.#initScene();
    this.#initPointer();
    this.#initKeys();

    this.resizeObserver = new ResizeObserver(() => this.#resize());
    this.resizeObserver.observe(container);
    this.#resize();
    this.setCameraPreset('eye');
    this.#applyLight();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // ---- setup ----

  #initRenderer() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'still-life-canvas';
    renderer.domElement.setAttribute('aria-label', '3D still-life scene');
    renderer.domElement.tabIndex = 0;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
  }

  #initScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x8a8986);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100); // fixed, normal lens
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 2.5;
    this.controls.maxDistance = 16;
    this.controls.maxPolarAngle = deg(88);
    this.controls.addEventListener('end', () => this.#changed());

    const sweep = new THREE.Mesh(
      sweepGeometry(),
      new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 1 })
    );
    sweep.receiveShadow = true;
    scene.add(sweep);

    const table = new THREE.Mesh(
      new THREE.BoxGeometry(TABLE.halfX * 2, 0.9, TABLE.halfZ * 2).translate(0, -0.45, 0),
      new THREE.MeshStandardMaterial({ color: 0xc9c5bd, roughness: 0.95 })
    );
    table.receiveShadow = true;
    table.castShadow = true;
    scene.add(table);

    // Fixed, dim fill so shadows never go fully black.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8782, 1.1));

    const spot = new THREE.SpotLight(0xffffff, 1, 0, 0.75, 0.4, 0);
    spot.castShadow = true;
    spot.shadow.mapSize.set(this.coarse ? 1024 : 2048, this.coarse ? 1024 : 2048);
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 20;
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.02;
    spot.target.position.copy(LIGHT_TARGET);
    scene.add(spot, spot.target);
    this.spot = spot;

    // The draggable light handle and a faint line showing where it points.
    this.handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 24, 16),
      new THREE.MeshBasicMaterial({ color: 0xffd27a })
    );
    this.handle.userData.isHandle = true;
    scene.add(this.handle);
    this.beam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), LIGHT_TARGET]),
      new THREE.LineDashedMaterial({ color: 0xffd27a, dashSize: 0.2, gapSize: 0.15, transparent: true, opacity: 0.6 })
    );
    scene.add(this.beam);
    this.helpers = [this.handle, this.beam];
  }

  #initPointer() {
    const el = this.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const domeSphere = new THREE.Sphere(new THREE.Vector3(), LIGHT_RADIUS);
    const hit = new THREE.Vector3();
    let drag = null;
    let down = null;

    const aim = (e) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
    };

    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      down = { x: e.clientX, y: e.clientY };
      aim(e);
      const meshes = [this.handle, ...[...this.views.values()].map((v) => v.mesh)];
      const first = raycaster.intersectObjects(meshes, false)[0];
      if (!first) return;
      if (first.object.userData.isHandle) {
        drag = { kind: 'light' };
      } else {
        const id = first.object.userData.id;
        this.select(id);
        const obj = this.#find(id);
        // Drag across a level plane at the height where the shape was
        // grabbed, so it stays under the pointer instead of drifting.
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -first.point.y);
        drag = { kind: 'object', id, plane, dx: obj.x - first.point.x, dz: obj.z - first.point.z };
      }
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!drag) {
        if (e.pointerType === 'mouse') this.#hover(e, aim, raycaster);
        return;
      }
      aim(e);
      if (drag.kind === 'light') {
        // Aim at the dome; if the ray misses it, use the nearest point on it.
        if (!raycaster.ray.intersectSphere(domeSphere, hit)) {
          raycaster.ray.closestPointToPoint(domeSphere.center, hit);
          hit.setLength(LIGHT_RADIUS);
        }
        const elevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hit.y / LIGHT_RADIUS, -1, 1)));
        const azimuth = THREE.MathUtils.radToDeg(Math.atan2(hit.x, hit.z));
        this.setLight({ azimuth, elevation });
      } else if (raycaster.ray.intersectPlane(drag.plane, hit)) {
        this.#moveObject(drag.id, hit.x + drag.dx, hit.z + drag.dz);
      }
    });

    const end = (e) => {
      const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
      if (!drag && tap) this.select(null); // tapped empty space
      if (drag) this.#changed();
      drag = null;
      down = null;
      this.controls.enabled = true;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  #hover(e, aim, raycaster) {
    aim(e);
    const meshes = [this.handle, ...[...this.views.values()].map((v) => v.mesh)];
    const over = raycaster.intersectObjects(meshes, false).length > 0;
    this.renderer.domElement.style.cursor = over ? 'grab' : '';
  }

  #initKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.selectedId || !this.renderer.domElement.isConnected) return;
      if (e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'q' || e.key === 'Q') this.rotateSelected(-15);
      else if (e.key === 'e' || e.key === 'E') this.rotateSelected(15);
      else if (e.key === 'Delete' || e.key === 'Backspace') this.deleteSelected();
      else if (e.key === 'Escape') this.select(null);
      else return;
      e.preventDefault();
    });
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #frame() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---- objects ----

  #find(id) {
    return this.objects.find((o) => o.id === id);
  }

  #buildView(obj) {
    const mesh = new THREE.Mesh(
      geometryFor(obj.shape),
      new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 })
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = obj.id;
    const outline = new THREE.Mesh(
      mesh.geometry,
      new THREE.MeshBasicMaterial({ color: ACCENT, side: THREE.BackSide })
    );
    outline.scale.setScalar(1.05);
    outline.position.y = -0.025;
    outline.raycast = () => {};
    outline.visible = false;
    mesh.add(outline);
    const pivot = new THREE.Group(); // rotation + centring
    pivot.add(mesh);
    const group = new THREE.Group(); // position on the table
    group.add(pivot);
    this.scene.add(group);
    const view = { group, pivot, mesh, outline };
    this.views.set(obj.id, view);
    return view;
  }

  // Apply an object's data to its 3D view and return its footprint box.
  #syncView(obj) {
    const view = this.views.get(obj.id) ?? this.#buildView(obj);
    const { group, pivot, mesh, outline } = view;
    mesh.scale.set(obj.size, obj.size * obj.height, obj.size);
    mesh.material.color.setHex(shadeColor(obj.shade));
    outline.visible = obj.id === this.selectedId;
    pivot.rotation.set(0, deg(obj.rotY), obj.tipped ? Math.PI / 2 : 0, 'YXZ');
    pivot.position.set(0, 0, 0);
    group.position.set(0, 0, 0);
    mesh.remove(outline); // measure the shape itself, not its outline
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh, true);
    mesh.add(outline);
    const center = box.getCenter(new THREE.Vector3());
    pivot.position.set(-center.x, -box.min.y, -center.z);
    const size = box.getSize(new THREE.Vector3());
    group.position.set(obj.x, obj.y, obj.z);
    return { id: obj.id, x: obj.x, z: obj.z, y: obj.y, halfX: size.x / 2, halfZ: size.z / 2, height: size.y };
  }

  #boxes() {
    return this.objects.map((o) => this.#syncView(o));
  }

  #applyBoxes(boxes) {
    for (const b of boxes) Object.assign(this.#find(b.id), { x: b.x, y: b.y, z: b.z });
    this.objects.forEach((o) => this.#syncView(o));
  }

  #moveObject(id, x, z) {
    this.#applyBoxes(moveTo(this.#boxes(), id, x, z));
  }

  // Re-place one object where it stands, e.g. after it changed size.
  #resettle(id) {
    const o = this.#find(id);
    if (o) this.#moveObject(id, o.x, o.z);
    else this.#applyBoxes(settle(this.#boxes()));
  }

  addShape(shape) {
    if (this.objects.length >= LIMITS.maxObjects) return false;
    const obj = newObject(shape);
    this.objects.push(obj);
    const box = this.#syncView(obj);
    const others = this.#boxes().filter((b) => b.id !== obj.id);
    Object.assign(obj, findFreeSpot(others, box));
    this.#resettle(obj.id);
    this.select(obj.id);
    return true;
  }

  select(id) {
    this.selectedId = id && this.#find(id) ? id : null;
    for (const [oid, view] of this.views) view.outline.visible = oid === this.selectedId;
    this.#changed();
  }

  get selected() {
    return this.selectedId ? this.#find(this.selectedId) : null;
  }

  updateSelected(patch) {
    const o = this.selected;
    if (!o) return;
    Object.assign(o, patch);
    this.#resettle(o.id);
    this.#changed();
  }

  rotateSelected(degrees) {
    const o = this.selected;
    if (o) this.updateSelected({ rotY: (((o.rotY + degrees) % 360) + 360) % 360 });
  }

  tipSelected() {
    const o = this.selected;
    if (o) this.updateSelected({ tipped: !o.tipped });
  }

  duplicateSelected() {
    const o = this.selected;
    if (!o || this.objects.length >= LIMITS.maxObjects) return;
    const { id, ...rest } = o;
    const copy = newObject(o.shape, { ...rest, y: 0 });
    this.objects.push(copy);
    const box = this.#syncView(copy);
    Object.assign(copy, findFreeSpot(this.#boxes().filter((b) => b.id !== copy.id), box));
    this.#resettle(copy.id);
    this.select(copy.id);
  }

  deleteSelected() {
    const o = this.selected;
    if (!o) return;
    this.#removeView(o.id);
    this.objects = this.objects.filter((x) => x.id !== o.id);
    this.selectedId = null;
    this.#applyBoxes(settle(this.#boxes())); // anything on top falls
    this.#changed();
  }

  #removeView(id) {
    const view = this.views.get(id);
    if (!view) return;
    this.scene.remove(view.group);
    view.mesh.material.dispose();
    view.outline.material.dispose();
    this.views.delete(id);
  }

  clear() {
    for (const id of [...this.views.keys()]) this.#removeView(id);
    this.objects = [];
    this.selectedId = null;
  }

  loadScene({ objects = [], light, camera } = {}) {
    this.clear();
    this.objects = objects.slice(0, LIMITS.maxObjects).map((o) => ({ ...o }));
    // Keep objects on the table and apart, then let stacks settle.
    let boxes = this.#boxes();
    for (const o of this.objects) boxes = moveTo(boxes, o.id, o.x, o.z);
    this.#applyBoxes(boxes);
    if (light) this.setLight(light, { silent: true });
    if (camera) {
      this.camera.position.fromArray(camera.position);
      this.controls.target.fromArray(camera.target);
      this.controls.update();
    }
    this.#changed();
  }

  randomize() {
    this.loadScene(randomScene());
  }

  // ---- light and camera ----

  setLight(patch, { silent = false } = {}) {
    const next = { ...this.light, ...patch };
    next.elevation = THREE.MathUtils.clamp(next.elevation, ...LIMITS.elevation);
    next.intensity = THREE.MathUtils.clamp(next.intensity, ...LIMITS.intensity);
    next.azimuth = ((((next.azimuth + 180) % 360) + 360) % 360) - 180;
    this.light = { azimuth: next.azimuth, elevation: next.elevation, intensity: next.intensity };
    this.#applyLight();
    if (!silent) this.#changed();
  }

  applyLightPreset(key) {
    const p = LIGHT_PRESETS[key];
    if (p) this.setLight({ azimuth: p.azimuth, elevation: p.elevation });
  }

  #applyLight() {
    const { azimuth, elevation, intensity } = this.light;
    const el = deg(elevation);
    const az = deg(azimuth);
    const pos = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az)
    ).multiplyScalar(LIGHT_RADIUS);
    this.spot.position.copy(pos);
    this.spot.intensity = intensity * 2.2;
    this.handle.position.copy(pos);
    this.beam.geometry.setFromPoints([pos, LIGHT_TARGET]);
    this.beam.computeLineDistances();
  }

  setCameraPreset(key) {
    const p = CAMERA_PRESETS[key];
    if (!p) return;
    this.camera.position.fromArray(p.position);
    this.controls.target.fromArray(p.target);
    this.controls.update();
    this.#changed();
  }

  // ---- saving ----

  toJSON() {
    return {
      version: 1,
      objects: this.objects.map(({ id, ...rest }) => rest),
      light: this.light,
      camera: {
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
      },
    };
  }

  // Render the current view without the light handle or selection outline,
  // at twice the screen's resolution, and return it as a PNG blob.
  async toPng() {
    const prevRatio = this.renderer.getPixelRatio();
    const ratio = Math.max(2, Math.min(window.devicePixelRatio, 3));
    const hidden = [...this.helpers, ...[...this.views.values()].map((v) => v.outline)];
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    this.renderer.setPixelRatio(ratio);
    this.#resize();
    this.renderer.render(this.scene, this.camera);
    const blob = await new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
    hidden.forEach((o, i) => (o.visible = wasVisible[i]));
    this.renderer.setPixelRatio(prevRatio);
    this.#resize();
    return blob;
  }

  #changed() {
    this.onChange(this);
  }
}
