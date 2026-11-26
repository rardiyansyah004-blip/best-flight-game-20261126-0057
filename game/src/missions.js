// MERAPI AIRMAIL — mission engine: 8 missions with objectives, timers,
// scoring, medals and a saved pilot log (localStorage).
import { MISSIONS, WORLD, formatTime } from './config.js';
import { ringPositions, dropFields } from './world.js';
import { distanceTo, onRunway } from './flight.js';

const LOG_KEY = 'merapi-airmail-pilot-log-v1';

export function loadPilotLog() {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

export function savePilotLog(log) {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch { /* private mode */ }
}

export function medalFor(time, mission) {
  if (time <= mission.gold) return 'gold';
  if (time <= mission.silver) return 'silver';
  if (time <= mission.bronze) return 'bronze';
  return 'none';
}

/** Build the runtime state for a mission id. */
export function createMission(id, weather) {
  const def = MISSIONS.find((m) => m.id === id) || MISSIONS[0];
  const state = {
    def, started: false, finished: false, failed: false, failedReason: '',
    elapsed: 0, step: 0, score: 0,
    rings: ringPositions().map((p) => ({ x: p[0], y: p[1], z: p[2], done: false })),
    drops: dropFields().map((d) => ({ ...d, done: false })),
    gates: ringPositions().slice(0, 10).map((p) => ({ x: p[0], y: p[1], z: p[2], done: false })),
    aerobatics: { loop: false, roll: false, immelmann: false, rollAngle: 0, loopAngle: 0 },
    message: def.brief, objective: objectiveText(def, 0),
    weather: weather || { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false },
  };
  if (id === 'race') state.gates = ringPositions().map((p, i) => ({ x: p[0], y: p[1], z: p[2], done: false }));
  return state;
}

function objectiveText(def, step) {
  switch (def.kind) {
    case 'takeoff': return step === 0 ? 'Take off from Runway 09 — rotate at 55 kt' : 'Land back on Runway 09';
    case 'rings': return 'Fly through ring ' + (step + 1) + ' of 8';
    case 'drops': return 'Deliver parcel ' + (step + 1) + ' of 3 — low and slow over the marked field';
    case 'rescue': return step === 0 ? 'Land on the mountain strip' : 'Pick up the hiker, then return to Merapi Field';
    case 'race': return 'Gate ' + (step + 1) + ' of 10 — beat the clock';
    case 'storm': return 'Cross the squall and land at the far strip';
    case 'night': return 'Land on the lit runway — keep the glide slope';
    case 'aero': return step === 0 ? 'Loop over the bay' : step === 1 ? 'Barrel roll' : 'Immelmann turn, then level out';
    default: return def.par;
  }
}

/**
 * Advance mission logic one frame. flight = flight state, events from stepFlight.
 * Returns { done, failed } transitions; mutates mission state.
 */
export function stepMission(mission, flight, events, dt) {
  if (mission.finished || mission.failed) return;
  if (!mission.started) {
    // Mission starts when the player first throttles up or moves.
    if (flight.throttle > 0.2 || flight.speed > 5) mission.started = true;
    else return;
  }
  mission.elapsed += dt;
  const def = mission.def;

  if (flight.crashed) {
    mission.failed = true;
    mission.failedReason = 'Aircraft lost — the sortie ends here.';
    return;
  }
  if (flight.fuel <= 0 && !flight.onGround) {
    mission.failed = true;
    mission.failedReason = 'Out of fuel — the engine quit over the island.';
    return;
  }

  switch (def.kind) {
    case 'takeoff': {
      if (mission.step === 0 && events.tookOff) { mission.step = 1; mission.message = 'Airborne! Climb to 300 m, then bring her home.'; }
      if (mission.step === 1 && flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.runway) && mission.elapsed > 20) {
        finishMission(mission);
      }
      break;
    }
    case 'rings':
    case 'race': {
      const list = def.kind === 'rings' ? mission.rings : mission.gates;
      const next = list[mission.step];
      if (next && distanceTo(flight, next.x, next.y, next.z) < 30) {
        next.done = true;
        mission.step += 1;
        mission.score += 100;
        mission.message = def.kind === 'rings' ? 'Ring ' + mission.step + ' of 8 — clean!' : 'Gate ' + mission.step + ' of 10!';
        if (mission.step >= list.length) finishMission(mission);
      }
      break;
    }
    case 'drops': {
      const next = mission.drops[mission.step];
      if (next && !flight.onGround && Math.abs(flight.x - next.x) < 60 && Math.abs(flight.z - next.z) < 60 && flight.y < 160) {
        next.done = true;
        mission.step += 1;
        const bonus = flight.y < 90 ? 150 : 100;
        mission.score += bonus;
        mission.message = 'Parcel away over ' + next.name + '! (' + (bonus === 150 ? 'low drop bonus' : 'delivered') + ')';
        if (mission.step >= mission.drops.length) {
          mission.message = 'All parcels delivered — return to Merapi Field and land.';
          mission.step = 99;
        }
      }
      if (mission.step === 99 && flight.onGround && onRunway(flight, WORLD.runway) && flight.speed < 5) finishMission(mission);
      break;
    }
    case 'rescue': {
      if (mission.step === 0 && flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.strip2)) {
        mission.step = 1;
        mission.message = 'Hiker aboard! Now fly them home to Merapi Field.';
      }
      if (mission.step === 1 && flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.runway)) finishMission(mission);
      break;
    }
    case 'storm': {
      if (flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.strip2) && mission.elapsed > 30) finishMission(mission);
      break;
    }
    case 'night': {
      if (flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.runway) && mission.elapsed > 30) finishMission(mission);
      break;
    }
    case 'aero': {
      // Track cumulative pitch/roll rotation for manoeuvres.
      const a = mission.aerobatics;
      a.loopAngle += flight.pitch * dt * 2;
      a.rollAngle += flight.roll * dt * 2;
      if (mission.step === 0 && Math.abs(a.loopAngle) > 5.5) { a.loop = true; mission.step = 1; mission.message = 'Loop complete! Now the barrel roll.'; }
      else if (mission.step === 1 && Math.abs(a.rollAngle) > 5.5) { a.roll = true; mission.step = 2; mission.message = 'Roll complete! Finish with an Immelmann.'; }
      else if (mission.step === 2 && Math.abs(a.loopAngle) > 11) { a.immelmann = true; finishMission(mission); }
      break;
    }
    default: break;
  }
  mission.objective = objectiveText(def, mission.step === 99 ? 3 : mission.step);
}

function finishMission(mission) {
  mission.finished = true;
  const timeBonus = Math.max(0, Math.round((mission.def.bronze - mission.elapsed) * 2));
  mission.score += timeBonus + 500;
  mission.medal = medalFor(mission.elapsed, mission.def);
  mission.message = 'Mission complete in ' + formatTime(mission.elapsed) + ' — ' + (mission.medal === 'none' ? 'no medal this time' : mission.medal + ' medal!');
}

/** Weather preset per mission id. */
export function weatherFor(id) {
  switch (id) {
    case 'storm': return { mode: 'storm', gustStrength: 0.9, windSpeed: 12, rain: true };
    case 'night': return { mode: 'night', gustStrength: 0.25, windSpeed: 3, rain: false };
    case 'race': return { mode: 'golden', gustStrength: 0.2, windSpeed: 4, rain: false };
    default: return { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false };
  }
}
