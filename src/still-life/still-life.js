import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { TABLE, clampToTable, findFreeSpot, moveTo, settle } from './layout.js';
import {
  CAMERA_PRESETS,
  LIGHT_PRESETS,
  LIMITS,
  VIEW_LIMITS,
  defaultLight,
  newObject,
  randomScene,
} from './model.js';
import { geometryFor, shadeColor, tipAngle } from './shapes.js';

const LIGHT_RADIUS = 4.5;
// Where the camera may go: within a circle round the middle of the table,
// the same distance from every side, and between the table top and the
// ceiling. The studio wall stands a little outside that circle.
const ROOM = { radius: 12, minY: 0.05, maxY: 14 };
const STUDIO_RADIUS = 16;
const LIGHT_TARGET = new THREE.Vector3(0, 0.5, 0);
const ACCENT = 0xe8833a;
const deg = THREE.MathUtils.degToRad;

// A round studio: a flat floor that curves up into a wall all the way
// round, so every camera angle has a plain backdrop behind the table.
function studioGeometry() {
  const floorY = -0.9;
  const curve = 2.5;
  const wall = STUDIO_RADIUS;
  const points = [new THREE.Vector2(0, floorY), new THREE.Vector2(wall - curve, floorY)];
  for (let i = 1; i <= 16; i++) {
    const t = (i / 16) * (Math.PI / 2);
    points.push(new THREE.Vector2(wall - curve + Math.sin(t) * curve, floorY + curve - Math.cos(t) * curve));
  }
  points.push(new THREE.Vector2(wall, 16));
  return new THREE.LatheGeometry(points, 96);
}

export class StillLife {
  constructor(container, { onChange, onView } = {}) {
    this.container = container;
    this.onChange = onChange ?? (() => {});
    this.onView = onView ?? (() => {});
    this.objects = []; // plain data, see model.js
    this.views = new Map(); // id -> { group, pivot, mesh }
    this.selectedId = null;
    this.light = defaultLight();
    this.overlap = false; // let shapes pass through each other
    this.coarse = window.matchMedia('(pointer: coarse)').matches;
    this.mirrored = false;

    this.rotating = false; // free-rotate mode for the selected object
    this.#initRenderer();
    this.#initScene();
    // Before #initPointer, so the rings see a press before the scene does.
    this.#initGizmo();
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
    this.controls.minDistance = VIEW_LIMITS.distance[0];
    this.controls.maxDistance = VIEW_LIMITS.distance[1];
    this.controls.minPolarAngle = deg(90 - VIEW_LIMITS.elevation[1]);
    this.controls.maxPolarAngle = deg(90 - VIEW_LIMITS.elevation[0]);
    // Panning moves the point the camera circles. Keep that point over the
    // table and above its top, so the camera can't sink into the table or
    // drift away from the scene.
    this.controls.addEventListener('change', () => {
      const t = this.controls.target;
      const clamped = new THREE.Vector3(
        THREE.MathUtils.clamp(t.x, -TABLE.halfX, TABLE.halfX),
        THREE.MathUtils.clamp(t.y, 0, 2.5),
        THREE.MathUtils.clamp(t.z, -TABLE.halfZ, TABLE.halfZ)
      );
      const moved = !clamped.equals(t);
      if (moved) {
        this.camera.position.add(clamped.clone().sub(t));
        t.copy(clamped);
      }
      if (this.#keepCameraInRoom() || moved) this.camera.lookAt(t);
      this.onView();
    });
    this.controls.addEventListener('end', () => this.#changed());
    // When the view is shown mirrored (the Flip drawing aid), turn sideways
    // drags around too so the scene still follows the pointer. These are
    // OrbitControls internals; three.js is pinned in package.json.
    const controls = this.controls;
    for (const name of ['_rotateLeft', '_panLeft']) {
      const original = controls[name].bind(controls);
      controls[name] = (amount, ...rest) => original(this.mirrored ? -amount : amount, ...rest);
    }

    const sweep = new THREE.Mesh(
      studioGeometry(),
      // Both sides, so the inside is lit correctly whichever way the
      // lathe's faces point.
      new THREE.MeshStandardMaterial({ color: 0x9a9894, roughness: 1, side: THREE.DoubleSide })
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
    // Shadows are cast from light-facing sides (see #buildView), which
    // needs a little more bias to avoid speckle. Phones get a smaller shadow
    // map and less depth precision, so they need more.
    spot.shadow.bias = this.coarse ? -0.0015 : -0.0005;
    spot.shadow.normalBias = this.coarse ? 0.05 : 0.025;
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

  // Free rotation: three rings (X, Y, Z) around the selected object. They
  // turn a stand-in placed at the object's centre; its turn is copied to the
  // object, which then settles back onto the table or the shape below.
  #initGizmo() {
    const proxy = new THREE.Object3D();
    this.scene.add(proxy);
    const gizmo = new TransformControls(this.camera, this.renderer.domElement);
    gizmo.setMode('rotate');
    gizmo.setSpace('world');
    gizmo.setSize(this.coarse ? 1.3 : 1);
    gizmo.enabled = false;
    // Mirror the pointer too when the view is flipped (see setMirrored).
    const getPointer = gizmo._getPointer;
    gizmo._getPointer = (e) => {
      const p = getPointer(e);
      if (this.mirrored) p.x = -p.x;
      return p;
    };
    gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value) this.#changed();
    });
    gizmo.addEventListener('objectChange', () => this.#applyGizmo());
    const helper = gizmo.getHelper();
    helper.visible = false;
    this.scene.add(helper);
    // Keep only the red, green and blue rings: drop the yellow view ring
    // and the gray free-spin ball (TransformControls internals; three.js is
    // pinned in package.json). The yellow arrow below takes their place.
    for (const group of [gizmo._gizmo.gizmo.rotate, gizmo._gizmo.picker.rotate]) {
      for (const child of [...group.children]) if (child.name === 'E' || child.name === 'XYZE') group.remove(child);
    }

    // The lift arrow: a yellow up/down arrow above the rings. Drag it to
    // raise the object off the table, or lower it back down.
    const yellow = new THREE.MeshBasicMaterial({ color: 0xffc533, depthTest: false, transparent: true });
    const lift = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 12), yellow);
    const up = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 16).translate(0, 0.25, 0), yellow);
    const down = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.16, 16).rotateX(Math.PI).translate(0, -0.25, 0), yellow);
    // A bigger, invisible grab area so it's easy to hit with a finger.
    const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 8), new THREE.MeshBasicMaterial({ visible: false }));
    lift.add(shaft, up, down, grab);
    lift.renderOrder = 999;
    lift.traverse((m) => (m.renderOrder = 999));
    lift.visible = false;
    grab.userData.isLift = true;
    this.scene.add(lift);
    this.liftHandle = lift;
    this.liftGrab = grab;
    this.gizmo = gizmo;
    this.gizmoHelper = helper;
    this.proxy = proxy;

    // A Done button over the view while rotating.
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'rotate-done primary';
    done.textContent = 'Done rotating';
    done.hidden = true;
    done.addEventListener('click', () => this.setRotating(false));
    this.container.appendChild(done);
    this.doneButton = done;
  }

  // Keep the lift arrow just to the right of the rings (so it stays on
  // screen when the object is high), at the same on-screen size, using the
  // same sum TransformControls uses to size its rings.
  #placeLiftHandle() {
    const p = this.proxy.position;
    const cam = this.camera;
    const factor = p.distanceTo(cam.position) * Math.min((1.9 * Math.tan((Math.PI * cam.fov) / 360)) / cam.zoom, 7);
    const scale = (factor * this.gizmo.size) / 4;
    this.liftHandle.scale.setScalar(scale);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).setY(0).normalize();
    if (this.mirrored) right.negate();
    this.liftHandle.position.copy(p).addScaledVector(right, 0.85 * scale);
  }

  #rotationOf(obj) {
    const tip = obj.tipped ? tipAngle(obj.shape, obj.size, obj.height) : 0;
    return new THREE.Euler(deg(obj.rotX ?? 0), deg(obj.rotY), tip + deg(obj.rotZ ?? 0), 'YXZ');
  }

  // Put the rings' stand-in at the object's centre, turned like the object.
  #placeProxy() {
    const o = this.selected;
    const view = o && this.views.get(o.id);
    if (!view) return;
    view.group.updateMatrixWorld(true); // #syncView leaves it stale
    const box = new THREE.Box3().setFromObject(view.mesh, true);
    box.getCenter(this.proxy.position);
    this.proxy.quaternion.setFromEuler(this.#rotationOf(o));
    this.proxy.updateMatrixWorld();
  }

  #applyGizmo() {
    const o = this.selected;
    if (!o) return;
    const e = new THREE.Euler().setFromQuaternion(this.proxy.quaternion, 'YXZ');
    const tip = o.tipped ? tipAngle(o.shape, o.size, o.height) : 0;
    const d = (r) => THREE.MathUtils.radToDeg(r);
    const wrap = (v) => ((Math.round(v) % 360) + 360) % 360;
    o.rotX = d(e.x);
    o.rotY = wrap(d(e.y));
    o.rotZ = d(e.z - tip);
    this.#resettle(o.id);
    // Follow the object if it settled somewhere else, without turning the
    // stand-in back (that would fight the drag).
    const view = this.views.get(o.id);
    view.group.updateMatrixWorld(true);
    new THREE.Box3().setFromObject(view.mesh, true).getCenter(this.proxy.position);
    this.onChange(this);
  }

  // Turn free rotation on or off for the selected object.
  setRotating(on) {
    const want = !!on && !!this.selected;
    this.rotating = want;
    if (want) {
      this.#placeProxy();
      this.gizmo.attach(this.proxy);
    } else {
      this.gizmo.detach();
    }
    this.gizmo.enabled = want;
    this.gizmoHelper.visible = want;
    this.liftHandle.visible = want;
    this.doneButton.hidden = !want;
    this.#changed();
  }

  // Back to standing upright: no free rotation and not tipped over.
  resetRotation() {
    const o = this.selected;
    if (!o) return;
    this.updateSelected({ rotX: 0, rotZ: 0, tipped: false });
    if (this.rotating) this.#placeProxy();
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
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      ndc.set(this.mirrored ? -x : x, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, this.camera);
    };

    el.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary) return;
      aim(e);
      if (this.rotating && raycaster.intersectObject(this.liftGrab, false).length) {
        // Drag the lift arrow: follow the pointer up and down on an upright
        // plane through the object that faces the camera.
        const o = this.selected;
        const normal = this.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.proxy.position);
        if (!raycaster.ray.intersectPlane(plane, hit)) return;
        drag = { kind: 'lift', id: o.id, plane, startY: hit.y, startLift: o.lift ?? 0 };
        down = { x: e.clientX, y: e.clientY, ring: true };
        this.controls.enabled = false;
        el.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      down = { x: e.clientX, y: e.clientY, ring: this.rotating && this.gizmo.axis !== null };
      if (down.ring) return; // the rings handle this press
      const meshes = [this.handle, ...[...this.views.values()].map((v) => v.mesh)];
      const first = raycaster.intersectObjects(meshes, false)[0];
      down.hitId = first && !first.object.userData.isHandle ? first.object.userData.id : null;
      if (!first) return;
      // While rotating, the object stays put: a press on it can only be a
      // tap (handled in end), and drags orbit the camera.
      if (this.rotating && !first.object.userData.isHandle) return;
      if (first.object.userData.isHandle) {
        drag = { kind: 'light' };
      } else {
        const id = first.object.userData.id;
        down.wasSelected = id === this.selectedId;
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
      } else if (drag.kind === 'lift') {
        if (raycaster.ray.intersectPlane(drag.plane, hit)) {
          const lift = THREE.MathUtils.clamp(drag.startLift + hit.y - drag.startY, ...LIMITS.lift);
          this.updateSelected({ lift: Math.round(lift * 100) / 100 });
        }
      } else if (raycaster.ray.intersectPlane(drag.plane, hit)) {
        this.#moveObject(drag.id, hit.x + drag.dx, hit.z + drag.dz);
      }
    });

    const end = (e) => {
      const tap = down && !down.ring && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
      if (tap && this.rotating) {
        // Tap the object again, or empty space, to go back to moving things.
        if (down.hitId && down.hitId !== this.selectedId) this.select(down.hitId);
        this.setRotating(false);
        if (!down.hitId) this.select(null);
      } else if (tap && drag?.kind === 'object' && down.wasSelected) {
        this.setRotating(true); // tap a selected object to rotate it freely
      } else if (!drag && tap) this.select(null); // tapped empty space
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
      else if (e.key === 'Escape') this.rotating ? this.setRotating(false) : this.select(null);
      else return;
      e.preventDefault();
    });
  }

  // Keep the camera inside the room (see ROOM). If it would leave, slide it
  // in toward the point it looks at. Returns true if it moved.
  #keepCameraInRoom() {
    const pos = this.camera.position;
    const t = this.controls.target;
    const d = pos.clone().sub(t);
    let f = 1;
    // Circle: the largest f with |t.xz + f·d.xz| <= radius.
    const a = d.x * d.x + d.z * d.z;
    if (a > 0 && Math.hypot(pos.x, pos.z) > ROOM.radius) {
      const b = 2 * (t.x * d.x + t.z * d.z);
      const c = t.x * t.x + t.z * t.z - ROOM.radius * ROOM.radius;
      f = Math.min(f, (-b + Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a));
    }
    if (d.y > 0 && pos.y > ROOM.maxY) f = Math.min(f, (ROOM.maxY - t.y) / d.y);
    if (d.y < 0 && pos.y < ROOM.minY) f = Math.min(f, (ROOM.minY - t.y) / d.y);
    if (f >= 1) return false;
    pos.copy(t).addScaledVector(d, Math.max(f, 0));
    return true;
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    // Setting a canvas's size clears it, even to the same size, which shows
    // as a flash. Phones fire resizes while scrolling, so skip no-op ones.
    const ratio = this.renderer.getPixelRatio();
    const canvas = this.renderer.domElement;
    if (canvas.width === Math.floor(w * ratio) && canvas.height === Math.floor(h * ratio)) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #frame() {
    this.controls.update();
    if (this.rotating) this.#placeLiftHandle();
    this.renderer.render(this.scene, this.camera);
  }

  // ---- objects ----

  #find(id) {
    return this.objects.find((o) => o.id === id);
  }

  #buildView(obj) {
    const mesh = new THREE.Mesh(
      geometryFor(obj.shape),
      // Shadows come from the faces that point at the light. three.js
      // defaults to the far faces, which lets light leak under round
      // shapes where they touch the table, and where shapes pass through
      // each other.
      new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, shadowSide: THREE.FrontSide })
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
    pivot.rotation.copy(this.#rotationOf(obj));
    pivot.position.set(0, 0, 0);
    group.position.set(0, 0, 0);
    mesh.remove(outline); // measure the shape itself, not its outline
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh, true);
    mesh.add(outline);
    const center = box.getCenter(new THREE.Vector3());
    pivot.position.set(-center.x, -box.min.y, -center.z);
    const size = box.getSize(new THREE.Vector3());
    // Lifted objects float above where they'd rest; anything stacked on
    // them sits on top of the raised object.
    const lift = obj.lift ?? 0;
    group.position.set(obj.x, obj.y + lift, obj.z);
    return { id: obj.id, x: obj.x, z: obj.z, y: obj.y, halfX: size.x / 2, halfZ: size.z / 2, height: size.y + lift };
  }

  #boxes() {
    return this.objects.map((o) => this.#syncView(o));
  }

  #applyBoxes(boxes) {
    for (const b of boxes) Object.assign(this.#find(b.id), { x: b.x, y: b.y, z: b.z });
    this.objects.forEach((o) => this.#syncView(o));
  }

  #moveObject(id, x, z) {
    this.#applyBoxes(moveTo(this.#boxes(), id, x, z, { overlap: this.overlap }));
  }

  // Let shapes pass through each other, or push them apart and restack them.
  setOverlap(on) {
    this.overlap = !!on;
    if (!this.overlap) this.#separateAll();
    this.#changed();
  }

  // Keep every object on the table and apart, then let stacks settle.
  #separateAll() {
    let boxes = this.#boxes();
    if (this.overlap) boxes = boxes.map((b) => ({ ...clampToTable(b), y: b.y }));
    else for (const o of this.objects) boxes = moveTo(boxes, o.id, o.x, o.z);
    this.#applyBoxes(boxes);
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
    const next = id && this.#find(id) ? id : null;
    if (this.rotating && next !== this.selectedId) {
      this.selectedId = next;
      this.setRotating(false);
    }
    this.selectedId = next;
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
    if (this.rotating && !this.gizmo.dragging) this.#placeProxy();
    this.#changed();
  }

  rotateSelected(degrees) {
    const o = this.selected;
    if (o) this.setTurn(o.rotY + degrees);
  }

  // Turn the selected shape to an angle in degrees, 0–359.
  setTurn(degrees) {
    this.updateSelected({ rotY: ((Math.round(degrees) % 360) + 360) % 360 });
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
    if (this.rotating) this.setRotating(false);
    this.#removeView(o.id);
    this.objects = this.objects.filter((x) => x.id !== o.id);
    this.selectedId = null;
    if (!this.overlap) this.#applyBoxes(settle(this.#boxes())); // anything on top falls
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
    if (this.rotating) this.setRotating(false);
    for (const id of [...this.views.keys()]) this.#removeView(id);
    this.objects = [];
    this.selectedId = null;
  }

  // Take every object off the table; the light and camera stay.
  clearAll() {
    this.clear();
    this.#changed();
  }

  loadScene({ objects = [], light, camera, overlap } = {}) {
    this.clear();
    if (overlap !== undefined) this.overlap = overlap === true;
    this.objects = objects.slice(0, LIMITS.maxObjects).map((o) => ({ ...o }));
    this.#separateAll();
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

  // The camera as three slider values: degrees around the table, degrees
  // above it, and distance from the point it looks at.
  get view() {
    return {
      azimuth: THREE.MathUtils.radToDeg(this.controls.getAzimuthalAngle()),
      elevation: 90 - THREE.MathUtils.radToDeg(this.controls.getPolarAngle()),
      distance: this.controls.getDistance(),
    };
  }

  setView(patch) {
    const next = { ...this.view, ...patch };
    const clamp = (v, [lo, hi]) => THREE.MathUtils.clamp(v, lo, hi);
    const offset = new THREE.Vector3().setFromSphericalCoords(
      clamp(next.distance, VIEW_LIMITS.distance),
      deg(90 - clamp(next.elevation, VIEW_LIMITS.elevation)),
      deg(next.azimuth)
    );
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
    this.#changed();
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
      overlap: this.overlap,
      camera: {
        position: this.camera.position.toArray(),
        target: this.controls.target.toArray(),
      },
    };
  }

  // Show the view mirrored left to right. Only the screen is flipped; saved
  // images stay the right way round.
  setMirrored(on) {
    this.mirrored = on;
    this.renderer.domElement.style.transform = on ? 'scaleX(-1)' : '';
  }

  // Render the current view without the light handle or selection outline,
  // at twice the screen's resolution, and return it as a PNG blob.
  async toPng() {
    const prevRatio = this.renderer.getPixelRatio();
    const ratio = Math.max(2, Math.min(window.devicePixelRatio, 3));
    const hidden = [...this.helpers, this.gizmoHelper, this.liftHandle, ...[...this.views.values()].map((v) => v.outline)];
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
