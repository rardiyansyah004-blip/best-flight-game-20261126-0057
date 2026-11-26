// MERAPI AIRMAIL v2 — renderer: scene, golden-hour / day / night lighting,
// sky dome, chase + cockpit cameras, rain, and the per-frame camera follow.
// v2: ring gates are repositioned per mission (updateRings) so the gates
// follow the mission's route instead of one fixed course. The chase camera
// SNAPS to its target when far away (mission start, screenshot staging)
// instead of lerping across the island, so the first frame is already framed.
import * as THREE from 'three';
import { buildWorld, buildRings, ringPositions } from './world.js';
import { buildAircraft, createPanelTexture, drawPanel, buildCockpitPanel } from './aircraft.js';
import { WORLD } from './config.js';

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

  const world = buildWorld(scene);
  const rings = buildRings(scene, ringPositions());
  const plane = buildAircraft();
  scene.add(plane);

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

  return { renderer, scene, camera, sun, hemi, sky, skyMat, world, rings, plane, panel, panelMesh, rain };
}

/** Sun/lighting preset: 'day' | 'golden' | 'night' | 'storm'. */
export function applyLighting(r, mode) {
  const u = r.skyMat.uniforms;
  if (mode === 'golden') {
    r.sun.color.set(0xffb36b); r.sun.intensity = 1.5; r.sun.position.set(1600, 320, 900);
    r.hemi.intensity = 0.45;
    u.top.value.set(0x2e4d7d); u.mid.value.set(0xe89a5e); u.low.value.set(0xff7a3c);
    r.scene.fog.color.set(0xe8a06a); r.scene.background.set(0xe8a06a);
  } else if (mode === 'night') {
    r.sun.color.set(0x8fa8d8); r.sun.intensity = 0.25; r.sun.position.set(-800, 600, -400);
    r.hemi.intensity = 0.18;
    u.top.value.set(0x060a18); u.mid.value.set(0x16233f); u.low.value.set(0x2a3550);
    r.scene.fog.color.set(0x101a2c); r.scene.background.set(0x101a2c);
  } else if (mode === 'storm') {
    r.sun.color.set(0x9aa5b5); r.sun.intensity = 0.7; r.sun.position.set(400, 900, -600);
    r.hemi.intensity = 0.35;
    u.top.value.set(0x2c3440); u.mid.value.set(0x5a6675); u.low.value.set(0x3a4450);
    r.scene.fog.color.set(0x5a6675); r.scene.background.set(0x5a6675);
  } else {
    r.sun.color.set(0xffe0b0); r.sun.intensity = 1.6; r.sun.position.set(1200, 900, 600);
    r.hemi.intensity = 0.7;
    u.top.value.set(0x3a6ea8); u.mid.value.set(0x9ec7e8); u.low.value.set(0xffc98a);
    r.scene.fog.color.set(0xa8c8de); r.scene.background.set(0xa8c8de);
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
  // Clouds drift.
  r.world.clouds.children.forEach((c, i) => {
    c.position.x += dt * (1.5 + (i % 3));
    if (c.position.x > 2000) c.position.x = -2000;
  });

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
    // Chase camera: behind and above, smoothed — but snap straight there
    // when far away, so mission starts and staged shots frame at once.
    const back = 16 + flight.speed * 0.08;
    const target = new THREE.Vector3(flight.x - fx * back, flight.y + 5.5 + flight.speed * 0.02, flight.z - fz * back);
    if (r.camera.position.distanceTo(target) > 60) r.camera.position.copy(target);
    else r.camera.position.lerp(target, Math.min(1, dt * 5));
    r.camera.up.copy(up);
    const look = new THREE.Vector3(flight.x + fx * 30, flight.y + Math.sin(flight.pitch) * 20, flight.z + fz * 30);
    r.camera.lookAt(look);
    r.camera.rotation.z += flight.roll * 0.12;
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

/** Colour the ring gates: next = pulsing amber, done = green, later = dim. */
export function setRingStates(rings, nextIndex, doneCount) {
  rings.forEach((ring, i) => {
    if (!ring.visible) return;
    const mat = ring.material;
    if (i < doneCount) mat.color.set(0x39ff88);
    else if (i === nextIndex) mat.color.set(0xffc233);
    else mat.color.set(0x8a7a5a);
    const s = i === nextIndex ? 1 + Math.sin(performance.now() / 240) * 0.06 : 1;
    ring.scale.setScalar(s);
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
