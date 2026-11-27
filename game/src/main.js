// MERAPI AIRMAIL v5 — game loop and state machine: title, briefing, flying,
// paused, results, logbook. Also hosts the deterministic ?shot= scenes.
// v2: B starts a new mission, N a free gate course, L the logbook, H hides
// the UI, I toggles instruments; missions start on their route's origin
// field and the ring gates follow the route.
// v3 (GeoFS material): N in flight opens the NAV chart panel, A toggles the
// autopilot (which flies the route's gates and the 3-degree glide path),
// Home/End trim the elevator, Delete resets trim, and PAPI lights beside
// each threshold show the glide slope live.
// v4 (UI feel): softer panels, eased dials, spring camera, sun, trails.
// v5: C cycles three cameras — chase, cockpit, orbit (the GeoFS free/orbit
// view) — and the takeoff finally works: the plane spawns at the threshold
// end of the runway with the full strip ahead (flight.js), and the
// autopilot joins the final through the final-approach fix when it is too
// high for a direct glide path (nav.js), so a full takeoff-to-landing run
// now completes instead of dying on the ridge past the runway.
// v5.17 Tier 3 (camera rig): the orbit camera is replaced by two
// cinematic modes — Wingtip (rigid mount outboard of the right wingtip,
// the cover-shot framing) and Fly-By (a side station gliding in
// formation). C cycles chase -> cockpit -> wingtip -> flyby, and the
// number keys 1-4 jump straight to a mode. The mode name shows in the
// mission-name bar (hud.js renders cameraMode + ' CAM') and the message
// bar names it on every switch. Re-picking the mode already active is
// a no-op, so holding a number key does not spam the message bar.
import { WORLD, MISSIONS, AIRFIELDS } from './config.js';
import { createFlightState, stepFlight, onRunway } from './flight.js';
import { createMission, stepMission, weatherFor, loadPilotLog, savePilotLog, medalFor, recordFlight, gateProgress } from './missions.js';
import { createRenderer, applyLighting, updateScene, setRingStates, updatePanel, updateRings } from './render.js';
import { buildHud, updateHud, showTitle, showBriefing, showResults, showLogbook, hideMenu } from './hud.js';
import { buildNavPanel, updateNavPanel, autopilotInput, setApStatus } from './nav.js';
import { papiState, updatePapi } from './world.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // cover | nav | rings | night

const game = {
  screen: 'title', // title | briefing | play | paused | results | logbook
  flight: createFlightState(),
  mission: null,
  missionId: 'takeoff',
  cameraMode: 'chase',
  weather: { mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false },
  log: loadPilotLog(),
  paused: false,
  instruments: true,
  hudVisible: true,
  screenBeforeLogbook: 'title',
  autopilot: false,   // v3: autopilot engaged (A)
  navOpen: false,     // v3: nav chart drawer open (N in flight)
  _glide: { dots: [1, 1, 0, 0], label: '—' }, // latest PAPI state
};

const r = createRenderer();
const hud = buildHud();
const nav = buildNavPanel();
const input = createInput();
const audio = createAudio();

/** Toggle the autopilot; an optional message goes on the HUD message bar. */
function setAutopilot(on, msg) {
  game.autopilot = !!on;
  setApStatus(nav, game.autopilot);
  if (msg) hud.message.textContent = msg;
}

/** Toggle the nav chart drawer (flight only). */
function toggleNav() {
  game.navOpen = !game.navOpen;
  nav.panel.style.display = game.navOpen ? 'block' : 'none';
  if (game.navOpen) updateNavPanel(nav, game.flight, game.mission, game.weather, game.autopilot);
}

/** The four camera modes, in cycle order. */
const CAMERA_MODES = ['chase', 'cockpit', 'wingtip', 'flyby'];

/** Pick a camera mode directly (number keys 1-4) and announce it. */
function pickCamera(mode) {
  if (!CAMERA_MODES.includes(mode)) return;
  if (game.cameraMode === mode) return; // already there — don't re-announce
  game.cameraMode = mode;
  hud.message.textContent = game.cameraMode.toUpperCase() + ' CAMERA — C to change, 1-4 to pick';
}

/** Cycle the camera (C): chase -> cockpit -> wingtip -> flyby -> chase.
 *  The mode also shows in the mission-name bar (hud.js renders
 *  cameraMode + ' CAM'), and the message bar names the new mode so the
 *  switch is visible even before the bar updates. */
function cycleCamera() {
  const i = CAMERA_MODES.indexOf(game.cameraMode);
  pickCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
}

nav.apBtn.addEventListener('click', () => {
  if (game.screen === 'play') setAutopilot(!game.autopilot);
});

/** Per-frame overlay updates shared by the live loop and the shot settle loop:
 *  PAPI lights + glide state for the destination field, and the nav panel
 *  when it is open. */
function updateOverlays() {
  const dest = game.mission ? game.mission.dest : AIRFIELDS.merapi;
  const glide = papiState(game.flight, dest);
  game._glide = glide;
  updatePapi(r.world.papi[dest.id], glide);
  nav.panel.style.display = game.navOpen ? 'block' : 'none';
  if (game.navOpen) updateNavPanel(nav, game.flight, game.mission, game.weather, game.autopilot);
}

game.newMission = function newMission(id, opts) {
  game.missionId = id;
  game.weather = weatherFor(id);
  return createMission(id, game.weather, opts);
};
game.setCameraMode = function setCameraMode(mode) { game.cameraMode = mode; };
game.setWeather = function setWeather(w) {
  game.weather = w;
  applyLighting(r, w.mode);
  r.rain.visible = !!w.rain;
};

function resetFlightForMission(id, opts) {
  game.flight = createFlightState();
  game.mission = game.newMission(id, opts);
  game.cameraMode = 'chase';
  game.setWeather(game.weather);
  applyLighting(r, game.weather.mode);
  r.rain.visible = !!game.weather.rain;
  // Gates follow this mission's route.
  updateRings(r.rings, game.mission.gates);
  // Start on the route's origin field (not always Merapi).
  const origin = game.mission.origin;
  if (origin.id !== 'merapi') {
    const fx = Math.sin(origin.heading), fz = Math.cos(origin.heading);
    game.flight.x = origin.x - fx * (origin.length / 2 - 30);
    game.flight.z = origin.z - fz * (origin.length / 2 - 30);
    game.flight.heading = origin.heading;
    game.flight.y = 8;
  }
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

function startMission(id, opts) {
  resetFlightForMission(id, opts);
  game.screen = 'briefing';
  showBriefing(game.mission, game.log);
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
  game.autopilot = false;
  game.navOpen = false;
  nav.panel.style.display = 'none';
  setApStatus(nav, false);
  game.setWeather({ mode: 'day', gustStrength: 0.15, windSpeed: 2, rain: false });
  applyLighting(r, 'day');
  showTitle(game.log);
}

function openLogbook() {
  game.screenBeforeLogbook = game.screen === 'logbook' ? 'title' : game.screen;
  game.screen = 'logbook';
  showLogbook(game.log);
}

function finishMissionScreen() {
  game.screen = 'results';
  setAutopilot(false);
  const m = game.mission;
  if (m.finished) {
    m.newBest = recordFlight(game.log, m);
  }
  showResults(m, game.log);
}

window.addEventListener('merapi:mission', (e) => startMission(e.detail));
window.addEventListener('merapi:fly', () => flyMission());
window.addEventListener('merapi:back', () => backToTitle());
window.addEventListener('merapi:logbook', () => openLogbook());

// --- Shot mode: deterministic staged scenes for screenshots ---
let shotReady = false;
if (SHOT) {
  game.screen = 'play';
  hideMenu();
  game.flight = createFlightState();
  stageShot(SHOT, game);
  updateRings(r.rings, game.mission.gates);
  // Colour the gates for the staged progress (done = green, next = amber).
  const shotProg = gateProgress(game.mission);
  setRingStates(r.rings, shotProg.next < shotProg.total ? shotProg.next : -1, shotProg.done);
  // Let the camera settle, then mark ready for the screenshot tool.
  let settle = 0;
  const settleLoop = () => {
    updateScene(r, game.flight, game.cameraMode, 1 / 60, 0);
    updatePanel(r, game.flight);
    updateOverlays();
    updateHud(hud, game.flight, game.mission, game.cameraMode, { log: game.log, dt: 1 / 60, instruments: true, autopilot: game.autopilot, glide: game._glide });
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

  // Menu keys work on every screen.
  if (input.consume('KeyH')) {
    game.hudVisible = !game.hudVisible;
    hud.root.style.display = game.hudVisible ? 'block' : 'none';
  }
  if (input.consume('KeyI')) game.instruments = !game.instruments;
  if (input.consume('KeyL')) {
    if (game.screen === 'logbook') backToTitle();
    else openLogbook();
  }
  if (game.screen === 'title') {
    if (input.consume('KeyB')) startMission(game.missionId || 'airmail');
    if (input.consume('KeyN')) startMission('rings', { free: true });
  }
  if (game.screen === 'briefing' && input.consume('Enter')) flyMission();
  if (game.screen === 'logbook' && (input.consume('Escape') || input.consume('KeyB'))) {
    if (game.screenBeforeLogbook === 'play' || game.screenBeforeLogbook === 'results') {
      game.screen = game.screenBeforeLogbook;
      hideMenu();
      if (game.screenBeforeLogbook === 'results') showResults(game.mission, game.log);
    } else backToTitle();
  }

  if (game.screen === 'play' && !game.paused) {
    input.poll();
    // v3: nav chart (N) and autopilot (A) in flight; Home/End trim, Delete resets trim.
    if (input.consume('KeyN')) toggleNav();
    if (input.consume('KeyA')) setAutopilot(!game.autopilot);
    const trimDelta = (input.consume('Home') ? 1 : 0) - (input.consume('End') ? 1 : 0);
    const trimReset = input.consume('Delete');
    let ctrl = {
      pitch: input.pitch, roll: input.roll, yaw: input.yaw,
      throttleDelta: input.throttleDelta, brake: input.brake,
      flapsToggle: input.consume('KeyF'),
      gearToggle: input.consume('KeyG'),
      trimDelta, trimReset,
    };
    // Autopilot flies the route; any stick input disconnects it, like a real AP.
    // But NOT the A key itself: A is both the roll-left key and the AP toggle,
    // so its own roll must not count as a manual override — otherwise the
    // toggle would disconnect the autopilot in the same frame it engaged.
    if (game.autopilot && game.mission && !game.mission.finished && !game.mission.failed) {
      const stick = input.keys.ArrowUp || input.keys.KeyW || input.keys.ArrowDown || input.keys.KeyS
        || input.keys.ArrowLeft || input.keys.ArrowRight || input.keys.KeyD
        || input.keys.KeyQ || input.keys.KeyE
        || Math.abs(input.lastMouseDX) > 2 || Math.abs(input.lastMouseDY) > 2;
      if (stick) {
        setAutopilot(false, 'AUTOPILOT OFF — manual control');
      } else {
        const ap = autopilotInput(game.flight, game.mission);
        ctrl.pitch = ap.pitch;
        ctrl.roll = ap.roll;
        ctrl.yaw = ap.yaw;
        ctrl.throttleDelta = ap.throttleDelta;
        ctrl.brake = ap.brake;
        if (ap.gearDown) game.flight.gearDown = true;
      }
    }
    if (input.consume('KeyC')) cycleCamera();
    if (input.consume('Digit1')) pickCamera('chase');
    if (input.consume('Digit2')) pickCamera('cockpit');
    if (input.consume('Digit3')) pickCamera('wingtip');
    if (input.consume('Digit4')) pickCamera('flyby');
    if (input.consume('KeyM')) audio.toggleMute();
    const events = stepFlight(game.flight, ctrl, dt, game.weather);
    stepMission(game.mission, game.flight, events, dt);
    audio.update(game.flight.throttle, game.flight.speed, game.flight.onGround);
    if (events.touchedDown) audio.thud();
    if (events.tookOff) audio.ring();
    if (game.mission && game.mission.step > 0 && game.mission.message.includes('Gate') && !game._rang) { audio.ring(); game._rang = true; }
    if (game.flight.stalled && now - stallAlarmAt > 1200) { audio.alarm(); stallAlarmAt = now; }
    // Autopilot off on landing, crash or mission end.
    if (game.autopilot && (game.mission.finished || game.mission.failed || (game.flight.onGround && game.flight.speed < 5))) {
      setAutopilot(false);
    }
    if (game.mission && (game.mission.finished || game.mission.failed)) finishMissionScreen();
    // Ring gate colours follow mission progress (bonus kinds use bonusStep).
    if (game.mission) {
      const prog = gateProgress(game.mission);
      setRingStates(r.rings, prog.next < prog.total ? prog.next : -1, prog.done);
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
    updateOverlays();
    updateHud(hud, game.flight, game.mission, game.cameraMode, { log: game.log, dt, instruments: game.instruments, autopilot: game.autopilot, glide: game._glide });
    r.renderer.render(r.scene, r.camera);
  }
}
requestAnimationFrame(loop);

// Expose a tiny debug handle for play-testing in the console.
window.__merapi = { game, WORLD, MISSIONS, medalFor, AIRFIELDS, nav, setAutopilot, toggleNav, renderer: r };
