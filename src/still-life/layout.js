// Pure layout logic for the still-life table: keeping objects on the table,
// stopping them overlapping, and stacking one on another.
// Each "box" is an object's footprint and height as seen from above:
// { id, x, z, halfX, halfZ, height, y }.

export const TABLE = { halfX: 4, halfZ: 2.5 };

const GAP = 0.02;

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
    if (!best || b.y + b.height > best.y + best.height) best = b;
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
      const sameLevel =
        moved.y < other.y + other.height - GAP &&
        other.y < moved.y + moved.height - GAP;
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
    placed.push({ ...box, y: support ? support.y + support.height : 0 });
  }
  const byId = new Map(placed.map((b) => [b.id, b]));
  return boxes.map((b) => byId.get(b.id));
}

// Move one object to (x, z): it stacks on whatever is under that point,
// otherwise it slides clear of its neighbours. Returns all boxes, settled.
export function moveTo(boxes, id, x, z) {
  const target = boxes.find((b) => b.id === id);
  if (!target) return boxes;
  const above = new Set(stackedOn(boxes, id));
  const others = boxes.filter((b) => b.id !== id && !above.has(b.id));
  let next = clampToTable({ ...target, x, z });
  const support = supportAt(others, next.x, next.z, id);
  next.y = support ? support.y + support.height : 0;
  if (!support) next = resolveOverlaps(next, others);
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
      const resting = Math.abs(b.y - (base.y + base.height)) < 0.01;
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
      (o) => o.y > GAP || !overlaps({ ...trial, halfX: trial.halfX + GAP, halfZ: trial.halfZ + GAP }, o)
    );
    if (clear) return { x: trial.x, z: trial.z };
  }
  return { x: 0, z: 0 };
}
