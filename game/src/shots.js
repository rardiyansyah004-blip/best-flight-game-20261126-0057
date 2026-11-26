// MERAPI AIRMAIL — deterministic screenshot scenes. Each scene flies the
// real flight model forward from a fixed start with a simple autopilot, so
// the frame is what real play looks like and the same seed gives the same frame.
import { WORLD } from './config.js';
import { createFlightState, stepFlight } from './flight.js';
import { ringPositions } from './world.js';

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
 * Stage a named scene and return the view + mission to display.
 * Scenes: cover | cockpit | rings | night.
 */
export function stageShot(name, game) {
  const flight = game.flight;
  const weatherDay = { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false };
  const golden = { mode: 'golden', gustStrength: 0.2, windSpeed: 4, rain: false };
  const night = { mode: 'night', gustStrength: 0.25, windSpeed: 3, rain: false };

  if (name === 'cockpit') {
    // On final approach to the lit runway, cockpit view, instruments lit.
    flight.x = WORLD.runway.x; flight.z = WORLD.runway.z - 1500;
    flight.y = 190; flight.heading = 0; flight.pitch = -0.06; flight.roll = 0;
    flight.speed = 55; flight.throttle = 0.45; flight.onGround = false;
    game.setCameraMode('cockpit');
    game.setWeather(night.mode === 'night' ? golden : golden);
    game.mission = game.newMission('takeoff');
    game.mission.started = true;
    game.mission.step = 1;
    game.mission.elapsed = 96;
    return { screen: 'play' };
  }
  if (name === 'rings') {
    // Mid ring-course, chase view, rings + volcano ahead.
    const rings = ringPositions();
    flight.x = rings[1][0] - 120; flight.y = 205; flight.z = rings[1][2] - 260;
    flight.heading = Math.atan2(rings[2][0] - flight.x, rings[2][2] - flight.z);
    flight.speed = 62; flight.throttle = 0.8; flight.onGround = false;
    flight.pitch = 0.02; flight.roll = -0.15;
    game.setCameraMode('chase');
    game.setWeather(golden);
    game.mission = game.newMission('rings');
    game.mission.started = true;
    game.mission.step = 2;
    game.mission.rings[0].done = true; game.mission.rings[1].done = true;
    game.mission.elapsed = 41; game.mission.score = 200;
    runSteps(flight, golden, 0.5, (f) => steerTo(f, rings[2][0], rings[2][1], rings[2][2], 62));
    return { screen: 'play' };
  }
  if (name === 'night') {
    // Night landing: short final, lit runway ahead, town lights below.
    flight.x = WORLD.runway.x + 40; flight.z = WORLD.runway.z - 400;
    flight.y = 80; flight.heading = 0; flight.pitch = -0.08; flight.roll = 0;
    flight.speed = 48; flight.throttle = 0.35; flight.onGround = false;
    flight.flaps = 1; flight.gearDown = true;
    game.setCameraMode('cockpit');
    game.setWeather(night);
    game.mission = game.newMission('night');
    game.mission.started = true;
    game.mission.elapsed = 188; game.mission.score = 0;
    return { screen: 'play' };
  }
  // cover (default): golden hour, chase view, ring ahead, town + coast below.
  const rings = ringPositions();
  flight.x = rings[0][0] - 260; flight.y = 185; flight.z = rings[0][2] - 420;
  flight.heading = Math.atan2(rings[0][0] - flight.x, rings[0][2] - flight.z);
  flight.speed = 64; flight.throttle = 0.85; flight.onGround = false;
  flight.pitch = 0.03; flight.roll = 0.1;
  game.setCameraMode('chase');
  game.setWeather(golden);
  game.mission = game.newMission('rings');
  game.mission.started = true;
  game.mission.step = 1;
  game.mission.rings[0].done = true;
  game.mission.elapsed = 18; game.mission.score = 100;
  runSteps(flight, golden, 0.8, (f) => steerTo(f, rings[1][0], rings[1][1], rings[1][2], 64));
  flight.roll = 0.06; flight.pitch = 0.02; // gentle bank for the cover frame
  return { screen: 'play' };
}

export { createFlightState };
