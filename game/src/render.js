// MERAPI AIRMAIL v4 — renderer: scene, golden-hour / day / night lighting,
// sky dome, chase + cockpit cameras, rain, and the per-frame camera follow.
// v2: ring gates are repositioned per mission (updateRings) so the gates
// follow the mission's route instead of one fixed course. The chase camera
// SNAPS to its target when far away (mission start, screenshot staging)
// instead of lerping across the island, so the first frame is already framed.
// v4 (graphics feel): the v3 camera LERPED at a fixed rate and the look
// direction snapped every frame, so the view felt like a security camera on
// a stick; the sky had a sun light but no visible sun, the sea was one flat
// colour, clouds drifted on rails, the volcano smoke never moved, and the
// plane left no trace of its speed. v4 adds: a spring-damped chase camera
// with a smoothed look target and eased roll, a speed-based FOV kick, a
// visible sun disc + halo, wingtip trails, takeoff dust, bobbing clouds,
// rising volcano smoke, a shimmering sea, and a glow on the next ring gate.
// The flight model itself is untouched — all of this is presentation.
// v4 perf note: the sun sprites stay at full size — measured, the frame
// rate in software rendering matches v3 once the HUD backdrop blur is
// gone, so the glow costs nothing worth removing.
import * as THREE from 'three';
import { buildWorld, buildRings, ringPositions } from './world.js';
import { buildAircraft, createPanelTexture, drawPanel, buildCockpitPanel } from './aircraft.js';
import { WORLD } from './config.js';

/** Radial-gradient glow texture (canvas): white core fading to transparent. */
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

const TRAIL_N = 36;
const DUST_N = 48;

/** A fading wingtip trail: a line whose head is the wingtip, tail fades out. */
function makeTrail(scene, glowTex) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(TRAIL_N * 3);
  const col = new Float32Array(TRAIL_N * 3);
  for (let i = 0; i < TRAIL_N; i++) {
    const f = 1 - i / (TRAIL_N - 1);
    col[i * 3] = 0.85 * f; col[i * 3 + 1] = 0.85 * f; col[i * 3 + 2] = 0.8 * f;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.8,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  return { line, pos, active: false };
}

export function createRenderer() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0xa8c8de, 900, 4200);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 9000);

  // Lights: sun + hemisphere fill.
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.6);
  sun.position.set(1200, 900, 600);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xbfd9ee, 0x3a5a3a, 0.7);
  scene.add(hemi);

  // Sky dome: big gradient sphere (BackSide, vertex colours).
  const skyGeo = new THREE.SphereGeometry(6000, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(0x3a6ea8) },
      mid: { value: new THREE.Color(0x9ec7e8) },
      low: { value: new THREE.Color(0xffc98a) },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low; void main(){ float h = normalize(vP).y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(low, mid, smoothstep(-0.08, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'SkyDome';
  scene.add(sky);

  // Sun disc + halo: the v3 sky had a sun light but no visible sun, so the
  // golden hour read as a flat orange band. The sprites sit on the sun
  // direction, 4200 m out (inside the dome), and follow the camera.
  const glowTex = makeGlowTexture();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xfff2c8, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunSprite.scale.set(460, 460, 1);
  sunSprite.name = 'SunDisc';
  scene.add(sunSprite);
  const haloSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffe9a8, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  haloSprite.scale.set(1500, 1500, 1);
  haloSprite.name = 'SunHalo';
  scene.add(haloSprite);

  const world = buildWorld(scene);
  const rings = buildRings(scene, ringPositions());
  const plane = buildAircraft();
  scene.add(plane);

  // Wingtip trails: one line per wingtip, fed by the plane's motion.
  const trails = [makeTrail(scene, glowTex), makeTrail(scene, glowTex)];

  // Takeoff dust: a small Points cloud kicked up by the wheels on the
  // ground roll. Inactive in the air (and in the staged screenshots).
  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_N * 3);
  const dustCol = new Float32Array(DUST_N * 3);
  for (let i = 0; i < DUST_N; i++) dustPos[i * 3 + 1] = -100;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    size: 3.2, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false,
  }));
  dust.frustumCulled = false;
  dust.name = 'TakeoffDust';
  scene.add(dust);
  const dustState = [];
  for (let i = 0; i < DUST_N; i++) dustState.push({ life: 0, vx: 0, vy: 0, vz: 0 });

  // Cockpit panel + texture (only visible in cockpit view).
  const panel = createPanelTexture();
  const panelMesh = buildCockpitPanel(panel);
  panelMesh.visible = false;
  scene.add(panelMesh);

  // Rain: a Points cloud around the plane, toggled for the storm.
  const rainGeo = new THREE.BufferGeometry();
  const rainCount = 900;
  const rainPos = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPos[i * 3] = (Math.random() - 0.5) * 120;
    rainPos[i * 3 + 1] = Math.random() * 60;
    rainPos[i * 3 + 2] = (Math.random() - 0.5) * 120;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0xaaccee, size: 0.9, transparent: true, opacity: 0.6 }));
  rain.visible = false;
  rain.name = 'Rain';
  scene.add(rain);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return {
    renderer, scene, camera, sun, hemi, sky, skyMat, world, rings, plane,
    panel, panelMesh, rain, sunSprite, haloSprite, trails, dust, dustState,
    // v4 camera feel state: spring velocity, smoothed look target + roll, FOV.
    camVel: new THREE.Vector3(),
    lookSmooth: new THREE.Vector3(),
    lookInit: false,
    rollSmooth: 0,
    fovSmooth: 62,
  };
}

/** Sun/lighting preset: 'day' | 'golden' | 'night' | 'storm'. */
export function applyLighting(r, mode) {
  const u = r.skyMat.uniforms;
  if (mode === 'golden') {
    r.sun.color.set(0xffb36b); r.sun.intensity = 1.5; r.sun.position.set(1600, 320, 900);
    r.hemi.intensity = 0.45;
    u.top.value.set(0x2e4d7d); u.mid.value.set(0xe89a5e); u.low.value.set(0xff7a3c);
    r.scene.fog.color.set(0xe8a06a); r.scene.background.set(0xe8a06a);
    r.sunSprite.material.color.set(0xffc27a); r.sunSprite.material.opacity = 0.95;
    r.sunSprite.scale.set(520, 520, 1);
    r.haloSprite.material.color.set(0xff8a3c); r.haloSprite.material.opacity = 0.4;
    r.haloSprite.scale.set(1900, 1900, 1);
  } else if (mode === 'night') {
    r.sun.color.set(0x8fa8d8); r.sun.intensity = 0.25; r.sun.position.set(-800, 600, -400);
    r.hemi.intensity = 0.18;
    u.top.value.set(0x060a18); u.mid.value.set(0x16233f); u.low.value.set(0x2a3550);
    r.scene.fog.color.set(0x101a2c); r.scene.background.set(0x101a2c);
    // Night sun is the moon: pale, smaller, dimmer halo.
    r.sunSprite.material.color.set(0xdfe8ff); r.sunSprite.material.opacity = 0.55;
    r.sunSprite.scale.set(300, 300, 1);
    r.haloSprite.material.color.set(0x8fa8d8); r.haloSprite.material.opacity = 0.16;
    r.haloSprite.scale.set(900, 900, 1);
  } else if (mode === 'storm') {
    r.sun.color.set(0x9aa5b5); r.sun.intensity = 0.7; r.sun.position.set(400, 900, -600);
    r.hemi.intensity = 0.35;
    u.top.value.set(0x2c3440); u.mid.value.set(0x5a6675); u.low.value.set(0x3a4450);
    r.scene.fog.color.set(0x5a6675); r.scene.background.set(0x5a6675);
    r.sunSprite.material.color.set(0xcfd6de); r.sunSprite.material.opacity = 0.4;
    r.sunSprite.scale.set(420, 420, 1);
    r.haloSprite.material.color.set(0x9aa5b5); r.haloSprite.material.opacity = 0.18;
    r.haloSprite.scale.set(1400, 1400, 1);
  } else {
    r.sun.color.set(0xffe0b0); r.sun.intensity = 1.6; r.sun.position.set(1200, 900, 600);
    r.hemi.intensity = 0.7;
    u.top.value.set(0x3a6ea8); u.mid.value.set(0x9ec7e8); u.low.value.set(0xffc98a);
    r.scene.fog.color.set(0xa8c8de); r.scene.background.set(0xa8c8de);
    r.sunSprite.material.color.set(0xfff2c8); r.sunSprite.material.opacity = 0.85;
    r.sunSprite.scale.set(460, 460, 1);
    r.haloSprite.material.color.set(0xffe9a8); r.haloSprite.material.opacity = 0.3;
    r.haloSprite.scale.set(1500, 1500, 1);
  }
}

/** Move the ring meshes onto a mission's route gates. Extra rings hide. */
export function updateRings(rings, positions) {
  rings.forEach((ring, i) => {
    if (i < positions.length) {
      const p = positions[i];
      ring.visible = true;
      ring.position.set(p.x, p.y, p.z);
      const prev = positions[Math.max(0, i - 1)];
      ring.rotation.y = Math.atan2(p.x - prev.x, p.z - prev.z);
      ring.name = 'RingGate' + (i + 1);
    } else {
      ring.visible = false;
    }
  });
}

/** Position the plane mesh + cameras from flight state. */
export function updateScene(r, flight, cameraMode, dt, time) {
  const plane = r.plane;
  plane.position.set(flight.x, flight.y, flight.z);
  plane.rotation.order = 'YXZ';
  plane.rotation.y = flight.heading;
  plane.rotation.x = flight.pitch;
  plane.rotation.z = flight.roll;
  if (flight.speed > 5) {
    plane.userData.propeller.rotation.z += dt * (8 + flight.throttle * 40);
  }
  // Wingtip strobe blinks (nav lights stay steady).
  const strobe = plane.userData.strobe;
  if (strobe) strobe.visible = (time % 1.4) < 0.1;
  // Clouds drift AND bob gently instead of sliding on rails.
  r.world.clouds.children.forEach((c, i) => {
    c.position.x += dt * (1.5 + (i % 3));
    if (c.position.x > 2000) c.position.x = -2000;
    if (c.userData.baseY === undefined) c.userData.baseY = c.position.y;
    c.position.y = c.userData.baseY + Math.sin(time * 0.12 + i * 1.7) * 7;
  });
  // Volcano smoke rises and drifts instead of hanging frozen.
  if (r.world.smoke) {
    r.world.smoke.forEach((p) => {
      if (p.userData.baseY === undefined) p.userData.baseY = p.position.y;
      p.position.y += dt * 5;
      p.position.x += dt * 2;
      if (p.position.y > p.userData.baseY + 220) {
        p.position.y = p.userData.baseY;
        p.position.x -= 44;
      }
    });
  }
  // Sea shimmer: scroll the streak texture and breathe the specular.
  if (r.world.sea) {
    const m = r.world.sea.material;
    if (m.map) { m.map.offset.x += dt * 0.006; m.map.offset.y += dt * 0.0025; }
    m.shininess = 110 + Math.sin(time * 0.6) * 45;
  }
  // Wingtip trails: feed the two wingtip positions while airborne and fast.
  updateTrails(r, flight, dt);
  // Takeoff dust on the ground roll.
  updateDust(r, flight, dt);

  // Sun disc + halo follow the camera on the sun direction.
  const sunDir = new THREE.Vector3().copy(r.sun.position).normalize();
  r.sunSprite.position.copy(r.camera.position).addScaledVector(sunDir, 4200);
  r.haloSprite.position.copy(r.sunSprite.position);

  const fx = Math.sin(flight.heading), fz = Math.cos(flight.heading);
  const up = new THREE.Vector3(0, 1, 0);
  if (cameraMode === 'cockpit') {
    // Camera at the pilot seat, looking forward over the panel.
    const eye = new THREE.Vector3(flight.x + fx * 0.4, flight.y + 1.15, flight.z + fz * 0.4);
    const look = new THREE.Vector3(flight.x + fx * 60, flight.y + 1.15 + Math.sin(flight.pitch) * 40, flight.z + fz * 60);
    r.camera.position.copy(eye);
    r.camera.up.copy(up);
    r.camera.lookAt(look);
    r.camera.rotation.z += flight.roll * 0.35;
    r.lookInit = false;
    // Cockpit holds the base FOV.
    r.fovSmooth += (62 - r.fovSmooth) * Math.min(1, dt * 3);
    if (Math.abs(r.camera.fov - r.fovSmooth) > 0.01) {
      r.camera.fov = r.fovSmooth;
      r.camera.updateProjectionMatrix();
    }
    // Panel floats just below the view, parented to the world at the plane.
    // It must face the pilot (toward -Z of the flight direction), so it is
    // rotated PI past the heading; the tilt leans its top away from the pilot.
    r.panelMesh.visible = true;
    r.panelMesh.position.set(flight.x + fx * 3.6, flight.y + 0.18, flight.z + fz * 3.6);
    r.panelMesh.rotation.order = 'YXZ';
    r.panelMesh.rotation.y = flight.heading + Math.PI;
    r.panelMesh.rotation.x = -0.35 + flight.pitch;
    r.panelMesh.rotation.z = -flight.roll;
    plane.visible = false;
  } else {
    plane.visible = true;
    r.panelMesh.visible = false;
    // Chase camera, v4: a damped spring instead of a fixed-rate lerp, so
    // the view settles with weight instead of gliding on rails — but still
    // snaps straight there when far away, so mission starts and staged
    // shots frame at once.
    const back = 16 + flight.speed * 0.08;
    const target = new THREE.Vector3(flight.x - fx * back, flight.y + 5.5 + flight.speed * 0.02, flight.z - fz * back);
    if (r.camera.position.distanceTo(target) > 60) {
      r.camera.position.copy(target);
      r.camVel.set(0, 0, 0);
      r.lookInit = false;
    } else {
      const tmp = new THREE.Vector3().subVectors(target, r.camera.position);
      r.camVel.addScaledVector(tmp, 18 * dt);
      r.camVel.multiplyScalar(Math.max(0, 1 - 7 * dt));
      r.camera.position.addScaledVector(r.camVel, dt);
    }
    r.camera.up.copy(up);
    const look = new THREE.Vector3(flight.x + fx * 30, flight.y + Math.sin(flight.pitch) * 20, flight.z + fz * 30);
    if (!r.lookInit) { r.lookSmooth.copy(look); r.lookInit = true; }
    r.lookSmooth.lerp(look, Math.min(1, dt * 6));
    r.camera.lookAt(r.lookSmooth);
    const targetRoll = flight.roll * 0.12;
    r.rollSmooth += (targetRoll - r.rollSmooth) * Math.min(1, dt * 6);
    r.camera.rotation.z += r.rollSmooth;
    // Speed feel: the FOV breathes open as the plane goes faster.
    const targetFov = 62 + Math.max(0, Math.min(1, (flight.speed - 55) / 40)) * 6;
    r.fovSmooth += (targetFov - r.fovSmooth) * Math.min(1, dt * 3);
    if (Math.abs(r.camera.fov - r.fovSmooth) > 0.01) {
      r.camera.fov = r.fovSmooth;
      r.camera.updateProjectionMatrix();
    }
  }

  // Rain follows the plane.
  if (r.rain.visible) {
    r.rain.position.set(flight.x, flight.y, flight.z);
    const pos = r.rain.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) - dt * 55;
      if (y < -30) y = 30;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }
}

/** Feed the wingtip trails from the plane's motion. */
function updateTrails(r, flight, dt) {
  const active = !flight.onGround && flight.speed > 25;
  r.trails.forEach((t, side) => {
    if (!active) {
      t.line.visible = false;
      t.active = false;
      return;
    }
    if (!t.active) {
      // (Re)activate: collapse the whole trail onto the wingtip so it
      // grows out cleanly instead of streaking across the island.
      const tip = wingtipPos(r.plane, side);
      for (let i = 0; i < TRAIL_N; i++) {
        t.pos[i * 3] = tip.x; t.pos[i * 3 + 1] = tip.y; t.pos[i * 3 + 2] = tip.z;
      }
      t.active = true;
      t.line.visible = true;
    }
    // Shift the trail back one slot and write the new tip at the head.
    t.pos.copyWithin(3, 0, (TRAIL_N - 1) * 3);
    const tip = wingtipPos(r.plane, side);
    t.pos[0] = tip.x; t.pos[1] = tip.y; t.pos[2] = tip.z;
    t.line.geometry.attributes.position.needsUpdate = true;
  });
}

function wingtipPos(plane, side) {
  const s = side === 0 ? -1 : 1;
  const v = new THREE.Vector3(s * 5.8, -0.25, 0.6);
  v.applyEuler(plane.rotation);
  v.add(plane.position);
  return v;
}

/** Takeoff dust: spawn at the wheels on the ground roll, drift and fade. */
function updateDust(r, flight, dt) {
  const pos = r.dust.geometry.attributes.position;
  const col = r.dust.geometry.attributes.color;
  const rolling = flight.onGround && flight.speed > 12;
  const fx = Math.sin(flight.heading), fz = Math.cos(flight.heading);
  let spawned = 0;
  for (let i = 0; i < DUST_N; i++) {
    const p = r.dustState[i];
    if (p.life <= 0) {
      if (rolling && spawned < 2) {
        spawned += 1;
        const side = spawned === 1 ? -1 : 1;
        pos.setXYZ(i, flight.x - fx * 2 + Math.cos(flight.heading) * side * 1.3, flight.y - 0.5, flight.z - fz * 2 - Math.sin(flight.heading) * side * 1.3);
        p.vx = -fx * flight.speed * 0.12 + (Math.random() - 0.5) * 3;
        p.vy = 1.2 + Math.random() * 1.6;
        p.vz = -fz * flight.speed * 0.12 + (Math.random() - 0.5) * 3;
        p.life = 1;
      } else {
        pos.setY(i, -100);
        col.setXYZ(i, 0, 0, 0);
      }
      continue;
    }
    p.life -= dt * 1.1;
    pos.setXYZ(i,
      pos.getX(i) + p.vx * dt,
      pos.getY(i) + p.vy * dt,
      pos.getZ(i) + p.vz * dt);
    p.vy *= Math.max(0, 1 - dt * 1.5);
    const fade = Math.max(0, p.life) * 0.55;
    col.setXYZ(i, 0.72 * fade, 0.66 * fade, 0.55 * fade);
    if (p.life <= 0) pos.setY(i, -100);
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
}

/** Colour the ring gates: next = pulsing amber, done = green, later = dim.
 *  The next gate also carries a soft glow sprite so the target reads
 *  through the haze. */
export function setRingStates(rings, nextIndex, doneCount) {
  rings.forEach((ring, i) => {
    if (!ring.visible) return;
    const mat = ring.material;
    if (i < doneCount) mat.color.set(0x39ff88);
    else if (i === nextIndex) mat.color.set(0xffc233);
    else mat.color.set(0x8a7a5a);
    const s = i === nextIndex ? 1 + Math.sin(performance.now() / 240) * 0.06 : 1;
    ring.scale.setScalar(s);
    const glow = ring.children[0];
    if (glow && glow.isSprite) glow.visible = (i === nextIndex);
  });
}

/** Redraw the cockpit instruments from live flight state. */
export function updatePanel(r, flight) {
  if (!r.panelMesh.visible) return;
  const hdgDeg = ((flight.heading * 180 / Math.PI) % 360 + 360) % 360;
  const warns = [];
  if (flight.stalled) warns.push('STALL');
  if (flight.fuel < 20) warns.push('LOW FUEL');
  drawPanel(r.panel, {
    altFt: Math.round(flight.y * 3.28084),
    speedKt: Math.round(flight.speed * 1.94384),
    headingDeg: Math.round(hdgDeg),
    throttle: flight.throttle,
    fuel: flight.fuel,
    roll: flight.roll,
    pitch: flight.pitch,
    warnings: warns,
  });
}
