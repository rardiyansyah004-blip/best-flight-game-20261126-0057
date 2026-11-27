// MERAPI AIRMAIL v5 — procedural island world: terrain height, sea, town,
// runways, volcano, clouds and ring gates. Everything is generated in code.
// v2: the Parangtritis Strip gets a levelled shelf and edge lights like the
// home field, plus a small coastal settlement so the destination is a place.
// v2 FIX (found in play-testing): the runway shelves are levelled as
// CAPSULES around each strip and flattened to a TRUE 6 m (full blend, not
// 92%) — the old radial falloff left the runway ends buried under 40-50 m
// hills, so a plane spawning on the runway started underground and bounced
// itself to destruction before takeoff.
// v3 adds PAPI glide-slope lights (GeoFS-style landing aids): a 4-light
// array beside each threshold, red/white by glide angle vs the 3-degree
// slope, updated live every frame from the plane's position. The approach
// corridors are carved into the terrain so the 3-degree glide path clears
// the hills — a plane on the slope clipped a 29 m hill 390 m out on the
// Parangtritis final (v3 play test 4), where the slope is only 26 m.
// v4 (graphics feel): the v3 island read as flat colour bands — one green
// for all lowland, one dark green for all forest, one brown for all rock,
// identical cone trees, identical cream houses, a sea of one flat blue and
// clouds that were the same white blob copied 26 times. v4 keeps the exact
// same heights (the flight physics reads terrainHeight) and the same
// palette from a distance, but varies it up close: deterministic colour
// noise + farmland patchwork in the terrain, per-tree and per-house colour
// variants, a streaked sea texture that scrolls for shimmer, clouds in
// three opacities, and the volcano smoke returned live so it can rise.
// v4 perf note: the sea texture scroll + smoke rise cost nothing measurable
// — the frame rate in software rendering matches v3 once the HUD backdrop
// blur is gone.
// v5.17 (realistic graphics, clean-room from the techniques of
// PhilCrowther/Aviation and PierreEVEN/ThreeFlightSimulator — never their
// code): the flat Phong sea becomes a specular PBR ocean — two seamless
// 512x512 wave normal maps scrolled in opposite diagonals, a baked
// terrain-height texture so shallow water turns turquoise and animated
// surf foam rings the shoreline; the Lambert terrain becomes a PBR
// material with procedural rock normal/roughness maps and a
// slope-and-altitude shader — steep faces read as dark basalt, gentle
// lowland as tropical canopy, the upper cone as sulfur ash with a warm
// ember glow in the caldera vent; the 26 Lambert cloud blobs become a
// 40-cluster deck of soft camera-facing puffs (white top-lit, blue-grey
// underside) drifting at 850-1250 m around the volcano, above the gate
// corridor. Heights, colours-at-a-distance and the flight physics are
// untouched — only the surface reading changes.
// v5.17 polish (from the first cover screenshot): the rock normal map
// read as a regular grid on the flat lowland — grass should be smooth,
// only cliffs are craggy — so the shader now flattens the perturbed
// normal back toward the geometric normal on gentle low ground; the
// canopy mix is lowered so the v4 farmland patchwork shows through
// again, and the rock relief is softened and tiled finer.
// v5.17 Tier 3 (runway detail): the flat dark runway strips become
// weathered asphalt — a procedural 1024x512 canvas texture per strip
// (noise + patches, edge lines, dashed centreline, threshold piano
// keys, touchdown-zone bars, rubber tyre marks, painted runway
// numbers), on a PBR standard material that receives the aircraft's
// shadow; the PAPI lamps stand on short stanchions instead of
// floating, and a row of approach lights leads into each threshold.
// The separate centreline dash meshes are gone — the texture carries
// them now, so the strip is one mesh instead of a dozen. Heights,
// headings and the flight physics are untouched.
// v5.17 Tier 3 fix (found while verifying the runway): the strip mesh
// was never actually on the runway — the old code set only its y, so
// it sat at the world origin (buried under the island centre), and
// its rotation.z = heading put its length perpendicular to the strip.
// The strip now sits at (def.x, def.z) with rotation.z = heading -
// PI/2, which the three.js Euler order maps to the runway direction
// (verified numerically against the vendored three.js). The tyre-mark
// gradient also runs the right way at both ends now: darkest at each
// threshold, fading toward the centre.
import * as THREE from 'three';
import { WORLD, PAPI, REALISM, mulberry32, clamp } from './config.js';

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

/** Radial-gradient glow texture (canvas), shared by the ring-gate glows. */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const glowTex = makeGlowTexture();

/** Turn a seamless heightfield into a tangent-space normal map (canvas).
 *  The heightfield is sampled with wraparound, so the texture tiles with
 *  no visible seam — important for the ocean, which repeats 24x24. */
function normalMapFromHeight(H, size, strength) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * strength;
      const dz = (at(i, j + 1) - at(i, j - 1)) * strength;
      const inv = 1 / Math.hypot(dx, 1, dz);
      const o = (j * size + i) * 4;
      img.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** v5.17: seamless wave normal map. The heightfield is built from
 *  directional wave trains with INTEGER wave numbers per tile, so the
 *  pattern tiles perfectly, plus a chopped interference term from two
 *  more integer-frequency trains — the same trick the Aviation ocean
 *  uses with its scrolling normal maps, rebuilt here from first
 *  principles on an offscreen canvas. */
function makeWaveNormalMap(size, seed, strength) {
  const srng = mulberry32(seed);
  const trains = [];
  for (let w = 0; w < 3; w++) {
    trains.push({
      kx: 2 + Math.floor(srng() * 4), kz: 2 + Math.floor(srng() * 4),
      amp: 0.5 + srng() * 0.5, phase: srng() * Math.PI * 2,
    });
  }
  const chop = {
    kx1: 5 + Math.floor(srng() * 6), kz1: 5 + Math.floor(srng() * 6),
    kx2: 9 + Math.floor(srng() * 8), kz2: 9 + Math.floor(srng() * 8),
    amp: 0.55, phase1: srng() * Math.PI * 2, phase2: srng() * Math.PI * 2,
  };
  const H = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let h = 0;
      for (const t of trains) {
        h += t.amp * Math.sin(TAU * (t.kx * i + t.kz * j) / size + t.phase);
      }
      h += chop.amp
        * Math.sin(TAU * (chop.kx1 * i + chop.kz1 * j) / size + chop.phase1)
        * Math.sin(TAU * (chop.kx2 * i + chop.kz2 * j) / size + chop.phase2);
      H[j * size + i] = h;
    }
  }
  return normalMapFromHeight(H, size, strength);
}

/** v5.17: fractured-rock micro-relief normal map for the terrain. Four
 *  octaves of integer-frequency sine interference give a craggy surface
 *  that tiles seamlessly at 64 repeats across the island. */
function makeRockNormalMap(size, seed, strength) {
  const srng = mulberry32(seed);
  const H = new Float32Array(size * size);
  const TAU = Math.PI * 2;
  let amp = 1;
  for (let oct = 0; oct < 4; oct++) {
    const k1 = 3 + Math.floor(srng() * 5) + oct * 4;
    const k2 = 3 + Math.floor(srng() * 5) + oct * 4;
    const p1 = srng() * TAU, p2 = srng() * TAU;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        H[j * size + i] += amp
          * Math.sin(TAU * (k1 * i + k2 * j) / size + p1)
          * Math.sin(TAU * (k2 * i - k1 * j) / size + p2);
      }
    }
    amp *= 0.5;
  }
  return normalMapFromHeight(H, size, strength);
}

/** v5.17: grayscale roughness variation for the terrain (mid-grey base
 *  with noise, so the PBR response is not one flat roughness). Seams do
 *  not matter for a roughness map, so plain fbm is fine here. */
function makeRockRoughMap(size, seed) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const v = Math.round((0.78 + fbm(i * 0.35 + seed, j * 0.35 + seed * 2) * 0.35) * 255);
      const o = (j * size + i) * 4;
      img.data[o] = v; img.data[o + 1] = v; img.data[o + 2] = v; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** v5.17: the island heightfield baked into a 256x256 float texture so
 *  the ocean shader can tell shallow water from deep water. Row 0 is
 *  z = -2100, column 0 is x = -2100 (no flip on a DataTexture), so the
 *  shader samples huv = worldXZ / 4200 + 0.5. */
function makeHeightTexture() {
  const S = 256;
  const data = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = (i / (S - 1) - 0.5) * WORLD.size;
      const z = (j / (S - 1) - 0.5) * WORLD.size;
      data[j * S + i] = terrainHeight(x, z);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.FloatType);
  tex.needsUpdate = true;
  return tex;
}

/** v5.17: soft cloud puff — a radial falloff with a white top-lit crown
 *  and a blue-grey underside, drawn once and shared by every sprite. */
function makeCloudPuffTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 126);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = 'source-atop';
  const v = ctx.createLinearGradient(0, 0, 0, 256);
  v.addColorStop(0, 'rgba(255,255,255,0)');
  v.addColorStop(0.55, 'rgba(255,255,255,0)');
  v.addColorStop(1, 'rgba(137,153,173,0.75)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, 256, 256);
  ctx.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Distance (m) from (x, z) to a runway strip's centreline segment. */
function runwayDistance(x, z, def) {
  const dx = x - def.x, dz = z - def.z;
  const along = dx * Math.sin(def.heading) + dz * Math.cos(def.heading);
  const across = dx * Math.cos(def.heading) - dz * Math.sin(def.heading);
  const over = Math.max(0, Math.abs(along) - def.length / 2);
  return Math.hypot(over, across);
}

/** How strongly (0..1) a point lies in a runway's approach corridor: the
 *  wedge before the threshold, along the runway heading, where the 3-degree
 *  glide path must clear the terrain. Fades out past 1000 m out and beyond
 *  200 m across, so the cleared valley blends into the hills. */
function approachBlend(x, z, def) {
  const fx = Math.sin(def.heading), fz = Math.cos(def.heading);
  const tx = def.x - fx * (def.length / 2);
  const tz = def.z - fz * (def.length / 2);
  const dx = x - tx, dz = z - tz;
  const along = -(dx * fx + dz * fz); // positive while approaching
  const across = dx * Math.cos(def.heading) - dz * Math.sin(def.heading);
  if (along < -50 || along > 1000) return 0;
  const alongFade = clamp((along + 50) / 100, 0, 1) * clamp((1000 - along) / 150, 0, 1);
  const acrossFade = clamp((200 - Math.abs(across)) / 80, 0, 1);
  return alongFade * acrossFade;
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
  const h = base + volcano;
  // Carve the approach corridors: inside a corridor the height is capped
  // at 12 m below the 3-degree glide slope, so a plane flying the slope
  // (or the PAPI) never meets a hill on final. The cap is blended by the
  // corridor factor, so the valley reads as a cleared approach path.
  let capped = h;
  for (const def of [WORLD.runway, WORLD.strip2]) {
    const b = approachBlend(x, z, def);
    if (b > 0) {
      const fx = Math.sin(def.heading), fz = Math.cos(def.heading);
      const tx = def.x - fx * (def.length / 2);
      const tz = def.z - fz * (def.length / 2);
      const along = Math.max(0, -((x - tx) * fx + (z - tz) * fz));
      const cap = Math.max(2, 6 + along * Math.tan((3 * Math.PI) / 180) - 12);
      capped = capped * (1 - b) + Math.min(capped, cap) * b;
    }
  }
  // Level a capsule around each runway so the strip + apron sit on flat
  // ground (6 m) and the terrain blends back to the island beyond it.
  const shelf = clamp(1 - runwayDistance(x, z, WORLD.runway) / 260, 0, 1);
  const shelf2 = clamp(1 - runwayDistance(x, z, WORLD.strip2) / 200, 0, 1);
  const flat = Math.max(shelf, shelf2);
  return capped * (1 - flat) + 6 * flat;
}

/** Colour for a terrain vertex, by height and slope.
 *  v4: the same bands from a distance, but each vertex gets deterministic
 *  variation — fine colour noise plus a large-scale farmland patchwork in
 *  the lowland, so the island stops reading as one flat green sheet. The
 *  band edges are blended with smooth noise instead of hard cutoffs. */
function terrainColor(x, z, h, out) {
  const slope = Math.abs(terrainHeight(x + 8, z) - h) + Math.abs(terrainHeight(x, z + 8) - h);
  const n = fbm(x * 6 + 31, z * 6 + 17);          // fine variation 0..1
  const patch = noise2(x * 0.0011 + 5, z * 0.0011 + 11); // farmland patchwork
  const jitter = 0.9 + n * 0.2;                    // ±10% brightness
  if (h < 4) out.setRGB(0.85, 0.76, 0.55);            // beach sand
  else if (h < 60) {
    // Lowland: meadow green, with warm farmland patches where patch is high.
    const t = clamp((patch - 0.45) * 3, 0, 1);
    const r = 0.32 * (1 - t) + 0.62 * t;
    const g = 0.55 * (1 - t) + 0.52 * t;
    const b = 0.25 * (1 - t) + 0.24 * t;
    out.setRGB(r, g, b);
  }
  else if (h < 180) out.setRGB(0.16, 0.38, 0.16);    // forest
  else if (h < 340) out.setRGB(0.45, 0.38, 0.30);    // rock
  else out.setRGB(0.92, 0.90, 0.88);                 // summit snow
  // Blend the band edges so the colour steps don't read as contour lines.
  if (h >= 55 && h < 70) {
    const t = (h - 55) / 15;
    out.setRGB(
      0.32 * (1 - t) + 0.16 * t,
      0.55 * (1 - t) + 0.38 * t,
      0.25 * (1 - t) + 0.16 * t);
  }
  out.r *= jitter; out.g *= jitter; out.b *= jitter;
  if (slope > 14 && h > 60) out.setRGB(0.42, 0.36, 0.30);
  // Volcano crater: dark ash near the peak.
  const m = WORLD.mountain;
  const dm = Math.sqrt((x - m.x) * (x - m.x) + (z - m.z) * (z - m.z));
  if (dm < 130) out.setRGB(0.22, 0.18, 0.16);
  return out;
}

/** PAPI state for a plane approaching a field: 4 dots (1 = white, 0 = red)
 *  by glide angle vs the 3-degree slope, plus a label for the HUD. */
export function papiState(flight, field) {
  const fx = Math.sin(field.heading), fz = Math.cos(field.heading);
  const tx = field.x - fx * (field.length / 2);
  const tz = field.z - fz * (field.length / 2);
  const ty = 6; // runway shelf height
  const dx = flight.x - tx, dz = flight.z - tz;
  // along = distance still to fly to the threshold, along the runway
  // heading: positive while approaching, negative once past it. (The
  // first version had this sign backwards, so the PAPI read neutral for
  // the whole approach and only lit up after the threshold — caught by
  // the night screenshot, whose dots never left [1,1,0,0].)
  const along = -(dx * fx + dz * fz);
  const across = dx * Math.cos(field.heading) - dz * Math.sin(field.heading);
  const neutral = { dots: [1, 1, 0, 0], label: '—', angleDeg: null };
  if (along <= 0 || along > PAPI.maxRangeM || Math.abs(across) > PAPI.maxAcrossM) return neutral;
  const angleDeg = (Math.atan2(flight.y - ty, along) * 180) / Math.PI;
  const dev = angleDeg - PAPI.slopeDeg;
  if (dev > 0.7) return { dots: [1, 1, 1, 1], label: 'HIGH', angleDeg };
  if (dev > PAPI.bandDeg) return { dots: [1, 1, 1, 0], label: 'HIGH', angleDeg };
  if (dev > -PAPI.bandDeg) return { dots: [1, 1, 0, 0], label: 'ON SLOPE', angleDeg };
  if (dev > -0.7) return { dots: [1, 0, 0, 0], label: 'LOW', angleDeg };
  return { dots: [0, 0, 0, 0], label: 'LOW', angleDeg };
}

/** Colour the 4 PAPI light meshes from a papiState (white = 1, red = 0). */
export function updatePapi(meshes, state) {
  if (!meshes) return;
  meshes.forEach((m, i) => {
    m.material.color.set(state.dots[i] ? 0xfff6d8 : 0xff2a1e);
  });
}

// ---------------------------------------------------------------------------
// v5.17 shader fragments (written here so buildWorld stays readable).
// The terrain uses a slope-and-altitude recolour of the vertex-coloured
// base — the same idea as ThreeFlightSimulator's landscape shader, which
// blends grass/rock/snow by height and slope — rebuilt as a small
// onBeforeCompile hook on the standard material, not a custom shader.
// ---------------------------------------------------------------------------

/** GLSL value noise (hash-based, 2 octaves in use below). */
const TERRA_NOISE_GLSL = `
float terraHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float terraNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = terraHash(i);
  float b = terraHash(i + vec2(1.0, 0.0));
  float c = terraHash(i + vec2(0.0, 1.0));
  float d = terraHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

/** Terrain recolour injected after color_fragment: steep faces go dark
 *  basalt, gentle lowland goes tropical canopy with macro variation, the
 *  upper cone goes sulfur ash, and the caldera vent stores an ember
 *  factor for the emissive pass. The position and cliff factor are also
 *  stored in globals for the normal-flattening pass below. (All
 *  smoothstep edges are written low-to-high — reversed edges are
 *  undefined in GLSL.) */
const TERRA_COLOR_GLSL = `
{
  vec3 tPos = vTerraPos;
  vec3 tNrm = normalize(vTerraNormal);
  float steep = 1.0 - tNrm.y;
  float mac = terraNoise(tPos.xz * 0.0016) * 0.65 + terraNoise(tPos.xz * 0.006 + 7.3) * 0.35;
  float cliff = smoothstep(0.055, 0.11, steep);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.149, 0.141, 0.129), cliff * 0.85);
  float canopy = (1.0 - cliff) * (1.0 - smoothstep(180.0, 340.0, tPos.y));
  vec3 canopyCol = mix(vec3(0.122, 0.212, 0.098), vec3(0.20, 0.302, 0.141), mac);
  diffuseColor.rgb = mix(diffuseColor.rgb, canopyCol, canopy * 0.35);
  float ash = smoothstep(400.0, 470.0, tPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.204, 0.188), ash * 0.8);
  float dm = distance(tPos.xz, vec2(620.0, -540.0));
  terraEmber = (1.0 - smoothstep(40.0, 110.0, dm)) * smoothstep(430.0, 480.0, tPos.y);
  terraPosW = tPos;
  terraCliff = cliff;
}
`;

/** Terrain normal flattening injected after normal_fragment_maps: the
 *  rock micro-relief is for cliffs, not for grass — on gentle low
 *  ground the perturbed normal is blended back toward the geometric
 *  normal, so the lowland reads smooth and the normal map stops
 *  drawing a grid across the meadows. */
const TERRA_NORMAL_GLSL = `
{
  float flatN = (1.0 - terraCliff) * (1.0 - smoothstep(180.0, 340.0, terraPosW.y));
  normal = normalize(mix(normal, nonPerturbedNormal, flatN * 0.85));
}
`;

/** Ocean normal blend injected in place of normal_fragment_maps: the
 *  material's own normal map plus a second one scrolled in the opposite
 *  diagonal by time, combined in tangent space before perturbation. */
const OCEAN_NORMAL_GLSL = `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale;
  vec2 uv2 = vOceanUv * 24.0 + vec2(uOceanTime * 0.021, -uOceanTime * 0.017);
  vec3 mapN2 = texture2D(uOceanNormal2, uv2).xyz * 2.0 - 1.0;
  mapN2.xy *= normalScale * 0.8;
  vec3 combinedN = vec3(mapN.xy + mapN2.xy, mapN.z);
  normal = normalize(tbn * combinedN);
#endif
`;

/** Ocean colour injected after map_fragment: sample the baked height
 *  texture for water depth — shallow water turns turquoise, and a band
 *  around the waterline gets animated white surf foam. */
const OCEAN_COLOR_GLSL = `
{
  vec2 huv = vOceanPos.xz / 4200.0 + 0.5;
  float hgt = texture2D(uOceanHeight, huv).r;
  float onIsland = step(abs(vOceanPos.x), 2100.0) * step(abs(vOceanPos.z), 2100.0);
  hgt = mix(-60.0, hgt, onIsland);
  float depth = 0.5 - hgt;
  float shallow = 1.0 - smoothstep(0.5, 4.0, depth);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.094, 0.416, 0.451), shallow * 0.75);
  float foamBand = smoothstep(-0.8, -0.15, depth) * (1.0 - smoothstep(0.0, 0.45, depth));
  float foamN = 0.5 + 0.5 * sin(vOceanPos.x * 0.35 + uOceanTime * 1.4) * sin(vOceanPos.z * 0.31 - uOceanTime * 1.1);
  oceanFoam = foamBand * (0.35 + 0.65 * foamN);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.98, 0.98), clamp(oceanFoam, 0.0, 1.0) * 0.85);
}
`;

/** v5.17 Tier 3: weathered asphalt runway texture, drawn once per strip.
 *  Canvas 1024 (U, along the runway) x 512 (V, across it); each strip
 *  gets its own texture so the markings land in real metres. The strip's
 *  U axis runs along (sin heading, cos heading), so canvas-left is the
 *  approach threshold for a landing on the strip's own heading, and the
 *  painted numbers read from the approaching aircraft (top of the digits
 *  toward +U). Contents: asphalt base with speckle + weathering patches,
 *  solid edge lines, dashed centreline, threshold piano keys at both
 *  ends, touchdown-zone bar pairs, dark rubber tyre marks where the
 *  wheels bite, and the runway numbers at each threshold. */
function makeRunwayTexture(def, numNear, numFar) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const trng = mulberry32(20261128 + def.length);
  const pxU = W / def.length;   // px per metre along the runway
  const pxV = H / def.width;    // px per metre across it
  const X = (m) => (m + def.length / 2) * pxU;   // metres-from-centre -> px (U)
  const Y = (m) => (m + def.width / 2) * pxV;    // metres-across -> px (V)
  // Asphalt base.
  ctx.fillStyle = '#2b2f36';
  ctx.fillRect(0, 0, W, H);
  // Weathering: large soft patches, lighter and darker.
  for (let i = 0; i < 26; i++) {
    const x = trng() * W, y = trng() * H, r = 30 + trng() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = trng() > 0.5;
    g.addColorStop(0, light ? 'rgba(120,128,138,0.10)' : 'rgba(10,12,16,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Speckle: fine aggregate noise.
  for (let i = 0; i < 9000; i++) {
    const v = trng();
    ctx.fillStyle = v > 0.66 ? 'rgba(200,205,210,0.10)' : v > 0.33 ? 'rgba(0,0,0,0.16)' : 'rgba(90,95,105,0.12)';
    ctx.fillRect(trng() * W, trng() * H, 1 + trng() * 2, 1 + trng() * 2);
  }
  // Rubber tyre marks: two dark bands where the wheels touch down, just
  // past each threshold, fading along the roll.
  for (const side of [-1, 1]) {
    for (const end of [0, 1]) {
      const x0 = end === 0 ? X(-def.length / 2 + 60) : X(def.length / 2 - 260);
      const x1 = end === 0 ? X(-def.length / 2 + 260) : X(def.length / 2 - 60);
      const y = Y(side * 2.2);
      // Darkest at the threshold, fading toward the centre — the far
      // end's gradient runs the other way, so its rubber also heaps
      // up at its own threshold.
      const g = end === 0
        ? ctx.createLinearGradient(x0, 0, x1, 0)
        : ctx.createLinearGradient(x1, 0, x0, 0);
      g.addColorStop(0, 'rgba(12,12,14,0.55)');
      g.addColorStop(0.7, 'rgba(12,12,14,0.35)');
      g.addColorStop(1, 'rgba(12,12,14,0)');
      ctx.fillStyle = g;
      ctx.fillRect(Math.min(x0, x1), y - 3 * pxV, Math.abs(x1 - x0), 6 * pxV);
    }
  }
  // Edge lines: solid white, 0.5 m wide, inset 1.5 m from each edge.
  ctx.fillStyle = 'rgba(245,245,240,0.92)';
  ctx.fillRect(0, Y(-def.width / 2 + 1.5), W, 0.5 * pxV);
  ctx.fillRect(0, Y(def.width / 2 - 2), W, 0.5 * pxV);
  // Centreline: dashed white, 26 m dashes with 34 m gaps (matches the
  // old separate dash meshes, now painted so the strip is one mesh).
  ctx.fillStyle = 'rgba(245,245,240,0.95)';
  for (let d = -def.length / 2 + 40; d < def.length / 2 - 20; d += 60) {
    ctx.fillRect(X(d), Y(-1.5), 26 * pxU, 3 * pxV);
  }
  // Threshold piano keys: 8 white bars across the width at each end.
  const keyW = 3 * pxU; // bar length along the runway
  const keyH = 1.8 * pxV;
  const gapV = (def.width - 2 * 2 - 8 * 1.8) / 7;
  for (const end of [0, 1]) {
    const x0 = end === 0 ? X(-def.length / 2 + 6) : X(def.length / 2 - 6 - 3);
    for (let k = 0; k < 8; k++) {
      const y0 = Y(-def.width / 2 + 2 + k * (1.8 + gapV));
      ctx.fillRect(x0, y0, keyW, keyH);
    }
  }
  // Touchdown-zone bars: pairs of white bars flanking the centreline at
  // 150 m and 300 m past each threshold.
  for (const end of [0, 1]) {
    for (const dist of [150, 300]) {
      const along = end === 0 ? -def.length / 2 + dist : def.length / 2 - dist;
      const x0 = X(along - 11);
      for (const side of [-1, 1]) {
        const y0 = Y(side * 6.5 - 1.5);
        ctx.fillRect(x0, y0, 22 * pxU, 3 * pxV);
      }
    }
  }
  // Runway numbers at each threshold, reading from the approaching
  // aircraft: the near number's top points toward +U (canvas right),
  // the far number's top points toward -U.
  ctx.fillStyle = 'rgba(245,245,240,0.95)';
  ctx.font = `bold ${Math.round(9 * pxV)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.translate(X(-def.length / 2 + 42), Y(0));
  ctx.rotate(Math.PI / 2);
  ctx.fillText(numNear, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(X(def.length / 2 - 42), Y(0));
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(numFar, 0, 0);
  ctx.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  group.name = 'MerapiIsland';

  // --- Terrain mesh (v5.17: PBR standard material, vertex colours kept,
  // procedural rock normal + roughness maps, slope/altitude recolour) ---
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
  const rockNormal = makeRockNormalMap(512, 20261127, 1.1);
  rockNormal.repeat.set(64, 64);
  rockNormal.anisotropy = 4;
  const rockRough = makeRockRoughMap(256, 20261127);
  rockRough.repeat.set(64, 64);
  const terrainMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0.0,
    normalMap: rockNormal, roughnessMap: rockRough,
  });
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTerraTime = { value: 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerraPos;\nvarying vec3 vTerraNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerraNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerraPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerraPos;\nvarying vec3 vTerraNormal;\nuniform float uTerraTime;\nfloat terraEmber = 0.0;\nvec3 terraPosW = vec3(0.0);\nfloat terraCliff = 0.0;\n' + TERRA_NOISE_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRA_COLOR_GLSL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TERRA_NORMAL_GLSL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.32, 0.08) * terraEmber * (0.55 + 0.25 * sin(uTerraTime * 1.7));');
    terrainMat.userData.shader = shader;
  };
  const terrain = new THREE.Mesh(geo, terrainMat);
  terrain.name = 'Terrain';
  group.add(terrain);

  // --- Sea (v5.17: specular PBR ocean, two scrolling wave normal maps,
  // shallow turquoise + surf foam from the baked height texture) ---
  const waveTex1 = makeWaveNormalMap(512, 101, 1.4);
  waveTex1.repeat.set(REALISM.ocean.normalRepeat, REALISM.ocean.normalRepeat);
  const waveTex2 = makeWaveNormalMap(512, 202, 1.4);
  const heightTex = makeHeightTexture();
  const seaMat = new THREE.MeshStandardMaterial({
    color: REALISM.ocean.deepColor,
    metalness: REALISM.ocean.metalness,
    roughness: REALISM.ocean.roughness,
    normalMap: waveTex1,
    normalScale: new THREE.Vector2(REALISM.ocean.normalScale, REALISM.ocean.normalScale),
  });
  seaMat.onBeforeCompile = (shader) => {
    shader.uniforms.uOceanTime = { value: 0 };
    shader.uniforms.uOceanNormal2 = { value: waveTex2 };
    shader.uniforms.uOceanHeight = { value: heightTex };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOceanPos;\nvarying vec2 vOceanUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOceanPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvOceanUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vOceanPos;\nvarying vec2 vOceanUv;\nuniform float uOceanTime;\nuniform sampler2D uOceanNormal2;\nuniform sampler2D uOceanHeight;\nfloat oceanFoam = 0.0;\n')
      .replace('#include <normal_fragment_maps>', OCEAN_NORMAL_GLSL)
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + OCEAN_COLOR_GLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.9, clamp(oceanFoam, 0.0, 1.0) * 0.85);');
    seaMat.userData.shader = shader;
  };
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD.size * 3, WORLD.size * 3), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = 0.5;
  sea.name = 'Sea';
  group.add(sea);

  // --- Runways (v5.17 Tier 3: weathered asphalt texture, PBR strip that
  // receives the aircraft's shadow, PAPI on stanchions, approach lights) ---
  const papi = {};
  function makeRunway(def, lit, fieldId) {
    const g = new THREE.Group();
    const nums = fieldId === 'merapi' ? ['09', '27'] : ['04', '22'];
    const stripMat = new THREE.MeshStandardMaterial({
      map: makeRunwayTexture(def, nums[0], nums[1]),
      roughness: 0.85, metalness: 0.05,
    });
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(def.length, def.width), stripMat);
    strip.rotation.x = -Math.PI / 2;
    // Length along the runway: local +X must map to (sin heading, cos
    // heading). With rotation.x = -90 deg, rotation.z = heading puts
    // local +X at (cos heading, -sin heading) — perpendicular to the
    // strip — so the strip sat sideways (and, at the world origin with
    // only its y set, buried under the island). heading - PI/2 is the
    // rotation that actually lines the strip up with the runway.
    strip.rotation.z = def.heading - Math.PI / 2;
    strip.position.set(def.x, terrainHeight(def.x, def.z) + 0.4, def.z);
    strip.receiveShadow = true;
    g.add(strip);
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
    // PAPI: 4 lights in a row across the runway, left of the approach end,
    // just past the threshold — the glide-slope aid a real sim shows.
    // Tier 3: each lamp stands on a short dark stanchion, so it reads as
    // installed hardware instead of a floating box.
    const papiMeshes = [];
    const papiGeo = new THREE.BoxGeometry(5, 2.5, 3);
    const postGeo = new THREE.BoxGeometry(0.9, 3.2, 0.9);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.8, metalness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 });
      const lamp = new THREE.Mesh(papiGeo, mat);
      const along = -def.length / 2 + 12;
      const across = -(def.width / 2 + 10 + i * 9);
      const dx = Math.sin(def.heading) * along + Math.cos(def.heading) * across;
      const dz = Math.cos(def.heading) * along - Math.sin(def.heading) * across;
      lamp.position.set(def.x + dx, strip.position.y + 1.6, def.z + dz);
      lamp.name = 'PAPI' + (i + 1);
      g.add(lamp);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(def.x + dx, strip.position.y - 0.2, def.z + dz);
      g.add(post);
      papiMeshes.push(lamp);
    }
    // Approach lights: a row of 5 emissive lamps on short posts, 60 m
    // before the threshold, spanning the width — the lead-in a pilot
    // follows onto the glide slope at night.
    const appGeo = new THREE.SphereGeometry(1.8, 6, 6);
    const appMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const appPostGeo = new THREE.CylinderGeometry(0.35, 0.35, 2.4, 6);
    for (let i = -2; i <= 2; i++) {
      const along = -def.length / 2 - 60;
      const across = i * 9;
      const dx = Math.sin(def.heading) * along + Math.cos(def.heading) * across;
      const dz = Math.cos(def.heading) * along - Math.sin(def.heading) * across;
      const post = new THREE.Mesh(appPostGeo, postMat);
      post.position.set(def.x + dx, strip.position.y + 1.0, def.z + dz);
      g.add(post);
      const lamp = new THREE.Mesh(appGeo, appMat);
      lamp.position.set(def.x + dx, strip.position.y + 2.4, def.z + dz);
      lamp.name = 'ApproachLight';
      g.add(lamp);
    }
    papi[fieldId] = papiMeshes;
    g.name = 'Runway';
    return g;
  }
  group.add(makeRunway(WORLD.runway, true, 'merapi'));
  group.add(makeRunway(WORLD.strip2, true, 'parang')); // Parangtritis is lit now — a real destination

  // --- Town: instanced houses with lit windows at dusk/night ---
  // v4: three wall/roof colour variants so the town stops being one cream
  // block with one brown roof repeated 90 times.
  const houseGeo = new THREE.BoxGeometry(14, 9, 12);
  const houseMats = [
    new THREE.MeshLambertMaterial({ color: 0xe8dcc8 }),
    new THREE.MeshLambertMaterial({ color: 0xdcc8a8 }),
    new THREE.MeshLambertMaterial({ color: 0xc8d4dc }),
  ];
  const roofMats = [
    new THREE.MeshLambertMaterial({ color: 0x8a4a3a }),
    new THREE.MeshLambertMaterial({ color: 0x6a4a5a }),
    new THREE.MeshLambertMaterial({ color: 0x4a5a6a }),
  ];
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const town = new THREE.Group();
  town.name = 'Town';
  function addHouse(tx, tz, scale) {
    const h = terrainHeight(tx, tz);
    if (h < 3) return;
    const variant = Math.floor(rng() * 3);
    const house = new THREE.Mesh(houseGeo, houseMats[variant]);
    house.position.set(tx, h + 4.5, tz);
    house.rotation.y = rng() * Math.PI;
    house.scale.setScalar(scale);
    town.add(house);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 5, 4), roofMats[variant]);
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

  // --- Forest: instanced cones, v4 with per-tree colour variation ---
  const treeGeo = new THREE.ConeGeometry(7, 22, 6);
  const treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trees = new THREE.InstancedMesh(treeGeo, treeMat, 420);
  const dummy = new THREE.Object3D();
  const treeCol = new THREE.Color();
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
    trees.setMatrixAt(placed, dummy.matrix);
    // Vary the green per tree: deep pine to yellow-green.
    const t = rng();
    treeCol.setRGB(0.10 + t * 0.10, 0.24 + t * 0.14, 0.10 + t * 0.05);
    trees.setColorAt(placed, treeCol);
    placed += 1;
  }
  trees.count = placed;
  if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
  trees.name = 'Forest';
  group.add(trees);

  // --- Volcano smoke column (returned live so the renderer can raise it) ---
  const smoke = [];
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0x666660, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 7; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(26 + i * 9, 8, 8), smokeMat);
    puff.position.set(WORLD.mountain.x + (rng() - 0.5) * 40, WORLD.mountain.height + 30 + i * 34, WORLD.mountain.z + (rng() - 0.5) * 40);
    puff.scale.y = 0.6;
    puff.name = 'VolcanoSmoke';
    group.add(puff);
    smoke.push(puff);
  }

  // --- Clouds (v5.17): layered deck of soft camera-facing puffs, white
  // top-lit with a blue-grey underside, 40 clusters drifting at 850-1250 m
  // around the volcano flanks — above the gate corridor, so they frame the
  // island instead of blocking the course. ---
  const puffTex = makeCloudPuffTexture();
  // Sprite fog is OFF: the deck sits kilometres out, and FogExp2 would
  // wash the soft puffs into the sky colour until they vanish — the
  // puffs carry their own blue-grey underside for depth instead.
  const cloudMats = [
    new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0.55, depthWrite: false, fog: false }),
    new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0.7, depthWrite: false, fog: false }),
    new THREE.SpriteMaterial({ map: puffTex, transparent: true, opacity: 0.85, depthWrite: false, fog: false }),
  ];
  const clouds = new THREE.Group();
  clouds.name = 'Clouds';
  const crng = mulberry32(20261127);
  for (let i = 0; i < REALISM.clouds.count; i++) {
    const cl = new THREE.Group();
    const mat = cloudMats[i % 3];
    const n = 2 + Math.floor(crng() * 2); // 2-3 puffs per cluster
    for (let j = 0; j < n; j++) {
      const spr = new THREE.Sprite(mat);
      const w = 110 + crng() * 150;
      spr.scale.set(w, w * (0.32 + crng() * 0.18), 1);
      spr.position.set((crng() - 0.5) * 220, (crng() - 0.5) * 26, (crng() - 0.5) * 90);
      cl.add(spr);
    }
    let px, pz;
    if (i < 30) {
      // Ring around the volcano flanks.
      const a = crng() * Math.PI * 2;
      const r = REALISM.clouds.minR + crng() * (REALISM.clouds.maxR - REALISM.clouds.minR);
      px = WORLD.mountain.x + Math.cos(a) * r;
      pz = WORLD.mountain.z + Math.sin(a) * r;
    } else {
      px = (crng() - 0.5) * 3800;
      pz = (crng() - 0.5) * 3800;
    }
    cl.position.set(px, REALISM.clouds.minY + crng() * (REALISM.clouds.maxY - REALISM.clouds.minY), pz);
    clouds.add(cl);
  }
  group.add(clouds);

  scene.add(group);
  return { group, clouds, papi, sea, smoke, trees };
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

/** Build glowing ring gates; returns array of meshes.
 *  v4: each ring carries a soft glow sprite as its first child — the
 *  renderer shows it only on the NEXT gate, so the target reads through
 *  the haze without adding any new geometry to the course. */
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
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc233, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(90, 90, 1);
    glow.visible = false;
    ring.add(glow);
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
