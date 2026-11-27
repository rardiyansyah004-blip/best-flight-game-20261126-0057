// MERAPI AIRMAIL v5 — the aircraft: a small original prop plane built from
// primitives, plus the 3D cockpit panel with lit canvas-texture gauges.
// v4 (graphics feel): the v3 plane had no lights at all, so at night it was
// a dark silhouette and the night screenshot read as an empty sky; v4 adds
// wingtip nav lights (red left, green right) and a white tail strobe that
// blinks (driven by render.js). The v3 panel was a flat dark board whose
// needles jumped every frame and whose 'AIRSPEED kt' label overflowed the
// gauge face into the next gauge; v4 gives the panel a gradient + glass
// gauge faces, eases every needle and value toward the live state, and
// shortens the label so it fits.
// v5.17 Tier 2 (aircraft mechanical realism, clean-room from the
// techniques of PhilCrowther/Aviation — never its code): the flat Lambert
// airframe becomes PBR — a riveted aluminium panel normal map (panel
// lines + rivet dots + brush streaks, drawn on canvas and Sobel'd into
// a tangent-space map) with a matching roughness map, so the fuselage
// and wings catch the sun and the sky environment; the canopy becomes
// a tinted physical material with a dark seat/headrest silhouette
// inside it; the propeller gains a translucent blur disc and a chrome
// spinner; exhaust soot streaks the cowling sides; every solid mesh
// is flagged to cast the tight aircraft-centred shadow the renderer
// sets up. The shape, dimensions and flight model are untouched.
// v5.17 Tier 2b (articulation): the wing's trailing edge is split into
// live surfaces — left/right ailerons (outer) and left/right flaps
// (inner), each on a hinge pivot at the spar line — plus an elevator
// on the stabiliser and a rudder on the fin, and the landing gear
// hangs on pivots so it can swing up into the wing. The planform is
// unchanged (same span, same chords, same silhouette); only the
// trailing-edge strips are separate meshes now. The renderer drives
// every pivot from the flight state each frame (read-only — the
// physics never sees the surfaces move).
import * as THREE from 'three';

const CREAM = 0xf2e6c9, RED = 0xc23b2e, DARK = 0x2a2e35, GLASS = 0x9fd4e8;

/** Sobel heightfield -> tangent-space normal map (canvas). Shared
 *  recipe with the world builders, written locally so this module
 *  stays self-contained: sample with wraparound, so the panel grid
 *  tiles without a seam around the fuselage. */
function panelNormalFromHeight(H, size, strength) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (at(i + 1, j) - at(i - 1, j)) * strength;
      const dz = (at(i, j + 1) - at(i, j - 1)) * strength;
      const inv = 1 / Math.hypot(dx, 1, dz);
      const o = (j * size + i) * 4;
      img.data[o] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((-dz * inv * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Riveted aluminium skin: a 512x512 heightfield with a panel-line
 *  grid (grooves every 64 px), rivet dots along the lines, and faint
 *  horizontal brush streaks — the same kind of procedural skin the
 *  Aviation FM2 wears, rebuilt from scratch on a canvas. Returns
 *  { normal, rough } (the roughness map multiplies the material
 *  roughness, so its base sits near 0.85). */
function makePanelMaps() {
  const size = 512;
  const H = new Float32Array(size * size);
  const R = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let h = 0.5;
      let rough = 0.85;
      // Panel grooves: lines every 64 px, 2 px wide, recessed.
      const gx = i % 64, gy = j % 64;
      if (gx < 2 || gy < 2) { h -= 0.22; rough = 1.0; }
      // Rivets: dots every 16 px along the panel lines, raised.
      const rx = i % 16, ry = j % 16;
      if ((gx < 2 && ry < 3) || (gy < 2 && rx < 3)) { h += 0.16; rough = 0.7; }
      // Brush streaks: faint horizontal bands.
      h += 0.04 * Math.sin(j * 0.11 + (i % 64) * 0.05);
      h += 0.02 * Math.sin(i * 0.031 + j * 0.017);
      H[j * size + i] = h;
      R[j * size + i] = Math.round(rough * 255);
    }
  }
  const normal = panelNormalFromHeight(H, size, 1.2);
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let p = 0; p < size * size; p++) {
    img.data[p * 4] = R[p]; img.data[p * 4 + 1] = R[p]; img.data[p * 4 + 2] = R[p]; img.data[p * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const rough = new THREE.CanvasTexture(c);
  rough.wrapS = THREE.RepeatWrapping;
  rough.wrapT = THREE.RepeatWrapping;
  return { normal, rough };
}

/** Propeller blur disc: a radial alpha gradient — transparent at the
 *  hub, strongest through the blade sweep, fading to the tip. */
function makePropDiscTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(210,215,220,0)');
  g.addColorStop(0.22, 'rgba(210,215,220,0.28)');
  g.addColorStop(0.6, 'rgba(210,215,220,0.45)');
  g.addColorStop(0.88, 'rgba(210,215,220,0.18)');
  g.addColorStop(1, 'rgba(210,215,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Exhaust soot: a dark streak that fades along its length, laid over
 *  the cowling sides behind the nose. */
function makeSootTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 128, 0);
  g.addColorStop(0, 'rgba(20,14,10,0.85)');
  g.addColorStop(0.55, 'rgba(20,14,10,0.4)');
  g.addColorStop(1, 'rgba(20,14,10,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Build the external plane model. Returns a THREE.Group facing -Z... forward is +Z in our sim; model nose points +Z.
 *  Articulated surfaces and gear pivots are exposed on
 *  plane.userData.surfaces for the renderer to drive each frame. */
export function buildAircraft() {
  const plane = new THREE.Group();
  plane.name = 'AirmailPlane';
  const panelMaps = makePanelMaps();
  // PBR airframe: riveted aluminium (cream paint over metal), red
  // painted surfaces, dark metal fittings. The panel maps give the
  // fuselage and wings their sun-catching relief; the environment
  // map (baked from the sky) supplies the sheen.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: CREAM, metalness: 0.68, roughness: 0.32,
    normalMap: panelMaps.normal, roughnessMap: panelMaps.rough,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const redMat = new THREE.MeshStandardMaterial({ color: RED, metalness: 0.55, roughness: 0.38 });
  const darkMat = new THREE.MeshStandardMaterial({ color: DARK, metalness: 0.4, roughness: 0.6 });
  const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.9, roughness: 0.15 });
  // Canopy: tinted physical glass — glossy, slightly transparent, with
  // a dark interior silhouette behind it. No transmission pass (that
  // would cost a full extra scene render in SwiftShader); the tint +
  // env reflection carries the glass read on its own.
  const canopyMat = new THREE.MeshPhysicalMaterial({
    color: 0x1a2836, metalness: 0.05, roughness: 0.04,
    transparent: true, opacity: 0.6, envMapIntensity: 1.5,
  });
  const surfaces = {};

  // Fuselage: tapered cylinder along Z.
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.55, 7.2, 12), bodyMat);
  fus.rotation.x = Math.PI / 2;
  fus.castShadow = true;
  plane.add(fus);
  // Nose cone + chrome spinner.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.4, 12), redMat);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 4.2;
  nose.castShadow = true;
  plane.add(nose);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 10), chromeMat);
  spinner.rotation.x = Math.PI / 2;
  spinner.position.z = 5.1;
  spinner.castShadow = true;
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
  // Propeller blur disc: the translucent sweep the spinning blades
  // read as at speed — a static disc the blades spin inside.
  const discTex = makePropDiscTexture();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(1.7, 32),
    new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.z = 5.32;
  disc.name = 'PropDisc';
  plane.add(disc);
  // Canopy + interior silhouette (seat + headrest, seen through the tint).
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.95, 12, 10), canopyMat);
  canopy.scale.set(0.9, 0.75, 1.7);
  canopy.position.set(0, 0.75, 0.9);
  canopy.castShadow = true;
  plane.add(canopy);
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1c1a18, metalness: 0.1, roughness: 0.9 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.4), seatMat);
  seat.position.set(0, 0.35, 0.4);
  plane.add(seat);
  const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.28, 0.16), seatMat);
  headrest.position.set(0, 0.85, 0.12);
  plane.add(headrest);
  // Exhaust soot streaks on the cowling sides, behind the nose.
  const sootTex = makeSootTexture();
  for (const s of [-1, 1]) {
    const soot = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.55),
      new THREE.MeshBasicMaterial({ map: sootTex, transparent: true, opacity: 0.75, depthWrite: false }));
    soot.position.set(s * 1.02, 0.05, 3.1);
    soot.rotation.y = s * Math.PI / 2;
    soot.name = 'ExhaustSoot';
    plane.add(soot);
  }
  // Main wing (low wing): the leading-edge spar section only — the
  // trailing edge is split into hinged ailerons (outer) and flaps
  // (inner) below, so the planform is identical to v5.15.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.22, 1.5), bodyMat);
  wing.position.set(0, -0.25, 0.9);
  wing.castShadow = true;
  plane.add(wing);
  // Trailing-edge surfaces: each is a pivot Group on the hinge line
  // (z = 0.15) with its mesh hanging 0.3 m behind it, so a rotation
  // about the pivot's X axis swings the trailing edge up or down.
  // Ailerons end at |x| = 4.9, where the red tip caps begin.
  function trailingSurface(x, w, mat, name) {
    const pivot = new THREE.Group();
    pivot.position.set(x, -0.25, 0.15);
    pivot.name = name;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, 0.6), mat);
    slab.position.set(0, 0, -0.3);
    slab.castShadow = true;
    pivot.add(slab);
    plane.add(pivot);
    return pivot;
  }
  surfaces.aileronL = trailingSurface(-4.25, 1.3, bodyMat, 'AileronL');
  surfaces.aileronR = trailingSurface(4.25, 1.3, bodyMat, 'AileronR');
  surfaces.flapL = trailingSurface(-2.1, 3.0, bodyMat, 'FlapL');
  surfaces.flapR = trailingSurface(2.1, 3.0, bodyMat, 'FlapR');
  // Red wingtips (unchanged silhouette, outboard of the ailerons).
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.24, 2.1), redMat);
    tip.position.set(s * 5.35, -0.25, 0.6);
    tip.castShadow = true;
    plane.add(tip);
  }
  // Tail: horizontal stabiliser (spar section) + elevator on its hinge.
  const stab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.9), redMat);
  stab.position.set(0, 0.15, -3.0);
  stab.castShadow = true;
  plane.add(stab);
  const elevPivot = new THREE.Group();
  elevPivot.position.set(0, 0.15, -3.45);
  elevPivot.name = 'Elevator';
  const elevSlab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.16, 0.4), redMat);
  elevSlab.position.set(0, 0, -0.2);
  elevSlab.castShadow = true;
  elevPivot.add(elevSlab);
  plane.add(elevPivot);
  surfaces.elevator = elevPivot;
  // Vertical fin (spar section) + rudder on its hinge (rotates about Y).
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.9, 1.0), redMat);
  fin.position.set(0, 0.9, -2.9);
  fin.castShadow = true;
  plane.add(fin);
  const rudPivot = new THREE.Group();
  rudPivot.position.set(0, 0.9, -3.4);
  rudPivot.name = 'Rudder';
  const rudSlab = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 0.6), redMat);
  rudSlab.position.set(0, 0, -0.3);
  rudSlab.castShadow = true;
  rudPivot.add(rudSlab);
  plane.add(rudPivot);
  surfaces.rudder = rudPivot;
  // Landing gear on pivots: each main leg + wheel hangs from a pivot
  // at the wing root, so the whole unit can swing up into the wing.
  // The tail wheel (the v4 comment promised one but never built it)
  // gets its own small pivot under the tail.
  function mainGear(s) {
    const pivot = new THREE.Group();
    pivot.position.set(s * 1.1, -0.55, 1.2);
    pivot.name = s < 0 ? 'GearL' : 'GearR';
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6), darkMat);
    leg.position.set(0, -0.45, 0);
    leg.rotation.z = s * 0.25;
    leg.castShadow = true;
    pivot.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(s * 0.25, -0.95, 0);
    wheel.castShadow = true;
    pivot.add(wheel);
    plane.add(pivot);
    return pivot;
  }
  surfaces.gearL = mainGear(-1);
  surfaces.gearR = mainGear(1);
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, -0.35, -3.6);
  tailPivot.name = 'GearTail';
  const tailStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.55, 6), darkMat);
  tailStrut.position.set(0, -0.28, 0);
  tailPivot.add(tailStrut);
  const tailWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 10), darkMat);
  tailWheel.rotation.z = Math.PI / 2;
  tailWheel.position.set(0, -0.55, 0);
  tailPivot.add(tailWheel);
  plane.add(tailPivot);
  surfaces.gearTail = tailPivot;
  plane.userData.surfaces = surfaces;
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
  stripe.castShadow = true;
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
