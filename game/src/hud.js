// MERAPI AIRMAIL — HUD: altitude/speed/heading, compass strip, minimap,
// mission objective + timer, warnings; plus title / briefing / results menus.
import { MISSIONS, MEDALS, feet, knots, formatTime } from './config.js';

export function buildHud() {
  const root = document.getElementById('hud');
  root.innerHTML = `
    <div id="hud-top">
      <div class="hud-box" id="hud-alt"><span class="hud-label">ALT</span><span class="hud-value" id="hud-alt-v">0 ft</span></div>
      <div class="hud-box" id="hud-spd"><span class="hud-label">SPEED</span><span class="hud-value" id="hud-spd-v">0 kt</span></div>
      <div class="hud-box" id="hud-hdg"><span class="hud-label">HEADING</span><span class="hud-value" id="hud-hdg-v">000°</span></div>
      <div class="hud-box"><span class="hud-label">THROTTLE</span><span class="hud-value" id="hud-thr-v">0%</span></div>
      <div class="hud-box"><span class="hud-label">FUEL</span><span class="hud-value" id="hud-fuel-v">100%</span></div>
    </div>
    <div id="hud-compass"><canvas id="compass-canvas" width="640" height="34"></canvas></div>
    <div id="hud-mission">
      <div id="hud-mission-name">MERAPI AIRMAIL</div>
      <div id="hud-objective">—</div>
      <div id="hud-timer">0:00</div>
      <div id="hud-score">SCORE 0</div>
    </div>
    <canvas id="minimap" width="180" height="180"></canvas>
    <div id="hud-warnings"></div>
    <div id="hud-message"></div>
    <div id="hud-help">W/S pitch · A/D roll · Q/E rudder · SHIFT throttle up · CTRL throttle down · F flaps · G gear · C camera · P pause · M mute</div>
  `;
  return {
    root,
    alt: document.getElementById('hud-alt-v'),
    spd: document.getElementById('hud-spd-v'),
    hdg: document.getElementById('hud-hdg-v'),
    thr: document.getElementById('hud-thr-v'),
    fuel: document.getElementById('hud-fuel-v'),
    compass: document.getElementById('compass-canvas'),
    missionName: document.getElementById('hud-mission-name'),
    objective: document.getElementById('hud-objective'),
    timer: document.getElementById('hud-timer'),
    score: document.getElementById('hud-score'),
    minimap: document.getElementById('minimap'),
    warnings: document.getElementById('hud-warnings'),
    message: document.getElementById('hud-message'),
  };
}

/** Update the HUD from flight + mission state, once per frame. */
export function updateHud(hud, flight, mission, cameraMode) {
  hud.alt.textContent = feet(flight.y) + ' ft';
  hud.spd.textContent = knots(flight.speed) + ' kt';
  const hdgDeg = Math.round(((flight.heading * 180 / Math.PI) % 360 + 360) % 360);
  hud.hdg.textContent = String(hdgDeg).padStart(3, '0') + '°';
  hud.thr.textContent = Math.round(flight.throttle * 100) + '%';
  hud.fuel.textContent = Math.round(flight.fuel) + '%';
  hud.fuel.style.color = flight.fuel < 20 ? '#ff5a4e' : '';
  hud.missionName.textContent = mission ? mission.def.num + '. ' + mission.def.name.toUpperCase() + '  ·  ' + cameraMode.toUpperCase() + ' CAM' : 'MERAPI AIRMAIL';
  hud.objective.textContent = mission ? mission.objective : '';
  hud.timer.textContent = mission ? formatTime(mission.elapsed) : '0:00';
  hud.score.textContent = 'SCORE ' + (mission ? mission.score : 0);
  const warns = [];
  if (flight.stalled) warns.push('STALL');
  if (flight.spinning) warns.push('SPIN — LEVEL WINGS');
  if (flight.fuel < 20) warns.push('LOW FUEL');
  if (flight.damage > 0 && flight.damage < 100) warns.push('DAMAGE ' + Math.round(flight.damage) + '%');
  if (flight.y < 60 && !flight.onGround && flight.speed > 40) warns.push('TERRAIN');
  hud.warnings.textContent = warns.join('   ');
  hud.warnings.style.display = warns.length ? 'block' : 'none';
  if (mission && mission.message) hud.message.textContent = mission.message;

  // Compass strip.
  const ctx = hud.compass.getContext('2d');
  const W = hud.compass.width, H = hud.compass.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10,16,24,0.55)';
  ctx.fillRect(0, 0, W, H);
  const deg = hdgDeg;
  ctx.font = 'bold 15px monospace';
  ctx.textAlign = 'center';
  for (let d = -60; d <= 60; d += 15) {
    const a = (deg + d + 360) % 360;
    const x = W / 2 + d * 4;
    const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a];
    ctx.fillStyle = cardinal ? '#ffd34d' : '#cfe3ee';
    ctx.fillText(cardinal || String(a), x, 22);
    ctx.fillRect(x - 1, 26, 2, 6);
  }
  ctx.fillStyle = '#ff5a4e';
  ctx.beginPath(); ctx.moveTo(W / 2 - 6, 0); ctx.lineTo(W / 2 + 6, 0); ctx.lineTo(W / 2, 8); ctx.closePath(); ctx.fill();

  drawMinimap(hud.minimap, flight);
}

function drawMinimap(canvas, flight) {
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = 'rgba(10,16,24,0.55)';
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.clip();
  // Island blob (stylised), runway, town.
  ctx.fillStyle = '#3d7a3a';
  ctx.beginPath(); ctx.ellipse(S / 2 + 8, S / 2 - 6, 62, 52, 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a6a4a';
  ctx.beginPath(); ctx.arc(S / 2 + 30, S / 2 - 26, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8dcc8';
  ctx.fillRect(S / 2 - 26, S / 2 + 12, 10, 10);
  ctx.strokeStyle = '#f5f5f0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(S / 2 - 20, S / 2 + 34); ctx.lineTo(S / 2 - 20, S / 2 + 52); ctx.stroke();
  // Plane marker.
  const px = S / 2 + (flight.x / 2100) * (S / 2);
  const pz = S / 2 + (flight.z / 2100) * (S / 2);
  ctx.save();
  ctx.translate(px, pz);
  ctx.rotate(flight.heading);
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); ctx.stroke();
}

// ---------------------------------------------------------------------------
// Menus (DOM overlays above the canvas).
// ---------------------------------------------------------------------------
export function showTitle(log) {
  const menu = document.getElementById('menu');
  const rows = MISSIONS.map((m) => {
    const best = log[m.id];
    const medal = best ? '<span style="color:' + (MEDALS[best.medal] || '#888') + '">● ' + best.medal.toUpperCase() + '</span>' : '<span style="color:#888">—</span>';
    const time = best ? formatTime(best.time) : '';
    return `<button class="mission-btn" data-mission="${m.id}">
      <span class="m-num">${m.num}</span>
      <span class="m-name">${m.name}</span>
      <span class="m-par">${m.par}</span>
      <span class="m-best">${medal} ${time}</span>
    </button>`;
  }).join('');
  menu.innerHTML = `
    <div class="panel">
      <h1>MERAPI AIRMAIL</h1>
      <p class="subtitle">A 3D island flight game — 8 missions over a living volcano island</p>
      <p class="tagline">Fly the mail. Mind the mountain. Grease the landing.</p>
      <div class="missions">${rows}</div>
      <p class="howto">W/S pitch · A/D roll · Q/E rudder · SHIFT/CTRL throttle · F flaps · G gear · C camera · P pause<br>
      Free flight: pick any mission, then fly wherever you like. Medals and best times save to your pilot log.</p>
    </div>`;
  menu.style.display = 'flex';
  menu.querySelectorAll('.mission-btn').forEach((b) => {
    b.addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:mission', { detail: b.dataset.mission })));
  });
}

export function showBriefing(mission) {
  const menu = document.getElementById('menu');
  menu.innerHTML = `
    <div class="panel">
      <h2>MISSION ${mission.def.num} — ${mission.def.name.toUpperCase()}</h2>
      <p class="brief">${mission.def.brief}</p>
      <p class="medals">GOLD ${formatTime(mission.def.gold)} &nbsp;·&nbsp; SILVER ${formatTime(mission.def.silver)} &nbsp;·&nbsp; BRONZE ${formatTime(mission.def.bronze)}</p>
      <button class="big-btn" id="fly-btn">FLY THIS MISSION</button>
      <button class="big-btn secondary" id="back-btn">BACK TO MISSIONS</button>
    </div>`;
  menu.style.display = 'flex';
  document.getElementById('fly-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:fly')));
  document.getElementById('back-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:back')));
}

export function showResults(mission, log) {
  const menu = document.getElementById('menu');
  const ok = mission.finished;
  const medal = ok ? mission.medal : 'none';
  menu.innerHTML = `
    <div class="panel">
      <h2>${ok ? 'MISSION COMPLETE' : 'MISSION FAILED'}</h2>
      <p class="brief">${ok ? mission.message : mission.failedReason}</p>
      <p class="medals">TIME ${formatTime(mission.elapsed)} &nbsp;·&nbsp; SCORE ${mission.score} &nbsp;·&nbsp; ${ok ? 'MEDAL: ' + medal.toUpperCase() : 'NO MEDAL'}</p>
      <button class="big-btn" id="again-btn">FLY AGAIN</button>
      <button class="big-btn secondary" id="menu-btn">MISSION SELECT</button>
    </div>`;
  menu.style.display = 'flex';
  document.getElementById('again-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:mission', { detail: mission.def.id })));
  document.getElementById('menu-btn').addEventListener('click', () => window.dispatchEvent(new CustomEvent('merapi:back')));
}

export function hideMenu() {
  document.getElementById('menu').style.display = 'none';
}
