// MERAPI AIRMAIL v2 — procedural island world: terrain height, sea, town,
// runways, volcano, clouds and ring gates. Everything is generated in code.
// v2: the Parangtritis Strip gets a levelled shelf and edge lights like the
// home field, plus a small coastal settlement so the destination is a place.
// v2 FIX (found in play-testing): the runway shelves are levelled as
// CAPSULES around each strip and flattened to a TRUE 6 m (full blend, not
// 92%) — the old radial falloff left the runway ends buried under 40-50 m
// hills, so a plane spawning on the runway started underground and bounced
// itself to destruction before takeoff.
import * as THREE from 'three';
import { WORLD, mulberry32, clamp } from './config.js';

const rng = mulberry32(20261126);

/** Smooth value-noise field, deterministic. */
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const h = (a, b) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, z) {
  return noise2(x * 0.0016, z * 0.0016) * 0.62
    + noise2(x * 0.004 + 7, z * 0.004 + 3) * 0.26
    + noise2(x * 0.013 + 13, z * 0.013 + 9) * 0.12;
}

/** Distance (m) from (x, z) to a runway strip's centreline segment. */
function runwayDistance(x, z, def) {
  const dx = x - def.x, dz = z - def.z;
  const along = dx * Math.sin(def.heading) + dz * Math.cos(def.heading);
  const across = dx * Math.cos(def.heading) - dz * Math.sin(def.heading);
  const over = Math.max(0, Math.abs(along) - def.length / 2);
  return Math.hypot(over, across);
}

/** Terrain height in metres at (x, z). Shared by rendering and flight physics. */
export function terrainHeight(x, z) {
  const r = Math.sqrt(x * x + z * z) / (WORLD.size / 2);
  const falloff = clamp(1 - Math.pow(Math.max(0, r - 0.55) / 0.45, 2), 0, 1);
  const base = fbm(x, z) * 150 * falloff;
  const m = WORLD.mountain;
  const dm = Math.sqrt((x - m.x) * (x - m.x) + (z - m.z) * (z - m.z));
  const cone = Math.max(0, 1 - dm / m.radius);
  const volcano = Math.pow(cone, 1.6) * m.height;
  // Level a capsule around each runway so the strip + apron sit on flat
  // ground (6 m) and the terrain blends back to the island beyond it.
  const shelf = clamp(1 - runwayDistance(x, z, WORLD.runway) / 260, 0, 1);
  const shelf2 = clamp(1 - runwayDistance(x, z, WORLD.strip2) / 200, 0, 1);
  const flat = Math.max(shelf, shelf2);
  const h = base + volcano;
  return h * (1 - flat) + 6 * flat;
}

/** Colour for a terrain vertex, by height and slope. */
function terrainColor(x, z, h, out) {
  const slope = Math.abs(terrainHeight(x + 8, z) - h) + Math.abs(terrainHeight(x, z + 8) - h);
  if (h < 4) out.setRGB(0.85, 0.76, 0.55);            // beach sand
  else if (h < 60) out.setRGB(0.32, 0.55, 0.25);     // lowland green
  else if (h < 180) out.setRGB(0.16, 0.38, 0.16);    // forest
  else if (h < 340) out.setRGB(0.45, 0.38, 0.30);    // rock
  else out.setRGB(0.92, 0.90, 0.88);                 // summit snow
  if (slope > 14 && h > 60) out.setRGB(0.42, 0.36, 0.30);
  // Volcano crater: dark ash near the peak.
  const m = WORLD.mountain;
  const dm = Math.sqrt((x - m.x) * (x - m.x) + (z - m.z) * (z - m.z));
  if (dm < 130) out.setRGB(0.22, 0.18, 0.16);
  return out;
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  group.name = 'MerapiIsland';

  // --- Terrain mesh (vertex-coloured, one style throughout) ---
  const SEG = 150;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = terrainHeight(x, z);
    pos.setY(i, h);
    terrainColor(x, z, h, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  terrain.name = 'Terrain';
  group.add(terrain);

  // --- Sea ---
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3),
    new THREE.MeshPhongMaterial({ color: 0x1a5f8a, shininess: 120, specular: 0x88bbdd, transparent: true, opacity: 0.94 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0.5;
  sea.name = 'Sea';
  group.add(sea);

  // --- Runways (dark strips with white centre line + threshold bars) ---
  const runwayMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f0 });
  function makeRunway(def, lit) {
    const g = new THREE.Group();
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(def.length, def.width), runwayMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = def.heading;
    strip.position.y = terrainHeight(def.x, def.z) + 0.4;
    g.add(strip);
    for (let d = -def.length / 2 + 40; d < def.length / 2 - 20; d += 60) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(26, 3), lineMat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = def.heading;
      const dx = Math.sin(def.heading) * d, dz = Math.cos(def.heading) * d;
      dash.position.set(def.x + dx, strip.position.y + 0.2, def.z + dz);
      g.add(dash);
    }
    if (lit) {
      // Edge lights: small emissive spheres along both edges.
      const lightGeo = new THREE.SphereGeometry(2.6, 6, 6);
      const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
      for (let d = -def.length / 2; d <= def.length / 2; d += 40) {
        for (const side of [-1, 1]) {
          const dx = Math.sin(def.heading) * d + Math.cos(def.heading) * side * def.width / 2;
          const dz = Math.cos(def.heading) * d - Math.sin(def.heading) * side * def.width / 2;
          const lamp = new THREE.Mesh(lightGeo, lightMat);
          lamp.position.set(def.x + dx, strip.position.y + 1.5, def.z + dz);
          g.add(lamp);
        }
      }
    }
    g.name = 'Runway';
    return g;
  }
  group.add(makeRunway(WORLD.runway, true));
  group.add(makeRunway(WORLD.strip2, true)); // Parangtritis is lit now — a real destination

  // --- Town: instanced houses with lit windows at dusk/night ---
  const houseGeo = new THREE.BoxGeometry(14, 9, 12);
  const houseMat = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x8a4a3a });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const town = new THREE.Group();
  town.name = 'Town';
  function addHouse(tx, tz, scale) {
    const h = terrainHeight(tx, tz);
    if (h < 3) return;
    const house = new THREE.Mesh(houseGeo, houseMat);
    house.position.set(tx, h + 4.5, tz);
    house.rotation.y = rng() * Math.PI;
    house.scale.setScalar(scale);
    town.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 5, 4), roofMat);
    roof.position.set(tx, h + 11 * house.scale.y, tz);
    roof.rotation.y = Math.PI / 4 + house.rotation.y;
    roof.scale.setScalar(house.scale.x);
    town.add(roof);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.4), winMat);
    win.position.set(tx, h + 5, tz + 6.2 * house.scale.z);
    town.add(win);
  }
  for (let i = 0; i < 90; i++) {
    addHouse(WORLD.town.x + (rng() - 0.5) * 520, WORLD.town.z + (rng() - 0.5) * 420, 0.7 + rng() * 0.9);
  }
  // Parangtritis coastal settlement: a dozen houses beside the strip.
  for (let i = 0; i < 14; i++) {
    addHouse(WORLD.strip2.x - 160 + (rng() - 0.5) * 260, WORLD.strip2.z + 120 + (rng() - 0.5) * 220, 0.7 + rng() * 0.7);
  }
  group.add(town);

  // --- Beacon tower at Parangtritis so the destination is findable at night ---
  const beacon = new THREE.Group();
  beacon.name = 'ParangtritisBeacon';
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 42, 8), new THREE.MeshLambertMaterial({ color: 0x8a4a3a }));
  mast.position.set(WORLD.strip2.x + 60, terrainHeight(WORLD.strip2.x + 60, WORLD.strip2.z - 80) + 21, WORLD.strip2.z - 80);
  beacon.add(mast);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5a4e }));
  lamp.position.set(mast.position.x, mast.position.y + 22, mast.position.z);
  beacon.add(lamp);
  group.add(beacon);

  // --- Forest: instanced cones ---
  const treeGeo = new THREE.ConeGeometry(7, 22, 6);
  const treeMat = new THREE.MeshLambertMaterial({ color: 0x1d4d1f });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, 420);
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < 900 && placed < 420; i++) {
    const tx = (rng() - 0.5) * WORLD.size * 0.9;
    const tz = (rng() - 0.5) * WORLD.size * 0.9;
    const h = terrainHeight(tx, tz);
    if (h < 55 || h > 200) continue;
    dummy.position.set(tx, h + 10, tz);
    dummy.scale.setScalar(0.7 + rng() * 1.1);
    dummy.rotation.y = rng() * Math.PI;
    dummy.updateMatrix();
    trees.setMatrixAt(placed++, dummy.matrix);
  }
  trees.count = placed;
  trees.name = 'Forest';
  group.add(trees);

  // --- Volcano smoke column ---
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x666660, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 7; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(26 + i * 9, 8, 8), smokeMat);
    puff.position.set(WORLD.mountain.x + (rng() - 0.5) * 40, WORLD.mountain.height + 30 + i * 34, WORLD.mountain.z + (rng() - 0.5) * 40);
    puff.scale.y = 0.6;
    puff.name = 'VolcanoSmoke';
    group.add(puff);
  }

  // --- Clouds: flattened white blobs drifting slowly ---
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
  const clouds = new THREE.Group();
  clouds.name = 'Clouds';
  for (let i = 0; i < 26; i++) {
    const cl = new THREE.Group();
    const n = 3 + Math.floor(rng() * 3);
    for (let j = 0; j < n; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(18 + rng() * 22, 8, 8), cloudMat);
      puff.position.set((rng() - 0.5) * 90, (rng() - 0.5) * 8, (rng() - 0.5) * 30);
      puff.scale.y = 0.45;
      cl.add(puff);
    }
    cl.position.set((rng() - 0.5) * 3800, 420 + rng() * 260, (rng() - 0.5) * 3800);
    clouds.add(cl);
  }
  group.add(clouds);

  scene.add(group);
  return { group, clouds };
}

/** Ring gate positions for the ring course / race (fixed, deterministic).
 *  v2 keeps this as the default course; missions replace it with their own
 *  route gates via updateRings in render.js. */
export function ringPositions() {
  return [
    [-420, 170, 420], [-150, 190, 60], [180, 210, -160], [520, 260, -420],
    [760, 300, -700], [420, 240, -1020], [-80, 200, -900], [-420, 180, -520],
  ];
}

/** Build glowing ring gates; returns array of meshes. */
export function buildRings(scene, positions, radius = 26) {
  const rings = [];
  const geo = new THREE.TorusGeometry(radius, 2.2, 10, 40);
  positions.forEach((p, i) => {
    const mat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0x39ff88 : 0xffc233 });
    const ring = new THREE.Mesh(geo, mat);
    ring.position.set(p[0], p[1], p[2]);
    // Face the ring toward the incoming pilot: look back along the course.
    const prev = positions[Math.max(0, i - 1)];
    ring.rotation.y = Math.atan2(p[0] - prev[0], p[2] - prev[2]);
    ring.name = 'RingGate' + (i + 1);
    scene.add(ring);
    rings.push(ring);
  });
  return rings;
}

/** Airmail drop fields (x, z) with a marker. */
export function dropFields() {
  return [
    { x: -900, z: -300, name: 'Kali Village' },
    { x: 900, z: 300, name: 'Coral Bay' },
    { x: 200, z: 1200, name: 'South Farms' },
  ];
}
