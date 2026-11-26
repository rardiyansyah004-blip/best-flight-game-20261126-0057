// MERAPI AIRMAIL — arcade flight model: pitch/roll/yaw, throttle, flaps,
// gear, stall and spin, wind gusts, terrain and sea collision, landing check.
import { PLANE, WORLD, clamp, wrapAngle } from './config.js';
import { terrainHeight } from './world.js';

export function createFlightState() {
  return {
    x: WORLD.runway.x, y: 8, z: WORLD.runway.z + WORLD.runway.length / 2 - 30,
    heading: 0, pitch: 0, roll: 0,
    speed: 0, throttle: 0, flaps: 0, gearDown: true,
    fuel: 100, damage: 0,
    onGround: true, crashed: false, landed: false,
    verticalSpeed: 0, stalled: false, spinning: false,
    wind: 0, gust: 0, time: 0,
  };
}

/**
 * Advance the flight model one step (dt seconds).
 * input: { pitch: -1..1 (stick back = climb), roll: -1..1, yaw: -1..1,
 *          throttleDelta, flapsToggle, gearToggle, brake }
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

  // Wind gusts (weather.gustStrength 0..1, deterministic-ish via time).
  const gustPhase = Math.sin(s.time * 0.9) * 0.5 + Math.sin(s.time * 2.3) * 0.5;
  s.gust = gustPhase * (weather ? weather.gustStrength : 0.1) * 6;
  s.wind = (weather ? weather.windSpeed : 2) + s.gust;

  // --- Aerodynamics ---
  const targetSpeed = s.throttle * PLANE.maxSpeed;
  const accel = (targetSpeed - s.speed) * 0.25;
  s.speed = Math.max(0, s.speed + accel * dt);
  if (s.speed < 0.5 && s.onGround && s.throttle < 0.05) s.speed = 0;

  // Roll follows stick; bank turns the heading.
  const targetRoll = clamp((input.roll || 0) * 1.1, -1.1, 1.1);
  s.roll += (targetRoll - s.roll) * Math.min(1, dt * 3.5);
  const turn = -Math.sin(s.roll) * PLANE.turnRate * clamp(s.speed / PLANE.cruiseSpeed, 0.25, 1);
  s.heading = wrapAngle(s.heading + turn * dt + (input.yaw || 0) * 0.15 * dt);

  // Pitch follows stick, limited by speed; stall below stall speed.
  const stallSpeed = PLANE.stallSpeed * (1 - s.flaps * 0.25);
  s.stalled = !s.onGround && s.speed < stallSpeed;
  if (s.stalled) events.stalled = true;
  const pitchTarget = clamp((input.pitch || 0) * 0.45, -0.45, 0.45);
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
  // Wind pushes the plane sideways (crosswind component).
  s.x += Math.cos(s.heading) * s.wind * dt * 0.3;

  // Fuel burn.
  s.fuel = Math.max(0, s.fuel - s.throttle * PLANE.fuelBurn * dt);
  if (s.fuel <= 0 && s.throttle > 0) s.throttle = Math.max(0, s.throttle - dt * 0.2);

  // --- Ground / terrain ---
  const ground = terrainHeight(s.x, s.z);
  const groundClearance = s.y - ground;
  if (s.y <= ground + 1.2) {
    s.y = ground + 1.2;
    if (!s.onGround) {
      // Touchdown: hard landing = damage; gentle = landed.
      const hard = Math.abs(s.verticalSpeed) > 7 || Math.abs(s.roll) > 0.5;
      const fast = s.speed > 70;
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
    }
    s.onGround = true;
    // Rolling friction / braking.
    s.speed = Math.max(0, s.speed - (input.brake ? 22 : 3) * dt);
    if (s.speed < 8 && s.throttle < 0.1) s.speed = Math.max(0, s.speed - 6 * dt);
  } else {
    s.onGround = false;
    if (wasGround && s.speed > stallSpeed) events.tookOff = true;
  }

  // Sea: below sea level away from land = ditching.
  if (ground < 2 && s.y < 1.5 && !s.onGround) {
    s.crashed = true; events.crashed = true; s.damage = 100;
  }
  // World bounds: turn the plane gently back.
  if (Math.abs(s.x) > 2000 || Math.abs(s.z) > 2000) {
    s.heading = wrapAngle(s.heading + Math.PI * dt * 0.2);
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
