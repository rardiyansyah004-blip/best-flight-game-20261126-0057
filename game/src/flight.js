// MERAPI AIRMAIL v5 — arcade flight model: pitch/roll/yaw, throttle, flaps,
// gear, stall and spin, wind gusts, terrain and sea collision, landing check.
// v2 records every touchdown (vertical speed, centreline error, approach
// speed) so the debrief can score the landing, and only counts a touchdown
// as HARD after a real airborne descent (airTime) — rolling off a bump at
// taxi speed no longer destroys the plane.
// v3 adds elevator trim (GeoFS Home/End): trim offsets the pitch target so
// the plane holds attitude hands-off; Delete resets it. The wind push only
// applies in the air — a parked plane must not slide across the ground
// (and drift sideways during the takeoff roll).
// v5 fixes the takeoff that never worked. Two separate defects, both in
// this file: the plane spawned 30 m before the FAR end of the runway,
// rolling toward a steeply rising ridge with gate 1 ~170 degrees behind
// it, so no full takeoff-to-landing run ever completed in the v3/v4 play
// tests; and below flying speed the ground state flickered, because a dip
// in bumpy terrain read as a takeoff and flagged a stall at taxi speed.
// The spawn now sits at the threshold end (the convention the non-Merapi
// spawn in main.js already uses), with the full 590 m of runway ahead,
// and the plane is pinned to the ground below flying speed unless it is
// actually climbing — a real rotation still leaves the ground.
import { PLANE, WORLD, AIRFIELDS, TRIM_STEP, clamp, wrapAngle } from './config.js';
import { terrainHeight } from './world.js';

export function createFlightState() {
  return {
    // Spawn at the threshold end of the home runway (z = 480), heading +Z
    // down the strip — the full 590 m of runway ahead, the same convention
    // the Parangtritis spawn in main.js already uses (origin minus half the
    // strip length, plus 30 m). The old spawn sat 30 m before the far end
    // (z = 1040): the roll ran out of runway and onto the ridge rising
    // north of the field before the plane could reach rotation speed,
    // while gate 1 sat ~170 degrees behind the takeoff heading. From the
    // new spawn gate 1 is 46 degrees off on the circuit and ~110 degrees
    // off on the ring course, and the ridge is cleared on the climb-out.
    x: WORLD.runway.x, y: 8, z: WORLD.runway.z - WORLD.runway.length / 2 + 30,
    heading: 0, pitch: 0, roll: 0,
    speed: 0, throttle: 0, flaps: 0, gearDown: true,
    fuel: 100, damage: 0, trim: 0,
    onGround: true, crashed: false, landed: false,
    verticalSpeed: 0, stalled: false, spinning: false,
    wind: 0, gust: 0, time: 0, airTime: 0,
    lastLanding: null, // { vs, speed, centreline, field, onRunway } — set on touchdown
  };
}

/** Across-track distance (m) from a runway centreline, signed. */
export function runwayAcross(s, def) {
  const dx = s.x - def.x, dz = s.z - def.z;
  return dx * Math.cos(def.heading) - dz * Math.sin(def.heading);
}

/** Which named field (if any) the plane is over, by runway proximity. */
export function fieldUnder(s) {
  let best = null, bestD = 1e9;
  for (const f of Object.values(AIRFIELDS)) {
    const d = Math.hypot(s.x - f.x, s.z - f.z);
    if (d < bestD) { bestD = d; best = f; }
  }
  return bestD < 900 ? best : null;
}

/**
 * Advance the flight model one step (dt seconds).
 * input: { pitch: -1..1 (stick back = climb), roll: -1..1, yaw: -1..1,
 *          throttleDelta, flapsToggle, gearToggle, brake,
 *          trimDelta: -1 | 0 | 1 (Home/End presses), trimReset }
 * Returns events: { tookOff, touchedDown, crashed, stalled }.
 */
export function stepFlight(s, input, dt, weather) {
  const events = { tookOff: false, touchedDown: false, crashed: false, stalled: false };
  s.time += dt;
  const wasGround = s.onGround;

  // --- Controls ---
  s.throttle = clamp(s.throttle + (input.throttleDelta || 0) * dt * 0.6, 0, 1);
  if (input.flapsToggle) s.flaps = s.flaps > 0.5 ? 0 : 1;
  if (input.gearToggle) s.gearDown = !s.gearDown;
  // Elevator trim: Home trims nose-up, End nose-down, Delete resets.
  if (input.trimReset) s.trim = 0;
  else if (input.trimDelta) s.trim = clamp(s.trim + input.trimDelta * TRIM_STEP, -1, 1);

  // Wind gusts (weather.gustStrength 0..1, deterministic-ish via time).
  const gustPhase = Math.sin(s.time * 0.9) * 0.5 + Math.sin(s.time * 2.3) * 0.5;
  s.gust = gustPhase * (weather ? weather.gustStrength : 0.1) * 6;
  s.wind = (weather ? weather.windSpeed : 2) + s.gust;

  // --- Aerodynamics ---
  const targetSpeed = s.throttle * PLANE.maxSpeed;
  const accel = (targetSpeed - s.speed) * 0.25;
  s.speed = Math.max(0, s.speed + accel * dt);
  if (s.speed < 0.5 && s.onGround && s.throttle < 0.05) s.speed = 0;

  // Roll follows stick; bank turns the heading. Positive roll banks the
  // plane right (the mesh rotates the same way) and must turn it right:
  // heading grows toward east. (The first version had a minus here, so the
  // plane banked right while turning LEFT — the autopilot could never
  // converge on a gate and circled instead. Caught by the v3 play test:
  // 60 s of AP, zero gates passed, and the autoland never closed in.)
  const targetRoll = clamp((input.roll || 0) * 1.1, -1.1, 1.1);
  s.roll += (targetRoll - s.roll) * Math.min(1, dt * 3.5);
  const turn = Math.sin(s.roll) * PLANE.turnRate * clamp(s.speed / PLANE.cruiseSpeed, 0.25, 1);
  s.heading = wrapAngle(s.heading + turn * dt + (input.yaw || 0) * 0.15 * dt);

  // Pitch follows stick + trim, limited by speed; stall below stall speed.
  const stallSpeed = PLANE.stallSpeed * (1 - s.flaps * 0.25);
  s.stalled = !s.onGround && s.speed < stallSpeed;
  if (s.stalled) events.stalled = true;
  const pitchTarget = clamp((input.pitch || 0) * 0.45 + s.trim * 0.3, -0.45, 0.45);
  const pitchAuthority = clamp(s.speed / PLANE.cruiseSpeed, 0.2, 1);
  s.pitch += (pitchTarget * pitchAuthority - s.pitch) * Math.min(1, dt * 2.5);
  if (s.stalled) {
    s.pitch -= 0.35 * dt;               // nose drops in a stall
    if (Math.abs(s.roll) > 0.7) s.spinning = true;
  } else if (s.speed > stallSpeed * 1.4) {
    s.spinning = false;
  }

  // Vertical speed: lift from speed + pitch, minus gravity sink.
  const lift = s.speed * Math.sin(s.pitch) * 1.0;
  const sink = s.onGround ? 0 : (s.stalled ? -14 : -2.2) * (1 - clamp(s.speed / PLANE.cruiseSpeed, 0, 1));
  s.verticalSpeed = lift + sink + (s.flaps ? -1.2 : 0);
  s.y += s.verticalSpeed * dt;

  // Horizontal motion (heading 0 = +Z, runway direction).
  const fx = Math.sin(s.heading), fz = Math.cos(s.heading);
  s.x += fx * s.speed * dt;
  s.z += fz * s.speed * dt;
  // Wind pushes the plane sideways — in the air only. A parked plane must
  // not slide across the ground (v3 play test 4: the stopped plane drifted
  // 17 m downhill behind the debrief), and the same push drifted the plane
  // sideways during the takeoff roll.
  if (!s.onGround) s.x += Math.cos(s.heading) * s.wind * dt * 0.3;

  // Fuel burn.
  s.fuel = Math.max(0, s.fuel - s.throttle * PLANE.fuelBurn * dt);
  if (s.fuel <= 0 && s.throttle > 0) s.throttle = Math.max(0, s.throttle - dt * 0.2);

  // --- Ground / terrain ---
  const ground = terrainHeight(s.x, s.z);
  const groundClearance = s.y - ground;
  if (s.y <= ground + 1.2) {
    s.y = ground + 1.2;
    if (!s.onGround) {
      // Touchdown: record the landing quality BEFORE zeroing vertical speed.
      const field = fieldUnder(s);
      const def = field ? { x: field.x, z: field.z, heading: field.heading, length: field.length, width: field.width } : null;
      s.lastLanding = {
        vs: s.verticalSpeed,                 // m/s, negative = descending
        speed: s.speed,                      // m/s at touchdown
        centreline: def ? Math.abs(runwayAcross(s, def)) : 999,
        field: field ? field.name : 'Off-field',
        onRunway: def ? onRunway(s, def) : false,
      };
      // Touchdown damage only after a real airborne descent: a plane that
      // merely rolls off a bump (airTime ~ 0) touches down gently.
      const hard = s.airTime > 0.4 && (Math.abs(s.verticalSpeed) > 7 || Math.abs(s.roll) > 0.5);
      const fast = s.airTime > 0.2 && s.speed > 70;
      if (hard || fast) {
        s.damage += hard ? 45 : 20;
        events.touchedDown = true;
        if (s.damage >= 100) { s.crashed = true; events.crashed = true; }
      } else {
        events.touchedDown = true;
        s.landed = true;
      }
      s.verticalSpeed = 0;
      s.pitch = 0;
      s.roll *= 0.4;
      s.airTime = 0;
    }
    s.onGround = true;
    // Rolling friction / braking.
    s.speed = Math.max(0, s.speed - (input.brake ? 22 : 3) * dt);
    if (s.speed < 8 && s.throttle < 0.1) s.speed = Math.max(0, s.speed - 6 * dt);
  } else if (s.onGround && s.speed < stallSpeed * 1.05 && s.verticalSpeed <= 0.5) {
    // Ground stickiness (v5): below flying speed and not climbing, a dip
    // in bumpy terrain must not read as a takeoff. The old code let the
    // plane flicker airborne over every dip during the roll, which flagged
    // a stall at taxi speed and could turn a bump into hard-touchdown
    // damage on the way back down. Pin it to the surface instead — the
    // same friction applies as on the runway — and let a real rotation
    // (positive lift at flying speed, verticalSpeed > 0.5) leave the
    // ground the normal way, through the branch below.
    s.y = ground + 1.2;
    s.verticalSpeed = 0;
    s.speed = Math.max(0, s.speed - (input.brake ? 22 : 3) * dt);
    if (s.speed < 8 && s.throttle < 0.1) s.speed = Math.max(0, s.speed - 6 * dt);
  } else {
    s.onGround = false;
    s.airTime += dt;
    if (wasGround && s.speed > stallSpeed) events.tookOff = true;
  }

  // Sea: below sea level away from land = ditching.
  if (ground < 2 && s.y < 1.5 && !s.onGround) {
    s.crashed = true; events.crashed = true; s.damage = 100;
  }
  // World bounds: turn the plane gently back toward the island. The rate
  // must stay well below the plane's own turn authority (0.55 rad/s), or
  // it overpowers the autopilot: the first version spun at 0.63 rad/s, so
  // a plane placed 2 km out on final just orbited out there forever while
  // the AP — max turn 0.31 rad/s — could never win the fight.
  if (Math.abs(s.x) > 2000 || Math.abs(s.z) > 2000) {
    s.heading = wrapAngle(s.heading + Math.PI * dt * 0.05);
  }
  return events;
}

/** Distance from the plane to a point. */
export function distanceTo(s, x, y, z) {
  const dx = s.x - x, dy = s.y - y, dz = s.z - z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Is the plane on (or very near) a runway strip? */
export function onRunway(s, def) {
  const dx = s.x - def.x, dz = s.z - def.z;
  const along = dx * Math.sin(def.heading) + dz * Math.cos(def.heading);
  const across = dx * Math.cos(def.heading) - dz * Math.sin(def.heading);
  return Math.abs(along) < def.length / 2 && Math.abs(across) < def.width / 2 + 6;
}

/**
 * Score a landing 0-100 from touchdown quality.
 * vs: vertical speed (m/s, negative), centreline: metres off centre,
 * speed: approach speed (m/s). Returns { score, grade }.
 */
export function scoreLanding(vs, centreline, speed) {
  const absVs = Math.abs(vs);
  const vsScore = absVs <= 2 ? 100 : absVs <= 4 ? 80 : absVs <= 7 ? 55 : 25;
  const clScore = centreline <= 5 ? 100 : centreline <= 12 ? 80 : centreline <= 20 ? 55 : 30;
  const kt = speed * 1.94384;
  const spScore = kt >= 40 && kt <= 60 ? 100 : kt > 60 && kt <= 75 ? 75 : kt > 75 ? 45 : 60;
  const score = Math.round(vsScore * 0.4 + clScore * 0.3 + spScore * 0.3);
  const grade = score >= 90 ? 'GREASED' : score >= 75 ? 'SMOOTH' : score >= 55 ? 'FIRM' : 'HARD';
  return { score, grade };
}
