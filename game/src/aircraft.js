// MERAPI AIRMAIL — the aircraft: a small original prop plane built from
// primitives, plus the 3D cockpit panel with lit canvas-texture gauges.
import * as THREE from 'three';

const CREAM = 0xf2e6c9, RED = 0xc23b2e, DARK = 0x2a2e35, GLASS = 0x9fd4e8;

/** Build the external plane model. Returns a THREE.Group facing -Z... forward is +Z in our sim; model nose points +Z. */
export function buildAircraft() {
  const plane = new THREE.Group();
  plane.name = 'AirmailPlane';
  const bodyMat = new THREE.MeshLambertMaterial({ color: CREAM });
  const redMat = new THREE.MeshLambertMaterial({ color: RED });
  const darkMat = new THREE.MeshLambertMaterial({ color: DARK });
  const glassMat = new THREE.MeshPhongMaterial({ color: GLASS, shininess: 160, specular: 0xffffff });

  // Fuselage: tapered cylinder along Z.
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.55, 7.2, 12), bodyMat);
  fus.rotation.x = Math.PI / 2;
  plane.add(fus);
  // Nose cone + spinner.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 12), redMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 4.2;
  plane.add(nose);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 10), darkMat);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = 5.1;
  plane.add(spinner);
  // Propeller blades.
  const prop = new THREE.Group();
  prop.name = 'Propeller';
  for (const a of [0, Math.PI]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.4, 0.12), darkMat);
    blade.rotation.z = a;
    prop.add(blade);
  }
  prop.position.z = 5.3;
  plane.add(prop);
  plane.userData.propeller = prop;
  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), glassMat);
  canopy.scale.set(0.9, 0.75, 1.7);
  canopy.position.set(0, 0.75, 0.9);
  plane.add(canopy);
  // Main wing (low wing) + red tips.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.22, 2.1), bodyMat);
  wing.position.set(0, -0.25, 0.6);
  plane.add(wing);
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 2.1), redMat);
    tip.position.set(s * 5.35, -0.25, 0.6);
    plane.add(tip);
  }
  // Tail: horizontal stabiliser + vertical fin, red.
  const stab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 1.3), redMat);
  stab.position.set(0, 0.15, -3.2);
  plane.add(stab);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.9, 1.6), redMat);
  fin.position.set(0, 0.9, -3.2);
  plane.add(fin);
  // Landing gear: two fixed wheels + tail wheel.
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), darkMat);
    leg.position.set(s * 1.1, -1.0, 1.2);
    leg.rotation.z = s * 0.25;
    plane.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 1.35, -1.5, 1.2);
    plane.add(wheel);
  }
  // Registration + airmail stripe decals (thin boxes, no textures needed).
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.3, 5.4), redMat);
  stripe.position.set(0, 0.15, -0.4);
  plane.add(stripe);
  return plane;
}

// ---------------------------------------------------------------------------
// Cockpit panel: one canvas texture, redrawn each frame with live gauges.
// The panel sits in front of the cockpit camera; gauges glow (emissive map).
// ---------------------------------------------------------------------------
export function createPanelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 320;
  return { canvas, ctx: canvas.getContext('2d'), texture: new THREE.CanvasTexture(canvas) };
}

function gauge(ctx, cx, cy, r, label, value, min, max, unit) {
  ctx.save();
  ctx.translate(cx, cy);
  // Face.
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = '#10141a'; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#e8d9a8'; ctx.stroke();
  // Tick marks.
  ctx.strokeStyle = '#cfe3ee'; ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (r - 6), Math.sin(a) * (r - 6));
    ctx.lineTo(Math.cos(a) * (r - 14), Math.sin(a) * (r - 14));
    ctx.stroke();
  }
  // Needle.
  const frac = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const na = Math.PI * 0.75 + frac * Math.PI * 1.5;
  ctx.beginPath(); ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(na) * (r - 10), Math.sin(na) * (r - 10));
  ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffb347'; ctx.fill();
  // Labels.
  ctx.fillStyle = '#e8f2f8'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
  ctx.fillText(label, 0, -r + 34);
  ctx.font = 'bold 26px monospace';
  ctx.fillText(String(Math.round(value)) + unit, 0, r - 16);
  ctx.restore();
}

/** Draw the six lit instruments into the panel canvas. */
export function drawPanel(panel, state) {
  const { ctx, canvas, texture } = panel;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#1c222b';
  ctx.fillRect(0, 0, W, H);
  // Panel screws + trim.
  ctx.fillStyle = '#39424e';
  for (const x of [20, W - 20]) for (const y of [20, H - 20]) {
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#c23b2e'; ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  const r = 62;
  gauge(ctx, 110, 130, r, 'ALT ft', state.altFt, 0, 6000, '');
  gauge(ctx, 270, 130, r, 'AIRSPEED kt', state.speedKt, 0, 200, '');
  gauge(ctx, 430, 130, r, 'HEADING', state.headingDeg, 0, 360, '°');
  gauge(ctx, 590, 130, r, 'THROTTLE', state.throttle * 100, 0, 100, '%');
  gauge(ctx, 750, 130, r, 'FUEL', state.fuel, 0, 100, '%');
  // Attitude indicator: horizon ball.
  ctx.save();
  ctx.translate(905, 130);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  const roll = state.roll, pitch = state.pitch;
  ctx.rotate(-roll);
  ctx.translate(0, pitch * 90);
  ctx.fillStyle = '#3f7fd0'; ctx.fillRect(-r, -r * 2, r * 2, r * 2);
  ctx.fillStyle = '#7a5a34'; ctx.fillRect(-r, 0, r * 2, r * 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(-r, -3, r * 2, 6);
  ctx.restore();
  ctx.beginPath(); ctx.arc(905, 130, r, 0, Math.PI * 2);
  ctx.lineWidth = 4; ctx.strokeStyle = '#e8d9a8'; ctx.stroke();
  ctx.fillStyle = '#ffb347';
  ctx.beginPath(); ctx.moveTo(905 - 22, 130); ctx.lineTo(905 + 22, 130); ctx.lineTo(905, 130 + 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8f2f8'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', 905, 130 - r + 34);

  // Warning strip.
  ctx.font = 'bold 24px monospace'; ctx.textAlign = 'left';
  const warns = state.warnings || [];
  ctx.fillStyle = warns.length ? '#ff5a4e' : '#39ff88';
  ctx.fillText(warns.length ? '⚠ ' + warns.join('  •  ') : 'ALL SYSTEMS NOMINAL', 40, H - 26);
  texture.needsUpdate = true;
}

/** Build the cockpit panel mesh (a curved-ish board in front of the camera). */
export function buildCockpitPanel(panel) {
  const mat = new THREE.MeshBasicMaterial({ map: panel.texture });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.06), mat);
  mesh.name = 'CockpitPanel';
  return mesh;
}
