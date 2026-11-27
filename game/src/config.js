// MERAPI AIRMAIL v5 — shared constants, airfields, routes and tuning.
// v2 reworks the 8 missions into delivery ROUTES: every flight takes off
// from an origin field, flies 6-8 numbered gates, and lands at a destination
// field. All numbers are original design values for this game.
// v3 adds GeoFS material: a navigation panel with autopilot (A), PAPI
// glide-slope lights on both runways, and elevator trim (Home/End).
// v4 is a UI + graphics-feel revision (rounded panels, eased dials, spring
// camera, sun, trails, nav lights). v5 fixes the takeoff that never worked
// — the plane spawned 30 m before the far runway end, rolling at the ridge
// with gate 1 ~170 degrees behind it; it now spawns at the threshold end
// with the full strip ahead — and adds the GeoFS free/orbit camera (C
// cycles chase/cockpit/orbit). The autopilot now joins the final through
// the final-approach fix, 800 m out on the extended centreline, when the
// plane is too high for a direct 3-degree glide path, so a full
// takeoff-to-landing run finally completes. v5 also lowers the circuit's
// first gate to a climb-out altitude: the old gate 1 sat at 222 m only
// 700 m past the threshold, and the plane climbs at most 9 m/s, so it
// arrived ~47 m below the gate on the first pass and then orbited it at
// 250-390 m — outside the 30 m pass radius — forever. The gate now sits
// at 172 m on the takeoff circuit (measured), the altitude the plane
// actually reaches there, so the first pass goes through at ~17 m.
export const WORLD = {
  size: 4200,            // island spans -2100..2100 in x and z
  seaLevel: 0,
  mountain: { x: 620, z: -540, height: 520, radius: 780 },
  town: { x: -420, z: 380 },
  runway: { x: -420, z: 760, heading: 0, length: 620, width: 46 },
  strip2: { x: 1150, z: -1150, heading: 0.6, length: 420, width: 34 },
  startAlt: 120,
};

/** Named airfields. Merapi Field is the home base; Parangtritis Strip is
 *  the coastal destination field on the far side of the island. */
export const AIRFIELDS = {
  merapi: { id: 'merapi', name: 'Merapi Field', short: 'MERAPI', rwy: '09',
    x: WORLD.runway.x, z: WORLD.runway.z, heading: WORLD.runway.heading, length: 620, width: 46 },
  parang: { id: 'parang', name: 'Parangtritis Strip', short: 'PARANGTRITIS', rwy: '04',
    x: WORLD.strip2.x, z: WORLD.strip2.z, heading: WORLD.strip2.heading, length: 420, width: 34 },
};

/** Named places drawn on the minimap so the island is navigable. */
export const PLACES = [
  { name: 'Merapi Field', x: -420, z: 760, kind: 'field' },
  { name: 'Parangtritis Strip', x: 1150, z: -1150, kind: 'field' },
  { name: 'Dieng Plateau', x: 620, z: -540, kind: 'peak' },
  { name: 'Kali Village', x: -900, z: -300, kind: 'village' },
  { name: 'Coral Bay', x: 900, z: 300, kind: 'village' },
  { name: 'South Farms', x: 200, z: 1200, kind: 'village' },
];

/** Prevailing wind comes from 250 degrees (WSW) — used by the approach panel. */
export const WIND_FROM_DEG = 250;

export const PLANE = {
  cruiseSpeed: 62,       // m/s at full throttle, level
  maxSpeed: 95,
  stallSpeed: 24,
  climbRate: 9,
  turnRate: 0.55,        // rad/s at full bank
  fuelBurn: 0.55,        // % per second at full throttle
  fuelCapacity: 100,
};

/** Autopilot tuning (v3, GeoFS-style A): gentle bank, altitude hold. */
export const AP = {
  cruiseSpeed: 62,       // m/s the autopilot holds en route
  bankLimit: 0.55,       // rad of roll the AP will command
  glideSlopeDeg: 3,      // degrees: the final-approach path the AP flies
};

/** PAPI glide-slope tuning (v3): a 3-degree slope to the threshold. */
export const PAPI = {
  slopeDeg: 3,           // ideal glide angle
  bandDeg: 0.35,         // half-width of the "on slope" band
  maxRangeM: 2000,       // PAPI reads only inside this distance
  maxAcrossM: 400,       // ...and roughly aligned with the runway
};

/** Elevator trim (v3, GeoFS Home/End): one press = 0.1 of trim. */
export const TRIM_STEP = 0.1;

export const MISSIONS = [
  { id: 'takeoff', num: 1, name: 'First Solo', kind: 'takeoff',
    route: { origin: 'merapi', dest: 'merapi', gates: 6 },
    brief: 'Route: Merapi Field circuit. Take off from Runway 09, fly the 6-gate circuit around the field, then land back on Runway 09. Rotate at 55 knots and keep the circuit tight.',
    gold: 150, silver: 210, bronze: 300, par: 'Merapi circuit — 6 gates, land on Runway 09.' },
  { id: 'rings', num: 2, name: 'Ring Course', kind: 'rings',
    route: { origin: 'merapi', dest: 'parang', gates: 7 },
    brief: 'Route: Merapi Field → Parangtritis Strip. Thread all 7 numbered gates across the island — over the bay, past the volcano shoulder — then land on Runway 04 at Parangtritis. Miss a gate and the clock keeps running.',
    gold: 95, silver: 125, bronze: 170, par: '7 gates, Merapi → Parangtritis, land on 04.' },
  { id: 'airmail', num: 3, name: 'Island Airmail', kind: 'drops',
    route: { origin: 'merapi', dest: 'parang', gates: 8 },
    brief: 'Route: Merapi Field → Parangtritis Strip. The mail run: 8 gates over Kali Village, Coral Bay and South Farms — each gate is a parcel drop, low and slow scores best — then land at Parangtritis and hand the bag over.',
    gold: 210, silver: 280, bronze: 380, par: '8 mail gates, land at Parangtritis.' },
  { id: 'rescue', num: 4, name: 'Mountain Rescue', kind: 'rescue',
    route: { origin: 'merapi', dest: 'merapi', gates: 6 },
    brief: 'Route: Merapi Field → Parangtritis Strip → Merapi Field. A hiker is stranded near Dieng Plateau. Fly the 6-gate route out, land at Parangtritis Strip, pick them up, and bring them home to Merapi Field before fuel runs low.',
    gold: 300, silver: 400, bronze: 540, par: 'Out to Parangtritis, pick up, fly home.' },
  { id: 'race', num: 5, name: 'Sunset Race', kind: 'race',
    route: { origin: 'merapi', dest: 'parang', gates: 8 },
    brief: 'Route: Merapi Field → Parangtritis Strip at golden hour. Eight gates around the island against the clock. Cut corners low over the water — but the sea does not forgive a stall — then land on Runway 04.',
    gold: 150, silver: 190, bronze: 250, par: '8 gates, fastest wins, land on 04.' },
  { id: 'storm', num: 6, name: 'Storm Crossing', kind: 'storm',
    route: { origin: 'merapi', dest: 'parang', gates: 6 },
    brief: 'Route: Merapi Field → Parangtritis Strip. A squall sits over the strait. Fly the 6-gate route through rain, gusts and lightning, then land at Parangtritis. Keep the wings level and trust the instruments.',
    gold: 260, silver: 340, bronze: 460, par: 'Cross the storm, land at Parangtritis.' },
  { id: 'night', num: 7, name: 'Night Landing', kind: 'night',
    route: { origin: 'parang', dest: 'merapi', gates: 6 },
    brief: 'Route: Parangtritis Strip → Merapi Field. After dark, the island is lit only by town lights and the runway. Fly the 6-gate route home, keep the glide slope, and grease the landing on Runway 09.',
    gold: 200, silver: 270, bronze: 360, par: '6 gates home, land on the lit runway.' },
  { id: 'aero', num: 8, name: 'Aerobatics', kind: 'aero',
    route: { origin: 'merapi', dest: 'merapi', gates: 6 },
    brief: 'Route: Merapi Field circuit over the bay. The airshow finale: one loop, one barrel roll and one Immelmann through the 6-gate display line, judged on smoothness — then land on Runway 09 for the crowd.',
    gold: 180, silver: 240, bronze: 320, par: 'Loop, roll, Immelmann, then land.' },
];

export const MEDALS = { gold: '#ffd34d', silver: '#cfd6dd', bronze: '#d08a4e' };

/** Deterministic seeded random (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp a value into [lo, hi]. */
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Wrap an angle to [-PI, PI]. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Format seconds as M:SS. */
export function formatTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}

/** Format a speed in m/s as knots. */
export function knots(ms) { return Math.round(ms * 1.94384); }

/** Format metres as feet. */
export function feet(m) { return Math.round(m * 3.28084); }

/**
 * Build the numbered gate course for a route: origin field -> destination
 * field. Gates are spaced along the straight line between the fields with a
 * deterministic sideways weave so the course feels flown, not drawn; a
 * same-field route becomes a circuit around the field. Returns
 * [{x, y, z}] with y in metres. Deterministic for a given mission id.
 */
export function routeGates(originId, destId, count, seed, altBase) {
  const o = AIRFIELDS[originId] || AIRFIELDS.merapi;
  const d = AIRFIELDS[destId] || AIRFIELDS.parang;
  const rng = mulberry32(seed);
  const gates = [];
  const base = altBase || 200;
  if (originId === destId) {
    // Circuit: gates on a ring around the field, starting ahead of the runway.
    const cx = o.x, cz = o.z;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.5;
      const r = 720 + (rng() - 0.5) * 160;
      gates.push({
        x: Math.round(cx + Math.cos(a) * r),
        // v5: the first gate is a climb-out gate at 165-175 m, not the
        // 200-230 m of the rest — the plane leaves the runway at 7 m and
        // climbs at most 9 m/s, so it reaches gate 1's position at ~175 m
        // and a 222 m gate there could never be passed on the first
        // attempt. The rng() call stays in the same place so gates 2..n
        // are byte-identical to v4.
        y: Math.round(i === 0 ? 165 + rng() * 10 : base + Math.sin(i * 1.3) * 35 + rng() * 30),
        z: Math.round(cz + Math.sin(a) * r),
      });
    }
    return gates;
  }
  const dx = d.x - o.x, dz = d.z - o.z;
  const len = Math.hypot(dx, dz) || 1;
  const px = -dz / len, pz = dx / len; // perpendicular unit vector
  for (let i = 0; i < count; i++) {
    const t = (i + 1) / (count + 1);
    const weave = Math.sin(t * Math.PI * 2 + seed * 0.7) * 260 + (rng() - 0.5) * 120;
    gates.push({
      x: Math.round(o.x + dx * t + px * weave),
      y: Math.round(base + Math.sin(t * Math.PI) * 70 + (rng() - 0.5) * 50),
      z: Math.round(o.z + dz * t + pz * weave),
    });
  }
  return gates;
}

/** Runway heading in degrees (0 = north on the compass strip). */
export function runwayHeadingDeg(field) {
  return Math.round(((field.heading * 180 / Math.PI) % 360 + 360) % 360);
}

/** Headwind (+) / crosswind components in knots for a runway, given the
 *  prevailing wind. Returns { head, cross, crossSide: 'L' | 'R' }. */
export function windComponents(runwayDeg, windSpeedMs) {
  const diff = (WIND_FROM_DEG - runwayDeg) * Math.PI / 180;
  const kt = windSpeedMs * 1.94384;
  return {
    head: Math.round(Math.cos(diff) * kt),
    cross: Math.round(Math.abs(Math.sin(diff) * kt)),
    crossSide: Math.sin(diff) >= 0 ? 'R' : 'L',
  };
}
