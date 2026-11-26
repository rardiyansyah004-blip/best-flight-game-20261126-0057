// MERAPI AIRMAIL v4 — HUD: altitude/speed/heading, compass strip, minimap
// with named places, mission + route panel, approach guidance, ATC chatter,
// analog dials (turn / attitude / VSI), gate banner; plus title / briefing /
// results / logbook menus. The logbook shows career totals, recent flights
// and the best per route; while flying, the mission panel shows that
// route's best — the number to beat.
// v3 adds GeoFS material: a TRIM box and an AUTOPILOT box in the top row,
// and a GLIDE + PAPI row in the approach panel (the PAPI dots mirror the
// 3D lights beside the destination threshold).
// v4 (UI feel): the v3 numbers JUMPED every frame — alt/speed/heading were
// set raw from flight state, needles snapped, the compass strip ticked in
// 1-degree steps, and every banner appeared instantly. v4 eases all of it:
// displayed values glide toward the true values (frame-rate independent),
// the compass scrolls on the fractional heading, dial needles sweep, the
// gate banner pops, the message bar slides in, and ATC lines fade in.
// v4 perf note: no backdrop blur anywhere in the HUD — the blur halved the
// frame rate in software rendering, so the soft look comes from gradients,
// radii and shadows alone.
import { MISSIONS, MEDALS, AIRFIELDS, PLACES, WIND_FROM_DEG, feet, knots, formatTime, runwayHeadingDeg, windComponents } from './config.js';
import { distanceTo } from './flight.js';
import { gateProgress } from './missions.js';

/** ATC radio lines, written for this game (Indonesian-flavoured tower chatter). */
const ATC_LINES = {
  takeoff: [
    'MERAPI TOWER: PK-MAIL 7, runway 09 clear for takeoff, wind 250 at 8 knots. Selamat terbang!',
    'TRAFFIC: Garuda survey Cessna two miles east, 1,500 feet, keep visual.',
    'MERAPI TOWER: PK-MAIL 7, climb runway heading, report reaching 1,000 feet.',
  ],
  enroute: [
    'MERAPI TOWER: PK-MAIL 7, traffic is a red survey plane over Kali Village, no factor.',
    'PARANGTRITIS TOWER: PK-MAIL 7, coastal strip is clear, birds reported south of the field.',
    'TRAFFIC: Fisherman boat traffic below the bay — enjoy the view, PK-MAIL 7.',
    'MERAPI TOWER: PK-MAIL 7, Merapi is puffing smoke today, give the crater a wide berth.',
    'PARANGTRITIS TOWER: Wind 250 at 8, runway 04 in use. Terima kasih, PK-MAIL 7.',
  ],
  final: [
    'PARANGTRITIS TOWER: PK-MAIL 7, runway 04 clear to land, wind 250 at 8 knots.',
    'MERAPI TOWER: PK-MAIL 7, you are number one, runway 09 clear to land.',
    'PARANGTRITIS TOWER: PK-MAIL 7, check gear down, final approach looks good.',
  ],
  landed: [
    'PARANGTRITIS TOWER: PK-MAIL 7, welcome to Parangtritis! Mail bag received, terima kasih.',
    'MERAPI TOWER: PK-MAIL 7, welcome home. Nice landing — the mail is safe.',
  ],
};

/** Frame-rate independent easing factor: k is the ~63% convergence rate (per second). */
function easeFactor(dt, k) { return 1 - Math.exp(-k * dt); }

/** Ease an angle toward a target along the shortest arc (degrees). */
function easeAngle(cur, target, f) {
  let d = ((target - cur + 540) % 360) - 180;
  return (cur + d * f + 360) % 360;
}

export function buildHud() {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="hud-top">
      <div class="hud-box" id="hud-alt"><span class="hud-label">ALT</span><span class="hud-value" id="hud-alt-v">0 ft</span></div>
      <div class="hud-box" id="hud-spd"><span class="hud-label">SPEED</span><span class="hud-value" id="hud-spd-v">0 kt</span></div>
      <div class="hud-box" id="hud-hdg"><span class="hud-label">HEADING</span><span class="hud-value" id="hud-hdg-v">000°</span></div>
      <div class="hud-box"><span class="hud-label">THROTTLE</span><span class="hud-value" id="hud-thr-v">0%</span></div>
      <div class="hud-box"><span class="hud-label">FUEL</span><span class="hud-value" id="hud-fuel-v">100%</span></div>
      <div class="hud-box"><span class="hud-label" id="hud-wind-label">WIND 250°</span><span class="hud-value" id="hud-wind-v">8 kt</span></div>
      <div class="hud-box" style="min-width:64px"><span class="hud-label">TRIM</span><span class="hud-value" id="hud-trim-v" style="font-size:18px">+0.0</span></div>
      <div class="hud-box" style="min-width:64px"><span class="hud-label">AUTOPILOT</span><span class="hud-value" id="hud-ap-v" style="font-size:18px">OFF</span></div>
    </div>
    <div id="hud-compass"><canvas id="compass-canvas" width="640" height="34"></canvas></div>
    <div id="hud-mission">
      <div id="hud-mission-name">MERAPI AIRMAIL</div>
      <div id="hud-route"></div>
      <div id="hud-objective">—</div>
      <div id="hud-gate-line"></div>
      <div id="hud-timer">0:00</div>
      <div id="hud-score">SCORE 0</div>
      <div id="hud-best"></div>
    </div>
    <div id="hud-atc"><div id="hud-atc-title">📻 ATC — MERAPI TOWER 118.1</div><div id="hud-atc-lines"></div></div>
    <canvas id="minimap" width="180" height="180"></canvas>
    <div id="hud-approach">
      <div id="hud-approach-title">APPROACH</div>
      <div id="hud-approach-body"></div>
    </div>
    <div id="hud-gate"></div>
    <div id="hud-warnings"></div>
    <div id="hud-message"></div>
    <canvas id="dials" width="400" height="118"></canvas>
    <div id="hud-help">W/S pitch · A/D roll · Q/E rudder · SHIFT/CTRL throttle · F flaps · G gear · C camera · P pause · M mute · B mission · N nav · A autopilot · Home/End trim · L logbook · H hide UI · I instruments</div>
  `;
  return {
    root,
    alt: document.getElementById('hud-alt-v'),
    spd: document.getElementById('hud-spd-v'),
    hdg: document.getElementById('hud-hdg-v'),
    thr: document.getElementById('hud-thr-v'),
    fuel: document.getElementById('hud-fuel-v'),
    wind: document.getElementById('hud-wind-v'),
    windLabel: document.getElementById('hud-wind-label'),
    trim: document.getElementById('hud-trim-v'),
    ap: document.getElementById('hud-ap-v'),
    compass: document.getElementById('compass-canvas'),
    missionName: document.getElementById('hud-mission-name'),
    route: document.getElementById('hud-route'),
    objective: document.getElementById('hud-objective'),
    gateLine: document.getElementById('hud-gate-line'),
    timer: document.getElementById('hud-timer'),
    score: document.getElementById('hud-score'),
    best: document.getElementById('hud-best'),
    atc: document.getElementById('hud-atc'),
    atcLines: document.getElementById('hud-atc-lines'),
    minimap: document.getElementById('minimap'),
    approach: document.getElementById('hud-approach'),
    approachBody: document.getElementById('hud-approach-body'),
    gate: document.getElementById('hud-gate'),
    warnings: document.getElementById('hud-warnings'),
    message: document.getElementById('hud-message'),
    dials: document.getElementById('dials'),
    help: document.getElementById('hud-help'),
    atcTimer: 0, atcIdx: 0, atcShown: [],
    // v4: eased display state — what the player actually sees glides
    // toward the true values instead of snapping to them every frame.
    disp: { alt: 0, spd: 0, hdg: 0, thr: 0 },
    dial: { roll: 0, pitch: 0, vs: 0 },
    _lastMsg: '', _lastGate: '',
  };
}

/** Pick the ATC script for the current phase and rotate a line every 8 s.
 *  Final-approach and landed lines are filtered to the destination field,
 *  so the tower on the radio always matches the approach panel. */
function updateAtc(hud, mission, flight, dt) {
  if (!mission) return;
  hud.atcTimer += dt;
  if (hud.atcTimer < 8 && hud.atcShown.length) return;
  hud.atcTimer = 0;
  let pool = ATC_LINES.enroute;
  if (mission.finished) pool = ATC_LINES.landed;
  else if (!mission.started || (flight.onGround && mission.elapsed < 10)) pool = ATC_LINES.takeoff;
  else if (gateProgress(mission).next >= mission.gates.length - 1) pool = ATC_LINES.final;
  if (pool === ATC_LINES.final || pool === ATC_LINES.landed) {
    const tower = mission.dest.name.split(' ')[0].toUpperCase(); // MERAPI | PARANGTRITIS
    const matching = pool.filter((l) => l.startsWith(tower + ' TOWER'));
    if (matching.length) pool = matching;
  }
  const line = pool[hud.atcIdx % pool.length];
  hud.atcIdx += 1;
  hud.atcShown.push(line);
  if (hud.atcShown.length > 3) hud.atcShown.shift();
  hud.atcLines.innerHTML = hud.atcShown.map((l) => '<div class="atc-line">' + l + '</div>').join('');
}

/** PAPI dots as coloured spans (white = on/above, red = below). */
function papiDotsHtml(dots) {
  return dots.map((d) => '<span style="color:' + (d ? '#fff6d8' : '#ff2a1e') + '">●</span>').join('');
}

/** Re-trigger a CSS animation on an element (remove, reflow, re-add). */
function retriggerAnim(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Update the HUD from flight + mission state, once per frame.
 *  opts: { log, dt, instruments, cameraMode, autopilot, glide } */
export function updateHud(hud, flight, mission, cameraMode, opts) {
  const o = opts || {};
  const dt = o.dt || 0.016;
  // v4: ease the displayed numbers toward the true values, so the top row
  // glides instead of flickering a new integer every frame.
  const f = easeFactor(dt, 8);
  const d = hud.disp;
  d.alt += (feet(flight.y) - d.alt) * f;
  d.spd += (knots(flight.speed) - d.spd) * f;
  d.thr += (flight.throttle * 100 - d.thr) * f;
  const hdgDegTrue = ((flight.heading * 180 / Math.PI) % 360 + 360) % 360;
  d.hdg = easeAngle(d.hdg, hdgDegTrue, easeFactor(dt, 10));
  const hdgDeg = Math.round(d.hdg) % 360;
  hud.alt.textContent = Math.round(d.alt) + ' ft';
  hud.spd.textContent = Math.round(d.spd) + ' kt';
  hud.hdg.textContent = String(hdgDeg).padStart(3, '0') + '°';
  hud.thr.textContent = Math.round(d.thr) + '%';
  hud.fuel.textContent = Math.round(flight.fuel) + '%';
  hud.fuel.style.color = flight.fuel < 20 ? '#ff5a4e' : '';
  const windKt = Math.round((flight.wind || 2) * 1.94384);
  hud.windLabel.textContent = 'WIND ' + WIND_FROM_DEG + '°';
  hud.wind.textContent = windKt + ' kt';
  // Trim + autopilot (v3): trim shows the elevator trim setting, AP lights up green when engaged.
  hud.trim.textContent = (flight.trim >= 0 ? '+' : '') + flight.trim.toFixed(1);
  hud.ap.textContent = o.autopilot ? 'ON' : 'OFF';
  hud.ap.style.color = o.autopilot ? '#39ff88' : '';
  hud.missionName.textContent = mission ? mission.def.num + '. ' + mission.def.name.toUpperCase() + '  ·  ' + cameraMode.toUpperCase() + ' CAM' : 'MERAPI AIRMAIL';
  hud.objective.textContent = mission ? mission.objective : '';
  hud.timer.textContent = mission ? formatTime(mission.elapsed) : '0:00';
  hud.score.textContent = 'SCORE ' + (mission ? mission.score : 0);
  if (mission) {
    hud.route.textContent = mission.origin.short + ' → ' + mission.dest.short + '  ·  RWY ' + mission.dest.rwy;
    // Route best — the number to beat (from the logbook, or the staged value).
    const best = (o.log && o.log.routes && o.log.routes[mission.def.id]) || mission.routeBest;
    hud.best.textContent = best
      ? 'ROUTE BEST  ' + formatTime(best.time) + '  ·  ' + best.score + ' pts' + (best.landingScore ? '  ·  LAND ' + best.landingScore : '')
      : 'ROUTE BEST  — no flight logged yet';
    // Next gate: number + live distance (gateProgress handles bonus kinds).
    const prog = gateProgress(mission);
    const next = mission.gates[prog.next];
    if (next && !mission.finished) {
      const dist = Math.round(distanceTo(flight, next.x, next.y, next.z));
      hud.gateLine.textContent = 'NEXT GATE ' + (prog.next + 1) + '/' + prog.total + '  ·  ' + dist + ' m';
      const gateTxt = 'GATE ' + (prog.next + 1) + ' — ' + dist + ' m';
      if (gateTxt !== hud._lastGate) {
        hud._lastGate = gateTxt;
        hud.gate.textContent = gateTxt;
        retriggerAnim(hud.gate, 'pop');
      }
      hud.gate.style.display = 'block';
    } else {
      hud.gateLine.textContent = mission.finished ? 'ROUTE COMPLETE' : 'LAND AT ' + mission.dest.name.toUpperCase();
      hud.gate.style.display = 'none';
      hud._lastGate = '';
    }
    // Approach guidance: destination field, runway, distance, wind components,
    // plus the v3 glide-slope row (PAPI dots mirror the threshold lights).
    const dest = mission.dest;
    const distM = Math.round(Math.hypot(flight.x - dest.x, flight.z - dest.z));
    const rwyDeg = runwayHeadingDeg(dest);
    const wc = windComponents(rwyDeg, flight.wind || 2);
    const headTxt = wc.head >= 0 ? '+' + wc.head : String(wc.head);
    const glide = o.glide || { dots: [1, 1, 0, 0], label: '—' };
    const glideColor = glide.label === 'ON SLOPE' ? '#39ff88' : glide.label === '—' ? '#cfe3ee' : '#ffc233';
    hud.approachBody.innerHTML =
      '<div class="ap-row"><span>FIELD</span><b>' + dest.name + '</b></div>' +
      '<div class="ap-row"><span>RUNWAY</span><b>' + dest.rwy + ' · ' + String(rwyDeg).padStart(3, '0') + '°</b></div>' +
      '<div class="ap-row"><span>DISTANCE</span><b>' + (distM >= 1000 ? (distM / 1000).toFixed(1) + ' km' : distM + ' m') + '</b></div>' +
      '<div class="ap-row"><span>HEADWIND</span><b>' + headTxt + ' kt</b></div>' +
      '<div class="ap-row"><span>CROSSWIND</span><b>' + wc.cross + ' kt ' + wc.crossSide + '</b></div>' +
      '<div class="ap-row"><span>GLIDE</span><b style="color:' + glideColor + '">' + glide.label + '</b></div>' +
      '<div class="ap-row"><span>PAPI</span><b>' + papiDotsHtml(glide.dots) + '</b></div>';
  } else {
    hud.route.textContent = '';
    hud.best.textContent = '';
    hud.gateLine.textContent = '';
    hud.gate.style.display = 'none';
    hud.approachBody.innerHTML = '<div class="ap-row"><span>FIELD</span><b>Merapi Field</b></div><div class="ap-row"><span>RUNWAY</span><b>09</b></div>';
  }
  updateAtc(hud, mission, flight, dt);

  const warns = [];
  if (flight.stalled) warns.push('STALL');
  if (flight.spinning) warns.push('SPIN — LEVEL WINGS');
  if (flight.fuel < 20) warns.push('LOW FUEL');
  if (flight.damage > 0 && flight.damage < 100) warns.push('DAMAGE ' + Math.round(flight.damage) + '%');
  if (flight.y < 60 && !flight.onGround && flight.speed > 40) warns.push('TERRAIN');
  hud.warnings.textContent = warns.join('   ');
  hud.warnings.style.display = warns.length ? 'block' : 'none';
  if (mission && mission.message) {
    if (mission.message !== hud._lastMsg) {
      hud._lastMsg = mission.message;
      hud.message.textContent = mission.message;
      retriggerAnim(hud.message, 'slide');
    }
  }

  // Compass strip — v4: scroll on the FRACTIONAL heading so the ticks
  // glide instead of stepping 1 degree at a time.
  const ctx = hud.compass.getContext('2d');
  const W = hud.compass.width, H = hud.compass.height;
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(12,20,30,0.72)');
  grad.addColorStop(1, 'rgba(8,14,22,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const degF = d.hdg;
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  const stepDeg = 15;
  const start = Math.floor((degF - 60) / stepDeg) * stepDeg;
  for (let a = start; a <= degF + 60; a += stepDeg) {
    const an = ((a % 360) + 360) % 360;
    const x = W / 2 + (a - degF) * 4;
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[an];
    ctx.fillStyle = cardinal ? '#ffd34d' : '#cfe3ee';
    ctx.fillText(cardinal || String(an), x, 22);
    ctx.fillRect(x - 1, 26, 2, 6);
  }
  ctx.fillStyle = '#ff5a4e';
  ctx.beginPath(); ctx.moveTo(W / 2 - 6, 0); ctx.lineTo(W / 2 + 6, 0); ctx.lineTo(W / 2, 8); ctx.closePath(); ctx.fill();

  drawMinimap(hud.minimap, flight, mission);
  // Analog dials row (chase view only — the cockpit has its own 3D panel).
  const showDials = (o.instruments !== false) && cameraMode === 'chase';
  hud.dials.style.display = showDials ? 'block' : 'none';
  if (showDials) drawDials(hud.dials, flight, hud.dial, dt);
}

function drawMinimap(canvas, flight, mission) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.clearRect(0, 0, S, S);
  // Soft glass disc: radial gradient instead of one flat fill.
  const disc = ctx.createRadialGradient(S / 2, S / 2 - 12, 8, S / 2, S / 2, S / 2);
  disc.addColorStop(0, 'rgba(20,34,50,0.85)');
  disc.addColorStop(1, 'rgba(8,14,22,0.6)');
  ctx.fillStyle = disc;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.clip();
  const toMap = (x, z) => [S / 2 + (x / 2100) * (S / 2), S / 2 + (z / 2100) * (S / 2)];
  // Island blob (stylised), volcano, town.
  ctx.fillStyle = '#3d7a3a';
  ctx.beginPath(); ctx.ellipse(S / 2 + 8, S / 2 - 6, 62, 52, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a6a4a';
  ctx.beginPath(); ctx.arc(S / 2 + 30, S / 2 - 26, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8dcc8';
  ctx.fillRect(S / 2 - 26, S / 2 + 12, 10, 10);
  ctx.strokeStyle = '#f5f5f0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(S / 2 - 20, S / 2 + 34); ctx.lineTo(S / 2 - 20, S / 2 + 52); ctx.stroke();
  // Route gates (dim) + next gate (amber) + destination field (gold ring).
  if (mission) {
    const prog = gateProgress(mission);
    mission.gates.forEach((g, i) => {
      const [gx, gz] = toMap(g.x, g.z);
      ctx.fillStyle = i === prog.next ? '#ffc233' : g.done ? '#39ff88' : 'rgba(255,255,255,0.45)';
      ctx.beginPath(); ctx.arc(gx, gz, i === prog.next ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
    });
    const [dx, dz] = toMap(mission.dest.x, mission.dest.z);
    ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dx, dz, 8, 0, Math.PI * 2); ctx.stroke();
  }
  // Named places: labels anchor inward so they never clip at the circle edge.
  ctx.font = 'bold 9px monospace';
  for (const p of PLACES) {
    const [px, pz] = toMap(p.x, p.z);
    ctx.fillStyle = p.kind === 'field' ? '#ffd34d' : '#cfe3ee';
    if (px > S / 2) {
      ctx.textAlign = 'right';
      ctx.fillText(p.name.toUpperCase(), Math.max(px - 4, 8), Math.max(Math.min(pz - 4, S - 8), 10));
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(p.name.toUpperCase(), Math.min(px + 4, S - 62), Math.max(Math.min(pz - 4, S - 8), 10));
    }
  }
  // Plane marker with a soft heading wedge.
  const px = S / 2 + (flight.x / 2100) * (S / 2);
  const pz = S / 2 + (flight.z / 2100) * (S / 2);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(flight.heading);
  ctx.fillStyle = 'rgba(255, 211, 77, 0.18)';
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(9, 8); ctx.lineTo(-9, 8); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
  // Outer ring glow.
  ctx.strokeStyle = 'rgba(255, 211, 77, 0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.stroke();
}

/** Analog dials row: turn coordinator, attitude indicator, VSI.
 *  v4: needles ease toward the true values (smoothed state in `sm`),
 *  and the faces get a glassy radial gradient + highlight instead of
 *  one flat dark disc. */
function drawDials(canvas, flight, sm, dt) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  // Panel: soft vertical gradient + gold hairline, rounded 14px.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, 'rgba(16,26,40,0.85)');
  bg.addColorStop(1, 'rgba(8,14,22,0.78)');
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.roundRect(0, 0, W, H, 14); ctx.fill();
  ctx.strokeStyle = 'rgba(255,211,77,0.55)'; ctx.lineWidth = 1;
  ctx.stroke();
  const f = easeFactor(dt || 0.016, 10);
  sm.roll += (flight.roll - sm.roll) * f;
  sm.pitch += (flight.pitch - sm.pitch) * f;
  sm.vs += ((flight.verticalSpeed || 0) - sm.vs) * f;
  const cy = H / 2 + 6, r = 40;
  // --- Turn coordinator: bank needle + slip ball ---
  dialFace(ctx, 66, cy, r, 'TURN');
  ctx.save();
  ctx.translate(66, cy);
  ctx.rotate(-sm.roll * 0.8);
  ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -(r - 10)); ctx.stroke();
  ctx.restore();
  const slip = Math.max(-1, Math.min(1, Math.sin(sm.roll) * 2));
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(66 + slip * (r - 12), cy + r - 12, 5, 0, Math.PI * 2); ctx.fill();
  // --- Attitude indicator: horizon ball ---
  dialFace(ctx, 200, cy, r, 'ATTITUDE');
  ctx.save();
  ctx.beginPath(); ctx.arc(200, cy, r - 4, 0, Math.PI * 2); ctx.clip();
  ctx.translate(200, cy);
  ctx.rotate(-sm.roll);
  ctx.translate(0, sm.pitch * 70);
  ctx.fillStyle = '#3f7fd0'; ctx.fillRect(-r, -r * 2, r * 2, r * 2);
  ctx.fillStyle = '#7a5a34'; ctx.fillRect(-r, 0, r * 2, r * 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(-r, -2, r * 2, 4);
  ctx.restore();
  ctx.fillStyle = '#ffb347';
  ctx.beginPath(); ctx.moveTo(200 - 20, cy); ctx.lineTo(200 + 20, cy); ctx.lineTo(200, cy + 9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(200, cy, r - 4, 0, Math.PI * 2);
  ctx.strokeStyle = '#e8d9a8'; ctx.lineWidth = 3; ctx.stroke();
  // --- VSI: vertical speed needle + value kept inside the dial face ---
  dialFace(ctx, 334, cy, r, 'VSI');
  const vsFrac = Math.max(-1, Math.min(1, sm.vs / 10));
  const va = Math.PI * 0.75 + ((vsFrac + 1) / 2) * Math.PI * 1.5;
  ctx.save();
  ctx.translate(334, cy);
  ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(va) * (r - 10), Math.sin(va) * (r - 10)); ctx.stroke();
  ctx.fillStyle = '#e8f2f8'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText((sm.vs >= 0 ? '+' : '') + sm.vs.toFixed(1), 0, r - 16);
  ctx.restore();
}

function dialFace(ctx, cx, cy, r, label) {
  // Glass face: radial gradient, lighter at the top, plus a soft highlight.
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#232e3d');
  g.addColorStop(0.7, '#12181f');
  g.addColorStop(1, '#0a0e13');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = '#e8d9a8'; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r - 6, Math.PI * 1.15, Math.PI * 1.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 5; ctx.stroke();
  ctx.fillStyle = '#e8f2f8'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy - r + 14);
}

// ---------------------------------------------------------------------------
// Menus (DOM overlays above the canvas).
// ---------------------------------------------------------------------------
export function showTitle(log) {
  const menu = document.getElementById('menu');
  const rows = MISSIONS.map((m) => {
    const best = log.routes && log.routes[m.id];
    const medal = best && best.medal !== 'none' ? '<span style="color:' + (MEDALS[best.medal] || '#888') + '">● ' + best.medal.toUpperCase() + '</span>' : '<span style="color:#888">—</span>';
    const time = best ? formatTime(best.time) : '';
    const route = AIRFIELDS[m.route.origin].short + ' → ' + AIRFIELDS[m.route.dest].short;
    return `<button class="mission-btn" data-mission="${m.id}">
      <span class="m-num">${m.num}</span>
      <span class="m-name">${m.name}<br><span style="font-size:12px;color:#ffd34d">${route} · ${m.route.gates} GATES</span></span>
      <span class="m-par">${m.par}</span>
      <span class="m-best">${medal} ${time}</span>
    </button>`;
  }).join('');
  const career = log.career || { flights: 0, landings: 0, totalScore: 0, bestLanding: 0 };
  menu.innerHTML = `
    <div class="panel">
      <h1>MERAPI AIRMAIL</h1>
      <p class="subtitle">A 3D island flight game — 8 airmail routes over a living volcano island</p>
      <p class="tagline">Fly the mail. Mind the mountain. Grease the landing.</p>
      <p class="medals">LOGBOOK: ${career.flights} FLIGHTS · ${career.landings} LANDINGS · ${career.totalScore} PTS · BEST LANDING ${career.bestLanding}/100</p>
      <div class="missions">${rows}</div>
      <p class="howto"><b>B</b> new mission · <b>N</b> free gate course · <b>L</b> logbook · <b>H</b> hide UI · <b>I</b> instruments · <b>C</b> camera<br>
      W/S pitch · A/D roll · Q/E rudder · SHIFT/CTRL throttle · F flaps · G gear · P pause · M mute<br>
      Every route flies origin → numbered gates → destination field. Landings are scored; the logbook keeps your best per route.<br>
      In flight: <b>N</b> nav chart · <b>A</b> autopilot · <b>Home/End</b> elevator trim · PAPI lights guide the glide slope.</p>
      <button class="big-btn secondary" id="logbook-btn">LOGBOOK (L)</button>
    </div>`;
  menu.style.display = 'flex';
  menu.querySelectorAll('.mission-btn').forEach((b) => {
    b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:mission', { detail: b.dataset.mission })));
  });
  document.getElementById('logbook-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:logbook')));
}

export function showBriefing(mission, log) {
  const menu = document.getElementById('menu');
  const best = log && log.routes ? log.routes[mission.def.id] : null;
  menu.innerHTML = `
    <div class="panel">
      <h2>MISSION ${mission.def.num} — ${mission.def.name.toUpperCase()}</h2>
      <p class="route-line">${mission.origin.name} → ${mission.dest.name} &nbsp;·&nbsp; ${mission.gates.length} GATES &nbsp;·&nbsp; LAND RWY ${mission.dest.rwy}</p>
      <p class="brief">${mission.def.brief}</p>
      <p class="medals">GOLD ${formatTime(mission.def.gold)} &nbsp;·&nbsp; SILVER ${formatTime(mission.def.silver)} &nbsp;·&nbsp; BRONZE ${formatTime(mission.def.bronze)}</p>
      <p class="medals">${best ? 'ROUTE BEST: ' + formatTime(best.time) + ' · ' + best.score + ' PTS' + (best.landingScore ? ' · LAND ' + best.landingScore + '/100' : '') : 'ROUTE BEST: — no flight logged yet. Set the mark!'}</p>
      <button class="big-btn" id="fly-btn">FLY THIS ROUTE</button>
      <button class="big-btn secondary" id="back-btn">BACK TO ROUTES</button>
    </div>`;
  menu.style.display = 'flex';
  document.getElementById('fly-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:fly')));
  document.getElementById('back-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:back')));
}

export function showResults(mission, log) {
  const menu = document.getElementById('menu');
  const ok = mission.finished;
  const medal = ok ? mission.medal : 'none';
  const L = mission.landing;
  const gatesDone = mission.gates.filter((g) => g.done).length;
  const debrief = ok && L ? `
    <div class="debrief">
      <h3>🛬 LANDING DEBRIEF — ${L.field.toUpperCase()}</h3>
      <div class="debrief-grid">
        <div><span>TOUCHDOWN VS</span><b>${L.vs.toFixed(1)} m/s</b></div>
        <div><span>CENTRELINE</span><b>${L.centreline >= 900 ? 'off-field' : L.centreline.toFixed(0) + ' m'}</b></div>
        <div><span>APPROACH SPEED</span><b>${Math.round(L.speed * 1.94384)} kt</b></div>
        <div><span>ON RUNWAY</span><b>${L.onRunway ? 'YES' : 'NO'}</b></div>
      </div>
      <p class="landing-score">LANDING ${L.grade} — ${L.score}/100</p>
    </div>` : '';
  const best = log.routes && log.routes[mission.def.id];
  menu.innerHTML = `
    <div class="panel">
      <h2>${ok ? 'ROUTE COMPLETE' : 'MISSION FAILED'}</h2>
      <p class="brief">${ok ? mission.message : mission.failedReason}</p>
      ${debrief}
      <div class="debrief">
        <h3>📋 MISSION RESULT — ${mission.origin.short} → ${mission.dest.short}</h3>
        <p class="medals">TIME ${formatTime(mission.elapsed)} &nbsp;·&nbsp; GATES ${gatesDone}/${mission.gates.length} &nbsp;·&nbsp; SCORE ${mission.score} &nbsp;·&nbsp; ${ok ? 'MEDAL: ' + medal.toUpperCase() : 'NO MEDAL'}</p>
        <p class="medals">${mission.newBest ? '★ NEW ROUTE BEST! ★' : best ? 'ROUTE BEST: ' + formatTime(best.time) + ' · ' + best.score + ' PTS' : ''}</p>
      </div>
      <button class="big-btn" id="again-btn">FLY AGAIN</button>
      <button class="big-btn secondary" id="menu-btn">ROUTE SELECT</button>
      <button class="big-btn secondary" id="log-btn">LOGBOOK (L)</button>
    </div>`;
  menu.style.display = 'flex';
  document.getElementById('again-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:mission', { detail: mission.def.id })));
  document.getElementById('menu-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:back')));
  document.getElementById('log-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:logbook')));
}

export function showLogbook(log) {
  const menu = document.getElementById('menu');
  const c = log.career || { flights: 0, landings: 0, totalTime: 0, totalScore: 0, bestLanding: 0 };
  const routeRows = MISSIONS.map((m) => {
    const b = log.routes && log.routes[m.id];
    return `<tr><td>${m.num}. ${m.name}</td><td>${AIRFIELDS[m.route.origin].short} → ${AIRFIELDS[m.route.dest].short}</td><td>${b ? formatTime(b.time) : '—'}</td><td>${b ? b.score : '—'}</td><td>${b && b.medal !== 'none' ? b.medal.toUpperCase() : '—'}</td><td>${b && b.landingScore ? b.landingScore + '/100' : '—'}</td></tr>`;
  }).join('');
  const recentRows = (log.recent || []).map((f) => (
    `<tr><td>${f.date}</td><td>${f.route}</td><td>${f.from} → ${f.to}</td><td>${formatTime(f.time)}</td><td>${f.score}</td><td>${f.landingScore ? f.landingScore + '/100' : '—'}</td></tr>`
  )).join('') || '<tr><td colspan="6">No flights logged yet — fly a route!</td></tr>';
  menu.innerHTML = `
    <div class="panel">
      <h2>📖 PILOT LOGBOOK</h2>
      <p class="medals">CAREER: ${c.flights} FLIGHTS · ${c.landings} LANDINGS · ${formatTime(c.totalTime)} FLOWN · ${c.totalScore} PTS · BEST LANDING ${c.bestLanding}/100</p>
      <h3 style="color:#ffd34d;text-align:left">BEST PER ROUTE</h3>
      <table class="log-table"><tr><th>Route</th><th>From → To</th><th>Best time</th><th>Score</th><th>Medal</th><th>Landing</th></tr>${routeRows}</table>
      <h3 style="color:#ffd34d;text-align:left">RECENT FLIGHTS</h3>
      <table class="log-table"><tr><th>Date</th><th>Route</th><th>From → To</th><th>Time</th><th>Score</th><th>Landing</th></tr>${recentRows}</table>
      <button class="big-btn" id="log-back-btn">BACK</button>
    </div>`;
  menu.style.display = 'flex';
  document.getElementById('log-back-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:back')));
}

export function hideMenu() {
  document.getElementById('menu').style.display = 'none';
}
