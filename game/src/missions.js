// MERAPI AIRMAIL v2 — mission engine: 8 ROUTE missions (origin field ->
// numbered gates -> destination field), scored landing debrief, medals and
// a saved pilot logbook (localStorage) with career totals, recent flights
// and a best per route.
import { MISSIONS, WORLD, AIRFIELDS, routeGates, formatTime } from './config.js';
import { dropFields } from './world.js';
import { distanceTo, onRunway, scoreLanding } from './flight.js';

const LOG_KEY = 'merapi-airmail-pilot-log-v2';

/** Normalise any saved log (v1 or v2) into the v2 shape. */
export function loadPilotLog() {
  let raw = {};
  try {
    const s = localStorage.getItem(LOG_KEY) || localStorage.getItem('merapi-airmail-pilot-log-v1');
    if (s) raw = JSON.parse(s);
  } catch { raw = {}; }
  const log = {
    routes: {},
    career: { flights: 0, landings: 0, totalTime: 0, totalScore: 0, bestLanding: 0 },
    recent: [],
  };
  if (raw.routes) Object.assign(log.routes, raw.routes);
  if (raw.career) Object.assign(log.career, raw.career);
  if (Array.isArray(raw.recent)) log.recent = raw.recent.slice(0, 8);
  // v1 shape was { [missionId]: { time, score, medal } } — migrate as route bests.
  for (const m of MISSIONS) {
    if (raw[m.id] && raw[m.id].time) {
      log.routes[m.id] = { time: raw[m.id].time, score: raw[m.id].score || 0, medal: raw[m.id].medal || 'none', landingScore: 0 };
    }
  }
  return log;
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

/** Record a finished flight in the logbook: per-route best, career totals,
 *  recent flights. Returns true when a new route best was set. */
export function recordFlight(log, mission) {
  const id = mission.def.id;
  const prev = log.routes[id];
  const isBest = !prev || mission.elapsed < prev.time;
  if (isBest) {
    log.routes[id] = {
      time: Math.round(mission.elapsed),
      score: mission.score,
      medal: mission.medal || 'none',
      landingScore: mission.landing ? mission.landing.score : 0,
    };
  } else if (mission.landing && (!prev.landingScore || mission.landing.score > prev.landingScore)) {
    prev.landingScore = mission.landing.score;
  }
  log.career.flights += 1;
  log.career.totalTime += Math.round(mission.elapsed);
  log.career.totalScore += mission.score;
  if (mission.landing) {
    log.career.landings += 1;
    log.career.bestLanding = Math.max(log.career.bestLanding, mission.landing.score);
  }
  log.recent.unshift({
    route: mission.def.name,
    from: AIRFIELDS[mission.route.origin].short,
    to: AIRFIELDS[mission.route.dest].short,
    time: Math.round(mission.elapsed),
    score: mission.score,
    medal: mission.medal || 'none',
    landingScore: mission.landing ? mission.landing.score : 0,
    date: new Date().toISOString().slice(0, 10),
  });
  log.recent = log.recent.slice(0, 8);
  savePilotLog(log);
  return isBest;
}

/** Build the runtime state for a mission id. opts: { free: true } for the
 *  free gate course (no medal pressure, land anywhere to finish). */
export function createMission(id, weather, opts) {
  const def = MISSIONS.find((m) => m.id === id) || MISSIONS[0];
  const route = def.route;
  const gates = routeGates(route.origin, route.dest, route.gates, def.num * 7919, 200);
  const state = {
    def, route,
    origin: AIRFIELDS[route.origin],
    dest: AIRFIELDS[route.dest],
    started: false, finished: false, failed: false, failedReason: '',
    elapsed: 0, step: 0, score: 0, free: !!(opts && opts.free),
    bonusStep: 0,   // en-route bonus gates on storm/night/rescue/aero
    leg: 0,         // rescue: 0 = outbound, 1 = returning home
    manoeuvreStep: 0, // aero: 0 loop, 1 roll, 2 Immelmann, 3 land
    gates: gates.map((p) => ({ x: p.x, y: p.y, z: p.z, done: false })),
    rings: null, drops: dropFields().map((d) => ({ ...d, done: false })),
    aerobatics: { loop: false, roll: false, immelmann: false, rollAngle: 0, loopAngle: 0 },
    message: def.brief, objective: '',
    weather: weather || { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false },
    landing: null, // { vs, speed, centreline, field, score, grade } — set on landing
    newBest: false,
  };
  state.rings = state.gates; // rings/race fly the same route gates
  state.objective = objectiveText(state);
  return state;
}

function objectiveText(mission) {
  const def = mission.def;
  const dest = mission.dest;
  const n = def.route.gates;
  const allFlown = 'All gates flown — land ' + dest.name + ' RWY ' + dest.rwy;
  switch (def.kind) {
    case 'takeoff':
      if (mission.step >= n) return 'All gates flown — land on Runway 09';
      return mission.step === 0 ? 'Take off from Runway 09 — rotate at 55 kt' : 'Circuit gate ' + (mission.step + 1) + ' of ' + n + ', then land on Runway 09';
    case 'rings':
      if (mission.step >= n) return allFlown;
      return 'Gate ' + (mission.step + 1) + ' of ' + n + ' → land ' + dest.name + ' RWY ' + dest.rwy;
    case 'drops':
      if (mission.step >= n) return allFlown;
      return 'Mail gate ' + (mission.step + 1) + ' of ' + n + ' → land ' + dest.name + ' RWY ' + dest.rwy;
    case 'rescue': return mission.leg === 0 ? 'Gate ' + (mission.bonusStep + 1) + ' of ' + n + ' → land Parangtritis Strip, pick up the hiker' : 'Hiker aboard! Fly home and land Merapi Field RWY 09';
    case 'race':
      if (mission.step >= n) return allFlown;
      return 'Gate ' + (mission.step + 1) + ' of ' + n + ' → land ' + dest.name + ' RWY ' + dest.rwy;
    case 'storm':
      if (mission.bonusStep >= n) return allFlown;
      return 'Gate ' + (mission.bonusStep + 1) + ' of ' + n + ' through the squall → land ' + dest.name;
    case 'night':
      if (mission.bonusStep >= n) return allFlown;
      return 'Gate ' + (mission.bonusStep + 1) + ' of ' + n + ' → land Merapi Field RWY 09 (lit)';
    case 'aero': return mission.manoeuvreStep === 0 ? 'Loop over the bay (gate line ahead)' : mission.manoeuvreStep === 1 ? 'Barrel roll' : mission.manoeuvreStep === 2 ? 'Immelmann turn, then level out' : 'Manoeuvres done — land Merapi Field RWY 09';
    default: return def.par;
  }
}

/** Score the landing from the flight model's last touchdown record. */
function captureLanding(mission, flight) {
  if (!flight.lastLanding) return null;
  const L = flight.lastLanding;
  const { score, grade } = scoreLanding(L.vs, L.centreline, L.speed);
  return {
    vs: L.vs, speed: L.speed, centreline: L.centreline, field: L.field,
    onRunway: L.onRunway, score, grade,
  };
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
  const dest = mission.dest;

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

  // Required gates: rings / race / airmail / takeoff circuit fly them in order.
  const gateKinds = ['rings', 'race', 'drops', 'takeoff'];
  const nextGate = mission.gates[mission.step];
  if (gateKinds.includes(def.kind) && nextGate && distanceTo(flight, nextGate.x, nextGate.y, nextGate.z) < 30) {
    nextGate.done = true;
    mission.step += 1;
    mission.score += def.kind === 'drops' ? 150 : 100;
    mission.message = def.kind === 'drops'
      ? 'Parcel away over gate ' + mission.step + '! (' + mission.gates.length + ' mail gates on this route)'
      : 'Gate ' + mission.step + ' of ' + mission.gates.length + ' — clean!';
  }
  // Bonus gates on the other kinds: +50 each, not required, own counter so
  // they never disturb rescue legs or aerobatic sequencing.
  const bonusGate = mission.gates[mission.bonusStep];
  if (!gateKinds.includes(def.kind) && bonusGate && mission.bonusStep < mission.gates.length
      && distanceTo(flight, bonusGate.x, bonusGate.y, bonusGate.z) < 30) {
    bonusGate.done = true;
    mission.bonusStep += 1;
    mission.score += 50;
    mission.message = 'En-route gate ' + mission.bonusStep + ' — bonus +50.';
  }

  const landedDest = flight.onGround && flight.speed < 5 && onRunway(flight, dest) && mission.elapsed > 20;
  const landedHome = flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.runway);

  switch (def.kind) {
    case 'takeoff': {
      if (mission.step >= mission.gates.length && landedHome) {
        mission.landing = captureLanding(mission, flight);
        finishMission(mission);
      }
      break;
    }
    case 'rings':
    case 'race':
    case 'drops': {
      if (mission.step >= mission.gates.length && landedDest) {
        mission.landing = captureLanding(mission, flight);
        finishMission(mission);
      } else if (mission.step >= mission.gates.length && !mission._gatesDoneMsg) {
        mission._gatesDoneMsg = true;
        mission.message = 'All gates flown — now land at ' + dest.name + ' RWY ' + dest.rwy + '.';
      }
      break;
    }
    case 'rescue': {
      // Leg 1: land at Parangtritis (strip2) to pick up the hiker.
      if (mission.leg === 0 && flight.onGround && flight.speed < 5 && onRunway(flight, WORLD.strip2)) {
        mission.leg = 1;
        mission.message = 'Hiker aboard! Now fly them home to Merapi Field.';
        mission.score += 200;
      }
      if (mission.leg === 1 && landedHome) {
        mission.landing = captureLanding(mission, flight);
        finishMission(mission);
      }
      break;
    }
    case 'storm': {
      if (landedDest) {
        mission.landing = captureLanding(mission, flight);
        finishMission(mission);
      }
      break;
    }
    case 'night': {
      if (landedDest) {
        mission.landing = captureLanding(mission, flight);
        finishMission(mission);
      }
      break;
    }
    case 'aero': {
      // Track cumulative pitch/roll rotation for manoeuvres.
      const a = mission.aerobatics;
      a.loopAngle += flight.pitch * dt * 2;
      a.rollAngle += flight.roll * dt * 2;
      const ms = mission.manoeuvreStep;
      if (ms === 0 && Math.abs(a.loopAngle) > 5.5) { a.loop = true; mission.manoeuvreStep = 1; mission.message = 'Loop complete! Now the barrel roll.'; }
      else if (ms === 1 && Math.abs(a.rollAngle) > 5.5) { a.roll = true; mission.manoeuvreStep = 2; mission.message = 'Roll complete! Finish with an Immelmann.'; }
      else if (ms === 2 && Math.abs(a.loopAngle) > 11) { a.immelmann = true; mission.manoeuvreStep = 3; mission.message = 'Manoeuvres done — land on Runway 09 for the crowd.'; }
      else if (ms === 3 && landedHome) {
        mission.landing = captureLanding(mission, flight);
        finishMission(mission);
      }
      break;
    }
    default: break;
  }
  // Free gate course: any landing after 3 gates finishes the flight.
  if (mission.free && mission.step >= 3 && flight.onGround && flight.speed < 5) {
    mission.landing = captureLanding(mission, flight);
    finishMission(mission);
  }
  mission.objective = objectiveText(mission);
}

function finishMission(mission) {
  mission.finished = true;
  const timeBonus = Math.max(0, Math.round((mission.def.bronze - mission.elapsed) * 2));
  const landingBonus = mission.landing ? mission.landing.score * 2 : 0;
  mission.score += timeBonus + landingBonus + 500;
  mission.medal = mission.free ? 'none' : medalFor(mission.elapsed, mission.def);
  mission.message = 'Mission complete in ' + formatTime(mission.elapsed) + ' — ' + (mission.medal === 'none' ? 'route flown!' : mission.medal + ' medal!');
}

/** Weather preset per mission id. */
export function weatherFor(id) {
  switch (id) {
    case 'storm': return { mode: 'storm', gustStrength: 0.9, windSpeed: 12, rain: true };
    case 'night': return { mode: 'night', gustStrength: 0.25, windSpeed: 3, rain: false };
    case 'race': return { mode: 'golden', gustStrength: 0.2, windSpeed: 4, rain: false };
    case 'airmail': return { mode: 'golden', gustStrength: 0.2, windSpeed: 4, rain: false };
    default: return { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false };
  }
}

/** Which gate the HUD / ring colours should highlight next. Required-gate
 *  kinds (rings/race/airmail/takeoff) track mission.step; the other kinds
 *  track the bonus-gate counter so the display never stalls at gate 1. */
export function gateProgress(mission) {
  const required = ['rings', 'race', 'drops', 'takeoff'].includes(mission.def.kind);
  return {
    next: required ? mission.step : mission.bonusStep,
    done: mission.gates.filter((g) => g.done).length,
    total: mission.gates.length,
  };
}

export { objectiveText };
