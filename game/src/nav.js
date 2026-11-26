// MERAPI AIRMAIL v4 — navigation panel + autopilot, in the spirit of GeoFS.
// GeoFS's signature flow is its nav panel (N): a live chart with runways and
// navaids plus an autopilot (A) that holds heading and altitude. This module
// is the same idea rebuilt for our island, from static files only: the chart
// is drawn in code, the METAR line is generated from the mission weather,
// and the autopilot steers the real flight model toward the next gate.
// No GeoFS code, assets, names or text are used here.
// v4 (UI feel): the v3 drawer was a hard-edged flat dark box with a 1px
// border and no motion — it appeared instantly and looked pasted on. v4
// gives it a gradient + soft shadow + 16px radius, a slide/fade-in on every
// open (CSS animations re-run when the panel flips from display:none to
// block), button press/hover states, and a polished chart (the island is a
// radial gradient now, the plane marker glows). Same data, same layout,
// same buttons — the drawer just lands softer.
// v4 perf note: the drawer uses a gradient + shadow, NOT backdrop blur —
// the blur halved the frame rate in software rendering, so it stays out.
import { AIRFIELDS, PLACES, WIND_FROM_DEG, clamp, wrapAngle } from './config.js';
import { gateProgress } from './missions.js';

/** METAR-style weather report, generated from the mission weather. */
export function metarFor(weather, fieldName) {
  const w = weather || { mode: 'day', windSpeed: 2, gustStrength: 0.15, rain: false };
  const kt = Math.round((w.windSpeed || 2) * 1.94384);
  const gust = Math.round((w.gustStrength || 0) * 12);
  const vis = w.mode === 'storm' ? '3SM' : w.mode === 'night' ? '6SM' : '10SM';
  const clouds = w.mode === 'storm' ? 'BKN015 OVC030' : w.mode === 'night' ? 'CLR' : w.mode === 'golden' ? 'FEW030 SCT060' : 'FEW030';
  const temp = w.mode === 'storm' ? '24/21' : w.mode === 'night' ? '25/22' : '28/19';
  const wx = w.rain ? ' +RA' : '';
  const field = (fieldName || 'MERAPI').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'MERAPI';
  return 'METAR ' + field + ' 261200Z AUTO ' + String(WIND_FROM_DEG).padStart(3, '0') + String(kt).padStart(2, '0')
    + (gust > 3 ? 'G' + String(gust).padStart(2, '0') : '') + 'KT ' + vis + wx + ' ' + clouds + ' ' + temp + ' Q1013';
}

/** Build the NAV drawer (right side, below the approach panel) and return its parts. */
export function buildNavPanel() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes navIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    #nav-panel { position: absolute; right: 14px; top: 388px; width: 300px;
      background: linear-gradient(160deg, rgba(10,16,24,0.93), rgba(8,12,20,0.84));
      border: 1px solid rgba(255, 211, 77, 0.55);
      border-radius: 16px; padding: 10px 12px; pointer-events: auto; display: none; z-index: 6;
      box-shadow: 0 14px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.09);
       animation: navIn 0.25s ease-out; }
    #nav-panel-title { font-size: 11px; letter-spacing: 2px; color: #ffd34d; font-weight: 800; margin-bottom: 6px; }
    #nav-chart { display: block; border-radius: 10px; border: 1px solid rgba(255,255,255,0.25); background: #0c1a26; }
    #nav-metar { font-family: monospace; font-size: 11px; color: #9fc3d8; margin-top: 6px; line-height: 1.5; word-break: break-word; }
    #nav-ap-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
    #nav-ap-status { font-family: monospace; font-size: 13px; font-weight: 800; color: #cfe3ee; }
    #nav-ap-status.on { color: #39ff88; }
    #nav-ap-btn { background: #ffd34d; color: #1a1405; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 800; padding: 6px 14px; cursor: pointer; letter-spacing: 1px;
      transition: transform 0.15s ease, filter 0.15s ease; }
    #nav-ap-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
    #nav-ap-btn:active { transform: scale(0.96); }
    #nav-hint { font-size: 11px; color: rgba(238, 244, 248, 0.7); margin-top: 6px; }`;
  document.head.appendChild(style);
  const root = document.getElementById('hud');
  const panel = document.createElement('div');
  panel.id = 'nav-panel';
  panel.innerHTML = `
    <div id="nav-panel-title">NAV — ISLAND CHART</div>
    <canvas id="nav-chart" width="276" height="170"></canvas>
    <div id="nav-metar"></div>
    <div id="nav-ap-row">
      <span id="nav-ap-status">AUTOPILOT OFF</span>
      <button id="nav-ap-btn">AP: OFF</button>
    </div>
    <div id="nav-hint">N close · A autopilot · stick input disconnects AP</div>`;
  root.appendChild(panel);
  return {
    panel,
    chart: panel.querySelector('#nav-chart'),
    metar: panel.querySelector('#nav-metar'),
    apStatus: panel.querySelector('#nav-ap-status'),
    apBtn: panel.querySelector('#nav-ap-btn'),
  };
}

/** Draw the island chart: terrain, fields, gates, plane, wind. */
export function drawNavChart(canvas, flight, mission) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1a26';
  ctx.fillRect(0, 0, W, H);
  // Range rings around the island centre (500 m / 1000 m / 1500 m).
  const toChart = (x, z) => [W / 2 + (x / 2100) * (W / 2 - 8), H / 2 + (z / 2100) * (H / 2 - 8)];
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  for (const r of [500, 1000, 1500]) {
    const px = (r / 2100) * (W / 2 - 8);
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, px, px * (H / W), 0, 0, Math.PI * 2); ctx.stroke();
  }
  // Island blob: radial gradient, bright heart fading to deep green at the coast.
  const islandGrad = ctx.createRadialGradient(W / 2 + 4, H / 2 - 3, 20, W / 2 + 4, H / 2 - 3, 110);
  islandGrad.addColorStop(0, '#5da14a');
  islandGrad.addColorStop(0.7, '#3d7a3a');
  islandGrad.addColorStop(1, '#2a5a2e');
  ctx.fillStyle = islandGrad;
  ctx.beginPath(); ctx.ellipse(W / 2 + 4, H / 2 - 3, 96, 72, 0.3, 0, Math.PI * 2); ctx.fill();
  const [vx, vz] = toChart(620, -540);
  ctx.fillStyle = '#8a6a4a';
  ctx.beginPath(); ctx.arc(vx, vz, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8dcc8';
  const [tx0, tz0] = toChart(-420, 380);
  ctx.fillRect(tx0 - 5, tz0 - 5, 10, 10);
  // Runway strips (rotated dark bars with a white centreline).
  for (const f of Object.values(AIRFIELDS)) {
    const [fx, fz] = toChart(f.x, f.z);
    ctx.save();
    ctx.translate(fx, fz);
    ctx.rotate(f.heading);
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(-14, -3, 28, 6);
    ctx.fillStyle = '#f5f5f0';
    ctx.fillRect(-14, -0.5, 28, 1);
    ctx.restore();
    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 9px monospace';
    // Flip the label inside the chart when it would clip past the right edge.
    const labelW = Math.max(ctx.measureText(f.short).width, ctx.measureText('RWY ' + f.rwy).width);
    const flip = fx + 12 + labelW > W - 4;
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(f.short, flip ? fx - 12 : fx + 12, fz - 6);
    ctx.fillStyle = '#cfe3ee';
    ctx.font = '9px monospace';
    ctx.fillText('RWY ' + f.rwy, flip ? fx - 12 : fx + 12, fz + 6);
  }
  // Route gates (numbered): done green, next amber, later dim.
  if (mission) {
    const prog = gateProgress(mission);
    mission.gates.forEach((g, i) => {
      const [gx, gz] = toChart(g.x, g.z);
      ctx.fillStyle = i < prog.done ? '#39ff88' : i === prog.next ? '#ffc233' : 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(gx, gz, i === prog.next ? 7 : 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a1018';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), gx, gz + 3);
    });
    const [dx, dz] = toChart(mission.dest.x, mission.dest.z);
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dx, dz, 11, 0, Math.PI * 2); ctx.stroke();
  }
  // Named places.
  ctx.font = '8px monospace';
  ctx.fillStyle = '#9fc3d8';
  ctx.textAlign = 'left';
  for (const p of PLACES) {
    if (p.kind === 'field') continue;
    const [px, pz] = toChart(p.x, p.z);
    ctx.fillText(p.name.toUpperCase(), px + 4, pz - 4);
  }
  // Plane marker + heading wedge: gold with a soft glow so it reads at a glance.
  const [px, pz] = toChart(flight.x, flight.z);
  ctx.save();
  ctx.shadowColor = '#ffd34d';
  ctx.shadowBlur = 12;
  ctx.translate(px, pz);
  ctx.rotate(flight.heading);
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Wind arrow (points where the wind blows TO: from 250 deg).
  const wx = W - 26, wy = 18;
  const windTo = (WIND_FROM_DEG + 180) * Math.PI / 180;
  ctx.strokeStyle = '#9fc3d8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(wx, wy);
  ctx.lineTo(wx + Math.sin(windTo) * 12, wy + Math.cos(windTo) * 12); ctx.stroke();
  ctx.fillStyle = '#9fc3d8';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WIND ' + WIND_FROM_DEG + '°', W - 30, H - 8);
  // North arrow.
  ctx.fillStyle = '#ffd34d';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('N ↑', 12, 14);
}

/** Steer the real flight model toward the next gate — or, when the gates are
 *  done, down the 3-degree glide path to the destination runway. Returns
 *  { pitch, roll, yaw, throttleDelta, brake, gearDown }.
 *  Final approach aims at a touchdown point 100 m past the threshold.
 *  The pitch on final is a glide-path controller, not a proportional
 *  altitude chase: beyond 200 m it descends at the slope rate plus 8% of
 *  the altitude error per second (feed-forward, so the error converges
 *  instead of settling ~23 m above the slope the way a 0.005/m gain did —
 *  that version crossed the threshold at 30 m, floated past the touchdown
 *  point on its fixed 1.5-degree flare, and touched down 38 m past the
 *  runway end, 87 m off the centreline; v3 play test 4). Inside 200 m it
 *  descends to arrive at the runway (y = 6) exactly at the touchdown
 *  point, so the rate falls as the plane nears the ground — the flare,
 *  timed by distance instead of a fixed shallow angle. After touchdown
 *  the autopilot idles the throttle and brakes to a stop, which is what
 *  the mission's landing check (onGround + speed < 5 on the runway) needs. */
export function autopilotInput(flight, mission) {
  if (flight.onGround) {
    return { pitch: 0, roll: 0, yaw: 0, throttleDelta: -1, brake: true, gearDown: true };
  }
  const prog = gateProgress(mission);
  const next = mission.gates[prog.next];
  let tx, tz, speedLo, speedHi, final = false;
  let pitch;
  if (next) {
    tx = next.x; tz = next.z;
    speedLo = 58; speedHi = 66;
    pitch = clamp((next.y - flight.y) * 0.005, -0.35, 0.35);
  } else {
    final = true;
    const d = mission.dest;
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
    tx = d.x + fx * (-d.length / 2 + 100);
    tz = d.z + fz * (-d.length / 2 + 100);
    const dist = Math.hypot(flight.x - tx, flight.z - tz);
    speedLo = 52; speedHi = 58;
    const slopeTan = Math.tan((3 * Math.PI) / 180);
    const slopeRate = flight.speed * slopeTan;
    let descent;
    if (dist > 200) {
      const targetAlt = 6 + dist * slopeTan;
      descent = slopeRate + 0.08 * (flight.y - targetAlt);
    } else {
      const timeToTd = Math.max(dist / Math.max(flight.speed, 20), 0.5);
      descent = (flight.y - 6) / timeToTd;
    }
    descent = clamp(descent, 0.5, 6);
    // The flight model multiplies the pitch input by 0.45 to get the pitch
    // angle, and the descent rate is speed * sin(pitch angle).
    pitch = clamp(-Math.atan2(descent, Math.max(flight.speed, 20)) / 0.45, -0.35, 0.35);
  }
  const dx = tx - flight.x, dz = tz - flight.z;
  const want = Math.atan2(dx, dz);
  const dh = wrapAngle(want - flight.heading);
  const roll = clamp(dh * 1.4, -0.55, 0.55);
  const throttleDelta = flight.speed < speedLo ? 1 : flight.speed > speedHi ? -1 : 0;
  return { pitch, roll, yaw: 0, throttleDelta, brake: false, gearDown: final };
}

/** Update the AP status line + button for the current autopilot state. */
export function setApStatus(nav, on) {
  nav.apStatus.textContent = on ? 'AUTOPILOT ON' : 'AUTOPILOT OFF';
  nav.apStatus.classList.toggle('on', on);
  nav.apBtn.textContent = on ? 'AP: ON' : 'AP: OFF';
}

/** Update the whole nav panel from live state (called once per frame while open). */
export function updateNavPanel(nav, flight, mission, weather, autopilot) {
  drawNavChart(nav.chart, flight, mission);
  nav.metar.textContent = metarFor(weather, mission ? mission.dest.name : 'Merapi Field');
  setApStatus(nav, autopilot);
}
