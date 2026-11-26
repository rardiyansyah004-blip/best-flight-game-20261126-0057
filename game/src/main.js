// MERAPI AIRMAIL — game loop and state machine: title, briefing, flying,
// paused, results. Also hosts the deterministic ?shot= scenes for screenshots.
import { WORLD, MISSIONS } from './config.js';
import { createFlightState, stepFlight, onRunway } from './flight.js';
import { createMission, stepMission, weatherFor, loadPilotLog, savePilotLog, medalFor } from './missions.js';
import { createRenderer, applyLighting, updateScene, setRingStates, updatePanel } from './render.js';
import { buildHud, updateHud, showTitle, showBriefing, showResults, hideMenu } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // cover | cockpit | rings | night

const game = {
  screen: 'title', // title | briefing | play | paused | results
  flight: createFlightState(),
  mission: null,
  missionId: 'takeoff',
  cameraMode: 'chase',
  weather: { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false },
  log: loadPilotLog(),
  paused: false,
};

const r = createRenderer();
const hud = buildHud();
const input = createInput();
const audio = createAudio();

game.newMission = function newMission(id) {
  game.missionId = id;
  game.weather = weatherFor(id);
  return createMission(id, game.weather);
};
game.setCameraMode = function setCameraMode(mode) { game.cameraMode = mode; };
game.setWeather = function setWeather(w) {
  game.weather = w;
  applyLighting(r, w.mode);
  r.rain.visible = !!w.rain;
};

function resetFlightForMission(id) {
  game.flight = createFlightState();
  game.mission = game.newMission(id);
  game.cameraMode = 'chase';
  game.setWeather(game.weather);
  applyLighting(r, game.weather.mode);
  r.rain.visible = !!game.weather.rain;
  // Storm / night missions start airborne for a quicker start.
  if (id === 'storm') {
    game.flight.x = -900; game.flight.z = 900; game.flight.y = 320;
    game.flight.heading = 0.6; game.flight.speed = 60; game.flight.throttle = 0.7;
    game.flight.onGround = false;
  }
  if (id === 'night') {
    game.flight.x = WORLD.runway.x; game.flight.z = WORLD.runway.z - 1600;
    game.flight.y = 260; game.flight.heading = 0; game.flight.speed = 55;
    game.flight.throttle = 0.5; game.flight.onGround = false;
  }
}

function startMission(id) {
  resetFlightForMission(id);
  game.screen = 'briefing';
  showBriefing(game.mission);
}

function flyMission() {
  game.screen = 'play';
  hideMenu();
  audio.init();
}

function backToTitle() {
  game.screen = 'title';
  game.mission = null;
  game.flight = createFlightState();
  game.setWeather({ mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false });
  applyLighting(r, 'day');
  showTitle(game.log);
}

function finishMissionScreen() {
  game.screen = 'results';
  const m = game.mission;
  if (m.finished) {
    const prev = game.log[m.def.id];
    if (!prev || m.elapsed < prev.time || (m.medal === 'gold' && prev.medal !== 'gold')) {
      game.log[m.def.id] = { time: Math.round(m.elapsed), score: m.score, medal: m.medal };
      savePilotLog(game.log);
    }
  }
  showResults(m, game.log);
}

window.addEventListener('merapi:mission', (e) => startMission(e.detail));
window.addEventListener('merapi:fly', () => flyMission());
window.addEventListener('merapi:back', () => backToTitle());

// --- Shot mode: deterministic staged scenes for screenshots ---
let shotReady = false;
if (SHOT) {
  game.screen = 'play';
  hideMenu();
  game.flight = createFlightState();
  stageShot(SHOT, game);
  // Let the camera settle, then mark ready for the screenshot tool.
  let settle = 0;
  const settleLoop = () => {
    updateScene(r, game.flight, game.cameraMode, 1 / 60, 0);
    updatePanel(r, game.flight);
    updateHud(hud, game.flight, game.mission, game.cameraMode);
    r.renderer.render(r.scene, r.camera);
    settle += 1;
    if (settle < 45) requestAnimationFrame(settleLoop);
    else { shotReady = true; window.__shotReady = true; }
  };
  requestAnimationFrame(settleLoop);
} else {
  backToTitle();
}

// --- Main loop ---
let last = performance.now();
let stallAlarmAt = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (SHOT) return; // shot mode renders its own settled frame

  if (game.screen === 'play' && !game.paused) {
    input.poll();
    const ctrl = {
      pitch: input.pitch, roll: input.roll, yaw: input.yaw,
      throttleDelta: input.throttleDelta, brake: input.brake,
      flapsToggle: input.consume('KeyF'),
      gearToggle: input.consume('KeyG'),
    };
    if (input.consume('KeyC')) game.cameraMode = game.cameraMode === 'chase' ? 'cockpit' : 'chase';
    if (input.consume('KeyM')) audio.toggleMute();
    const events = stepFlight(game.flight, ctrl, dt, game.weather);
    stepMission(game.mission, game.flight, events, dt);
    audio.update(game.flight.throttle, game.flight.speed, game.flight.onGround);
    if (events.touchedDown) audio.thud();
    if (events.tookOff) audio.ring();
    if (game.mission && game.mission.step > 0 && game.mission.message.includes('Ring') && !game._rang) { audio.ring(); game._rang = true; }
    if (game.flight.stalled && now - stallAlarmAt > 1200) { audio.alarm(); stallAlarmAt = now; }
    if (game.mission && (game.mission.finished || game.mission.failed)) finishMissionScreen();
    // Ring gate colours follow mission progress.
    if (game.mission) {
      const list = game.mission.def.kind === 'race' ? game.mission.gates : game.mission.rings;
      const done = list.filter((g) => g.done).length;
      setRingStates(r.rings, game.mission.step < list.length ? game.mission.step : -1, done);
    }
  }
  if (input.consume('KeyP') && game.screen === 'play') {
    game.paused = !game.paused;
    hud.message.textContent = game.paused ? 'PAUSED — press P to resume' : '';
  }
  if (game.screen === 'title') {
    // Gentle orbit around the island behind the title menu.
    const t = now / 1000;
    game.flight.x = Math.sin(t * 0.05) * 900;
    game.flight.z = Math.cos(t * 0.05) * 900;
    game.flight.y = 420;
    game.flight.heading = Math.atan2(Math.cos(t * 0.05), -Math.sin(t * 0.05));
    game.flight.speed = 50;
    updateScene(r, game.flight, 'chase', dt, t);
    r.renderer.render(r.scene, r.camera);
    return;
  }
  if (game.screen === 'play' || game.screen === 'paused') {
    updateScene(r, game.flight, game.cameraMode, dt, now / 1000);
    updatePanel(r, game.flight);
    updateHud(hud, game.flight, game.mission, game.cameraMode);
    r.renderer.render(r.scene, r.camera);
  }
}
requestAnimationFrame(loop);

// Expose a tiny debug handle for play-testing in the console.
window.__merapi = { game, WORLD, MISSIONS, medalFor };
