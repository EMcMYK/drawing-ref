// Pure layout logic for the still-life table: keeping objects on the table,
// stopping them overlapping, and stacking one on another.
// Each "box" is an object's footprint and height as seen from above:
// { id, x, z, halfX, halfZ, height, y, lift }. `y` is where it rests;
// `lift` (optional) raises it further, so it spans y + lift to top(box).

export const TABLE = { halfX: 4, halfZ: 2.5 };

const GAP = 0.02;

const bottom = (b) => b.y + (b.lift ?? 0);
export const top = (b) => bottom(b) + b.height;

export function clampToTable(box) {
  const maxX = Math.max(0, TABLE.halfX - box.halfX);
  const maxZ = Math.max(0, TABLE.halfZ - box.halfZ);
  return {
    ...box,
    x: Math.min(maxX, Math.max(-maxX, box.x)),
    z: Math.min(maxZ, Math.max(-maxZ, box.z)),
  };
}

function containsPoint(box, x, z, shrink = 0) {
  return (
    Math.abs(x - box.x) <= box.halfX - shrink &&
    Math.abs(z - box.z) <= box.halfZ - shrink
  );
}

function overlaps(a, b) {
  return (
    Math.abs(a.x - b.x) < a.halfX + b.halfX &&
    Math.abs(a.z - b.z) < a.halfZ + b.halfZ
  );
}

// The object directly under point (x, z) that something dropped there would
// rest on: the tallest one whose footprint contains the point.
export function supportAt(boxes, x, z, excludeId) {
  let best = null;
  for (const b of boxes) {
    if (b.id === excludeId) continue;
    if (!containsPoint(b, x, z, Math.min(b.halfX, b.halfZ) * 0.15)) continue;
    if (!best || top(b) > top(best)) best = b;
  }
  return best;
}

// Push `box` sideways out of any object it overlaps at its own resting level.
// Objects it is stacked on, or that are stacked on it, don't count.
export function resolveOverlaps(box, boxes) {
  let moved = { ...box };
  for (let pass = 0; pass < 8; pass++) {
    let pushed = false;
    for (const other of boxes) {
      if (other.id === moved.id) continue;
      const sameLevel = bottom(moved) < top(other) - GAP && bottom(other) < top(moved) - GAP;
      if (!sameLevel || !overlaps(moved, other)) continue;
      const dx = moved.x - other.x;
      const dz = moved.z - other.z;
      const needX = moved.halfX + other.halfX + GAP - Math.abs(dx);
      const needZ = moved.halfZ + other.halfZ + GAP - Math.abs(dz);
      if (needX < needZ) moved.x += (dx >= 0 ? 1 : -1) * needX;
      else moved.z += (dz >= 0 ? 1 : -1) * needZ;
      moved = clampToTable(moved);
      pushed = true;
    }
    if (!pushed) break;
  }
  return moved;
}

// Drop every object onto whatever is under its centre, lowest first, so a
// stack falls when the object underneath is moved away.
export function settle(boxes) {
  const order = [...boxes].sort((a, b) => a.y - b.y);
  const placed = [];
  for (const box of order) {
    const support = supportAt(placed, box.x, box.z, box.id);
    placed.push({ ...box, y: support ? top(support) : 0 });
  }
  const byId = new Map(placed.map((b) => [b.id, b]));
  return boxes.map((b) => byId.get(b.id));
}

// Move one object to (x, z): it stacks on whatever is under that point,
// otherwise it slides clear of its neighbours. Returns all boxes, settled.
// With `overlap` on, shapes pass through each other: the moved object just
// sits on the table where it's put, and nothing else moves.
export function moveTo(boxes, id, x, z, { overlap = false } = {}) {
  const target = boxes.find((b) => b.id === id);
  if (!target) return boxes;
  if (overlap) {
    const next = { ...clampToTable({ ...target, x, z }), y: 0 };
    return boxes.map((b) => (b.id === id ? next : b));
  }
  const above = new Set(stackedOn(boxes, id));
  const others = boxes.filter((b) => b.id !== id && !above.has(b.id));
  let next = clampToTable({ ...target, x, z });
  let support = supportAt(others, next.x, next.z, id);
  next.y = support ? top(support) : 0;
  // Slide clear of anything at the same level: on the table, or beside
  // other things resting on the same object. If that pushes it off its
  // support, it drops to whatever is under it now.
  const besides = others.filter((b) => b !== support);
  next = resolveOverlaps(next, besides);
  if (support && !supportAt([support], next.x, next.z, id)) {
    support = supportAt(others, next.x, next.z, id);
    next.y = support ? top(support) : 0;
    next = resolveOverlaps(next, others.filter((b) => b !== support));
  }
  // Anything stacked on the moved object travels with it.
  const dx = next.x - target.x;
  const dz = next.z - target.z;
  const dy = next.y - target.y;
  return settle(
    boxes.map((b) => {
      if (b.id === id) return next;
      if (above.has(b.id)) return { ...b, x: b.x + dx, z: b.z + dz, y: b.y + dy };
      return b;
    })
  );
}

// Ids of everything resting on `id`, directly or further up the stack.
export function stackedOn(boxes, id) {
  const result = [];
  const queue = [boxes.find((b) => b.id === id)].filter(Boolean);
  while (queue.length) {
    const base = queue.shift();
    for (const b of boxes) {
      if (b.id === base.id || result.includes(b.id)) continue;
      const resting = Math.abs(b.y - top(base)) < 0.01;
      if (resting && containsPoint(base, b.x, b.z)) {
        result.push(b.id);
        queue.push(b);
      }
    }
  }
  return result;
}

// A free spot on the table for a new object, trying the centre first, then
// rings outward. Falls back to stacking at the centre if the table is full.
export function findFreeSpot(boxes, box) {
  const candidates = [[0, 0]];
  for (let r = 0.6; r <= TABLE.halfX; r += 0.6) {
    for (let a = 0; a < 12; a++) {
      const t = (a / 12) * Math.PI * 2;
      candidates.push([Math.cos(t) * r, Math.sin(t) * r * 0.7]);
    }
  }
  for (const [x, z] of candidates) {
    const trial = clampToTable({ ...box, x, z, y: 0 });
    const clear = boxes.every(
      (o) => bottom(o) > GAP || !overlaps({ ...trial, halfX: trial.halfX + GAP, halfZ: trial.halfZ + GAP }, o)
    );
    if (clear) return { x: trial.x, z: trial.z };
  }
  return { x: 0, z: 0 };
}
