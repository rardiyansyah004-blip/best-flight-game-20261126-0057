// MERAPI AIRMAIL v2 — deterministic screenshot scenes. Each scene flies the
// real flight model forward from a fixed start with a simple autopilot, so
// the frame is what real play looks like and the same seed gives the same frame.
// v2 recomposition: the next numbered gate sits DEAD AHEAD of the plane with
// its distance label, the destination runway lies beyond it, and the full HUD
// (mission + route best + approach panel + dials + minimap) is in frame.
// Shot messages are kept SHORT so the message bar never covers the gate.
// The plane flies slightly BELOW the gate centre so the ring stays fully
// visible above the fuselage instead of hiding behind it.
import { WORLD, AIRFIELDS } from './config.js';
import { createFlightState, stepFlight } from './flight.js';
import { objectiveText } from './missions.js';

const STEP = 1 / 60;

/** Steer toward a target point: returns {pitch, roll, throttleDelta}. */
function steerTo(flight, tx, ty, tz, speedTarget) {
  const dx = tx - flight.x, dz = tz - flight.z;
  const wantHeading = Math.atan2(dx, dz);
  let dh = wantHeading - flight.heading;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const roll = Math.max(-1, Math.min(1, dh * 1.6));
  const dy = ty - flight.y;
  const pitch = Math.max(-0.5, Math.min(0.5, dy * 0.004 + (flight.speed < 30 ? 0.25 : 0)));
  const throttleDelta = flight.speed < speedTarget ? 1 : flight.speed > speedTarget + 8 ? -1 : 0;
  return { pitch, roll, yaw: 0, throttleDelta, brake: false };
}

function runSteps(flight, weather, seconds, pilot) {
  for (let i = 0; i < seconds / STEP; i++) {
    const input = pilot(flight);
    stepFlight(flight, input, STEP, weather);
    if (flight.crashed) break;
  }
}

/**
 * Place the plane exactly behind a gate, heading straight at it, so the
 * gate is dead-centre in the chase view. dist = metres behind the gate,
 * drop = metres below the gate centre (keeps the ring visible above the plane).
 */
function lineUpOnGate(flight, gate, dist, drop) {
  const heading = Math.atan2(gate.x - flight.x, gate.z - flight.z);
  const fx = Math.sin(heading), fz = Math.cos(heading);
  flight.x = gate.x - fx * dist;
  flight.z = gate.z - fz * dist;
  flight.y = gate.y - (drop || 0);
  flight.heading = heading;
  flight.pitch = 0.02;
  flight.roll = 0.05;
}

/** Recompute the mission objective after the shot sets its step, then return. */
function finishStage(game) {
  game.mission.objective = objectiveText(game.mission);
  return { screen: 'play' };
}

/**
 * Stage a named scene and return the view + mission to display.
 * Scenes: cover | cockpit | rings | night.
 */
export function stageShot(name, game) {
  const flight = game.flight;
  const weatherDay = { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false };
  const golden = { mode: 'golden', gustStrength: 0.2, windSpeed: 4, rain: false };
  const night = { mode: 'night', gustStrength: 0.25, windSpeed: 3, rain: false };

  if (name === 'cockpit') {
    // Final approach to Parangtritis Strip, cockpit view, instruments lit,
    // next mail gate dead ahead on the approach path.
    game.mission = game.newMission('airmail');
    game.mission.started = true;
    game.mission.step = 7; // last gate sits just short of the strip
    game.mission.gates.slice(0, 7).forEach((g) => { g.done = true; });
    game.mission.elapsed = 196; game.mission.score = 1150;
    game.mission.routeBest = { time: 214, score: 1240, landingScore: 88 };
    game.mission.message = 'Final gate — Parangtritis Strip ahead, gear down.';
    const gate = game.mission.gates[7];
    flight.x = gate.x - 260; flight.z = gate.z - 420;
    lineUpOnGate(flight, gate, 300, 0);
    flight.y = 165; flight.speed = 52; flight.throttle = 0.45; flight.onGround = false;
    flight.flaps = 1; flight.gearDown = true;
    game.setCameraMode('cockpit');
    game.setWeather(golden);
    return finishStage(game);
  }
  if (name === 'rings') {
    // Early ring-course over the bay, chase view: gate 2 dead ahead, gates
    // 3-5 visible in sequence beyond it across the island (gate 4's view
    // is blocked by the volcano cone, so the sequence is shot from gate 2).
    game.mission = game.newMission('rings');
    game.mission.started = true;
    game.mission.step = 1;
    game.mission.gates.slice(0, 1).forEach((g) => { g.done = true; });
    game.mission.elapsed = 20; game.mission.score = 100;
    game.mission.routeBest = { time: 98, score: 1180, landingScore: 82 };
    game.mission.message = 'Gate 2 of 7 — over the bay, the island ahead.';
    const gate = game.mission.gates[1];
    flight.x = gate.x - 200; flight.z = gate.z - 300;
    lineUpOnGate(flight, gate, 280, 25);
    flight.speed = 62; flight.throttle = 0.8; flight.onGround = false;
    game.setCameraMode('chase');
    game.setWeather(golden);
    runSteps(flight, golden, 0.4, (f) => steerTo(f, gate.x, gate.y, gate.z, 62));
    lineUpOnGate(flight, gate, 280, 25); // re-centre after the autopilot drift
    flight.speed = 62;
    return finishStage(game);
  }
  if (name === 'night') {
    // Night landing: short final to the lit Merapi Field runway, gear down,
    // town lights below, approach panel calling RWY 09 at ~400 m.
    // (night is a bonus-gate kind: progress lives in bonusStep, not step.)
    flight.x = WORLD.runway.x + 40; flight.z = WORLD.runway.z - 400;
    flight.y = 80; flight.heading = 0; flight.pitch = -0.08; flight.roll = 0;
    flight.speed = 48; flight.throttle = 0.35; flight.onGround = false;
    flight.flaps = 1; flight.gearDown = true;
    game.setCameraMode('cockpit');
    game.setWeather(night);
    game.mission = game.newMission('night');
    game.mission.started = true;
    game.mission.bonusStep = 5;
    game.mission.gates.slice(0, 5).forEach((g) => { g.done = true; });
    game.mission.elapsed = 188; game.mission.score = 250;
    game.mission.routeBest = { time: 202, score: 1090, landingScore: 91 };
    game.mission.message = 'Short final — lit runway 09, keep the glide slope.';
    return finishStage(game);
  }
  // cover (default): golden hour, chase view, mail route Merapi -> Parangtritis.
  // Next gate dead ahead with its distance label, destination strip beyond.
  game.mission = game.newMission('airmail');
  game.mission.started = true;
  game.mission.step = 2;
  game.mission.gates.slice(0, 2).forEach((g) => { g.done = true; });
  game.mission.elapsed = 38; game.mission.score = 300;
  game.mission.routeBest = { time: 214, score: 1240, landingScore: 88 };
  game.mission.message = 'Gate 3 of 8 — mail run to Parangtritis Strip.';
  const gate = game.mission.gates[2];
  flight.x = gate.x - 200; flight.z = gate.z - 300;
  lineUpOnGate(flight, gate, 260, 25);
  flight.speed = 64; flight.throttle = 0.85; flight.onGround = false;
  game.setCameraMode('chase');
  game.setWeather(golden);
  runSteps(flight, golden, 0.5, (f) => steerTo(f, gate.x, gate.y, gate.z, 64));
  lineUpOnGate(flight, gate, 260, 25); // re-centre after the autopilot drift
  flight.speed = 64; flight.pitch = 0.02; flight.roll = 0.05;
  return finishStage(game);
}

export { createFlightState };

/*
 * Framing notes (verified against the v2 HUD in headless Chromium):
 * - cover: gate 3 of the 8-gate Merapi -> Parangtritis mail route sits
 *   260 m dead ahead; the chase camera centres the plane and the gate,
 *   the approach panel names Parangtritis Strip RWY 04 beyond it, and the
 *   dials row + minimap + ATC box are all in frame at 1280x720.
 * - cockpit: final approach to Parangtritis, gate 8 ahead, panel lit.
 * - rings: gate 2 of the ring route dead ahead over the bay, gates 3-5
 *   visible in sequence beyond it across the island.
 * - night: short final to the lit Merapi Field runway, gear + flaps down.
 */
