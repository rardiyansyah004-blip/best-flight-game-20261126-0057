// MERAPI AIRMAIL v4 — the aircraft: a small original prop plane built from
// primitives, plus the 3D cockpit panel with lit canvas-texture gauges.
// v4 (graphics feel): the v3 plane had no lights at all, so at night it was
// a dark silhouette and the night screenshot read as an empty sky; v4 adds
// wingtip nav lights (red left, green right) and a white tail strobe that
// blinks (driven by render.js). The v3 panel was a flat dark board whose
// needles jumped every frame and whose 'AIRSPEED kt' label overflowed the
// gauge face into the next gauge; v4 gives the panel a gradient + glass
// gauge faces, eases every needle and value toward the live state, and
// shortens the label so it fits.
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
  // Nav lights: red on the left wingtip, green on the right, steady; a
  // white tail strobe that blinks (render.js toggles its visibility).
  const navGeo = new THREE.SphereGeometry(0.22, 8, 8);
  const leftNav = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0xff2a1e }));
  leftNav.position.set(-5.8, -0.25, 0.6);
  leftNav.name = 'NavLightLeft';
  plane.add(leftNav);
  const rightNav = new THREE.Mesh(navGeo, new THREE.MeshBasicMaterial({ color: 0x39ff88 }));
  rightNav.position.set(5.8, -0.25, 0.6);
  rightNav.name = 'NavLightRight';
  plane.add(rightNav);
  const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  strobe.position.set(0, 0.9, -3.9);
  strobe.name = 'TailStrobe';
  plane.add(strobe);
  plane.userData.strobe = strobe;
  // Registration + airmail stripe decals (thin boxes, no textures needed).
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.3, 5.4), redMat);
  stripe.position.set(0, 0.15, -0.4);
  plane.add(stripe);
  return plane;
}

// ---------------------------------------------------------------------------
// Cockpit panel: one canvas texture, redrawn each frame with live gauges.
// The panel sits in front of the cockpit camera; gauges glow (emissive map).
// v4: every needle and value eases toward the live state (module-level
// smoothed state, frame-rate independent enough at 60 fps) instead of
// jumping, so the cockpit reads as instruments, not a flickering readout.
// ---------------------------------------------------------------------------

/** Smoothed gauge state: needles glide instead of snapping to each frame. */
const smooth = {
  init: false, alt: 0, spd: 0, hdg: 0, thr: 0, fuel: 100, roll: 0, pitch: 0,
};

export function createPanelTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 320;
  return { canvas, ctx: canvas.getContext('2d'), texture: new THREE.CanvasTexture(canvas) };
}

function gauge(ctx, cx, cy, r, label, value, min, max, unit) {
  ctx.save();
  ctx.translate(cx, cy);
  // Face: dark with a soft radial falloff, then a glass highlight arc.
  const faceGrad = ctx.createRadialGradient(0, -r * 0.4, r * 0.1, 0, 0, r);
  faceGrad.addColorStop(0, '#1a2029');
  faceGrad.addColorStop(1, '#0a0e13');
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = faceGrad; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#e8d9a8'; ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r - 3, Math.PI * 1.15, Math.PI * 1.65);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 8;
  ctx.stroke();
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
  // Labels: 16px so 'AIRSPEED' fits its face without bleeding into the
  // next gauge (the v3 20px 'AIRSPEED kt' was 132px wide in a 124px face).
  ctx.fillStyle = '#e8f2f8'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
  ctx.fillText(label, 0, -r + 30);
  ctx.font = 'bold 26px monospace';
  ctx.fillText(String(Math.round(value)) + unit, 0, r - 16);
  ctx.restore();
}

/** Draw the six lit instruments into the panel canvas. */
export function drawPanel(panel, state) {
  const { ctx, canvas, texture } = panel;
  const W = canvas.width, H = canvas.height;
  // Panel board: vertical gradient instead of one flat dark slab.
  const boardGrad = ctx.createLinearGradient(0, 0, 0, H);
  boardGrad.addColorStop(0, '#232b36');
  boardGrad.addColorStop(1, '#141a21');
  ctx.fillStyle = boardGrad;
  ctx.fillRect(0, 0, W, H);
  // Panel screws + trim.
  ctx.fillStyle = '#39424e';
  for (const x of [20, W - 20]) for (const y of [20, H - 20]) {
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#c23b2e'; ctx.lineWidth = 5;
  ctx.strokeRect(4, 4, W - 8, H - 8);

  // Ease every displayed value toward the live state.
  if (!smooth.init) {
    smooth.alt = state.altFt; smooth.spd = state.speedKt; smooth.hdg = state.headingDeg;
    smooth.thr = state.throttle; smooth.fuel = state.fuel; smooth.roll = state.roll; smooth.pitch = state.pitch;
    smooth.init = true;
  } else {
    const k = 0.25;
    smooth.alt += (state.altFt - smooth.alt) * k;
    smooth.spd += (state.speedKt - smooth.spd) * k;
    const dh = ((state.headingDeg - smooth.hdg + 540) % 360) - 180;
    smooth.hdg = (smooth.hdg + dh * k + 360) % 360;
    smooth.thr += (state.throttle - smooth.thr) * k;
    smooth.fuel += (state.fuel - smooth.fuel) * k;
    smooth.roll += (state.roll - smooth.roll) * k;
    smooth.pitch += (state.pitch - smooth.pitch) * k;
  }

  const r = 62;
  gauge(ctx, 110, 130, r, 'ALT ft', smooth.alt, 0, 6000, '');
  gauge(ctx, 270, 130, r, 'AIRSPEED', smooth.spd, 0, 200, '');
  gauge(ctx, 430, 130, r, 'HEADING', smooth.hdg, 0, 360, '°');
  gauge(ctx, 590, 130, r, 'THROTTLE', smooth.thr * 100, 0, 100, '%');
  gauge(ctx, 750, 130, r, 'FUEL', smooth.fuel, 0, 100, '%');
  // Attitude indicator: horizon ball.
  ctx.save();
  ctx.translate(905, 130);
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
  const roll = smooth.roll, pitch = smooth.pitch;
  ctx.rotate(-roll);
  ctx.translate(0, pitch * 90);
  ctx.fillStyle = '#3f7fd0'; ctx.fillRect(-r, -r * 2, r * 2, r * 2);
  ctx.fillStyle = '#7a5a34'; ctx.fillRect(-r, 0, r * 2, r * 2);
  ctx.fillStyle = '#fff'; ctx.fillRect(-r, -3, r * 2, 6);
  ctx.restore();
  ctx.beginPath(); ctx.arc(905, 130, r, 0, Math.PI * 2);
  ctx.lineWidth = 4; ctx.strokeStyle = '#e8d9a8'; ctx.stroke();
  // Glass highlight on the attitude face.
  ctx.beginPath();
  ctx.arc(905, 130, r - 3, Math.PI * 1.15, Math.PI * 1.65);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.fillStyle = '#ffb347';
  ctx.beginPath(); ctx.moveTo(905 - 22, 130); ctx.lineTo(905 + 22, 130); ctx.lineTo(905, 130 + 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8f2f8'; ctx.font = 'bold 16px monospace'; ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', 905, 130 - r + 30);

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
