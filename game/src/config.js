// MERAPI AIRMAIL — shared constants, mission roster and tuning.
// All numbers are original design values for this game.
export const WORLD = {
  size: 4200,            // island spans -2100..2100 in x and z
  seaLevel: 0,
  mountain: { x: 620, z: -540, height: 520, radius: 780 },
  town: { x: -420, z: 380 },
  runway: { x: -420, z: 760, heading: 0, length: 620, width: 46 },
  strip2: { x: 1150, z: -1150, heading: 0.6, length: 420, width: 34 },
  startAlt: 120,
};

export const PLANE = {
  cruiseSpeed: 62,       // m/s at full throttle, level
  maxSpeed: 95,
  stallSpeed: 24,
  climbRate: 9,
  turnRate: 0.55,        // rad/s at full bank
  fuelBurn: 0.55,        // % per second at full throttle
  fuelCapacity: 100,
};

export const MISSIONS = [
  { id: 'takeoff', num: 1, name: 'First Solo', kind: 'takeoff',
    brief: 'Line up on Runway 09 at Merapi Field, throttle up, rotate at 55 knots and climb to 300 m. Land back on the same runway to finish.',
    gold: 150, silver: 210, bronze: 300, par: 'Take off, climb, land safely.' },
  { id: 'rings', num: 2, name: 'Ring Course', kind: 'rings',
    brief: 'Thread all 8 glowing rings over the bay and the ridge. Miss a ring and the clock keeps running — smooth turns beat raw speed.',
    gold: 95, silver: 125, bronze: 170, par: 'Fly through 8 rings in order.' },
  { id: 'airmail', num: 3, name: 'Island Airmail', kind: 'drops',
    brief: 'Three villages are waiting for mail. Drop a parcel over each marked field — low and slow scores best, and mind the volcano on the way home.',
    gold: 210, silver: 280, bronze: 380, par: 'Deliver 3 parcels, return to Merapi Field.' },
  { id: 'rescue', num: 4, name: 'Mountain Rescue', kind: 'rescue',
    brief: 'A hiker is stranded on the volcano shoulder. Land on the mountain strip, pick them up, and bring them back to Merapi Field before fuel runs low.',
    gold: 300, silver: 400, bronze: 540, par: 'Land on the strip, pick up, return.' },
  { id: 'race', num: 5, name: 'Sunset Race', kind: 'race',
    brief: 'Ten gates around the island against the clock at golden hour. Cut corners low over the water — but the sea does not forgive a stall.',
    gold: 150, silver: 190, bronze: 250, par: 'Pass 10 gates in order, fastest wins.' },
  { id: 'storm', num: 6, name: 'Storm Crossing', kind: 'storm',
    brief: 'A squall sits over the strait. Cross through rain, gusts and lightning to the far strip and land. Keep the wings level and trust the instruments.',
    gold: 260, silver: 340, bronze: 460, par: 'Cross the storm, land at the far strip.' },
  { id: 'night', num: 7, name: 'Night Landing', kind: 'night',
    brief: 'After dark, the island is lit only by town lights and the runway. Fly the lit approach, keep the glide slope, and grease the landing.',
    gold: 200, silver: 270, bronze: 360, par: 'Land on the lit runway at night.' },
  { id: 'aero', num: 8, name: 'Aerobatics', kind: 'aero',
    brief: 'The airshow finale: one loop, one barrel roll and one Immelmann over the bay, judged on smoothness. Show the crowd what Merapi Airmail can do.',
    gold: 180, silver: 240, bronze: 320, par: 'Loop, roll, Immelmann — smooth and level.' },
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
  if (!isFinite(s) || s === null) return '--:--';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ':' + String(r).padStart(2, '0');
}

/** Format a speed in m/s as knots. */
export function knots(ms) { return Math.round(ms * 1.94384); }

/** Format metres as feet. */
export function feet(m) { return Math.round(m * 3.28084); }
