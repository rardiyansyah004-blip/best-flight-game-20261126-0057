// MERAPI AIRMAIL v5 — renderer: scene, golden-hour / day / night lighting,
// sky dome, chase + cockpit + orbit cameras, rain, and the per-frame camera follow.
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
// v5 adds the third camera GeoFS cycles to (C): a free orbit camera that
// slowly circles the plane at a fixed distance, always looking at it —
// the view for admiring the aircraft and the island, and for watching the
// autopilot fly the route from outside. Chase and cockpit are untouched;
// the orbit is one new branch in updateScene plus one angle on the
// renderer state, and it costs nothing per frame beyond the lookAt.
// v5.17 (realistic graphics, clean-room from the techniques of
// PhilCrowther/Aviation and PierreEVEN/ThreeFlightSimulator — never their
// code): the gradient sky dome becomes an analytic Rayleigh/Mie sky — blue
// scattering away from the sun, a warm forward-scatter halo hugging it,
// haze below the horizon — baked once through a PMREM generator into the
// scene environment so the PBR ocean and terrain carry real sky
// reflections; the linear fog becomes FogExp2 (0.00036) for aerial
// perspective; the sea shimmer now scrolls the wave normal map and drives
// the ocean/terrain shader clocks. Flight model untouched.
// v5.17 polish (from the first cover screenshot): the golden-hour sun
// read as a soft glow with no defined orb, so the sky shader now draws
// its own tight sun disc core under the sprite halo, and the golden
// Mie strength is raised so the low sun carries further across the sky.
// v5.17 Tier 2 (aircraft mechanical realism): the renderer drives the
// plane's articulated surfaces — ailerons, flaps, elevator, rudder and
// the retractable gear — from the flight state each frame (read-only,
// the physics never sees them move), and the sun light becomes a tight
// aircraft-centred shadow: PCFSoftShadowMap, a 1024 map over a +/-32 m
// frustum that follows the plane, so the aircraft throws a crisp
// shadow on the runway and the terrain instead of floating over it.
// The sun direction is stored once per lighting mode (r.sunDir) and
// reused by the sky shader and the sun sprites, because the light
// position itself is now plane-relative every frame. The ailerons keep
// a steady-bank term (roll * 0.3) on top of the rate term, so a held
// turn still shows a deflected surface in a still screenshot.
import * as THREE from 'three';
import { buildWorld, buildRings, ringPositions } from './world.js';
import { buildAircraft, createPanelTexture, drawPanel, buildCockpitPanel } from './aircraft.js';
import { WORLD, REALISM } from './config.js';

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
  // v5.17 Tier 2: tight aircraft-centred shadows. One 1024 map over a
  // +/-32 m frustum is cheap in SwiftShader and keeps the aircraft
  // grounded on the runway instead of floating over it.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d9);
  // v5.17: exponential fog for aerial perspective — distant island fades
  // into haze instead of hitting a hard linear wall.
  scene.fog = new THREE.FogExp2(0xa8c8de, REALISM.sky.fogDensity);

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 9000);

  // Lights: sun + hemisphere fill.
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.6);
  sun.position.set(1200, 900, 600);
  scene.add(sun);
  // Shadow camera: tight ortho frustum around the aircraft, 1024 map.
  // The light position and its target are re-aimed at the plane every
  // frame in updateScene; the target must live in the scene graph for
  // its matrix to update.
  sun.castShadow = true;
  sun.shadow.mapSize.set(REALISM.shadow.mapSize, REALISM.shadow.mapSize);
  sun.shadow.camera.left = -REALISM.shadow.frustum;
  sun.shadow.camera.right = REALISM.shadow.frustum;
  sun.shadow.camera.top = REALISM.shadow.frustum;
  sun.shadow.camera.bottom = -REALISM.shadow.frustum;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 2000;
  sun.shadow.bias = REALISM.shadow.bias;
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd9ee, 0x3a5a3a, 0.7);
  scene.add(hemi);

  // Sky dome (v5.17): an analytic single-scatter Rayleigh/Mie sky — the
  // same physics ThreeFlightSimulator ray-marches in its post-process,
  // reduced to a closed-form dome shader so it costs one sphere in
  // SwiftShader: blue (1 + cos^2) Rayleigh scattering away from the sun,
  // a warm tint toward it, a tight Mie halo around the sun disc, a
  // defined sun core under the sprite halo, and haze below the horizon.
  // The view direction is measured from the camera, so the dome stays
  // correct as the plane flies across the island.
  const skyGeo = new THREE.SphereGeometry(REALISM.sky.domeRadius, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(1200, 900, 600).normalize() },
      uSunColor: { value: new THREE.Color(0xfff2c8) },
      uZenith: { value: new THREE.Color(0x2f6cb0) },
      uHorizon: { value: new THREE.Color(0xbcd8ec) },
      uGround: { value: new THREE.Color(0x5a6a72) },
      uRayleigh: { value: REALISM.sky.rayleigh },
      uMieG: { value: REALISM.sky.mieG },
      uMieStrength: { value: REALISM.sky.mieStrength },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vWorldPos;
      uniform vec3 uSunDir; uniform vec3 uSunColor;
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround;
      uniform float uRayleigh; uniform float uMieG; uniform float uMieStrength;
      void main() {
        vec3 dir = normalize(vWorldPos - cameraPosition);
        float sunAmt = max(dot(dir, uSunDir), 0.0);
        float up = clamp(dir.y, -1.0, 1.0);
        vec3 sky = mix(uHorizon, uZenith, pow(max(up, 0.0), 0.55));
        float phase = 0.5 + 0.5 * sunAmt * sunAmt;
        float horizonness = pow(1.0 - abs(up), 3.0);
        vec3 rayCol = mix(vec3(0.35, 0.55, 0.95), vec3(1.0, 0.72, 0.42), pow(sunAmt, 3.0));
        sky = mix(sky, rayCol, uRayleigh * (0.35 + 0.65 * phase) * (0.4 + 0.6 * horizonness));
        float mie = pow(sunAmt, 180.0) * 1.4 + pow(sunAmt, 24.0) * 0.35;
        sky += uSunColor * mie * uMieStrength;
        sky += uSunColor * pow(sunAmt, 600.0) * 2.0;
        if (up < 0.0) sky = mix(uHorizon, uGround, clamp(-up * 3.0, 0.0, 1.0));
        gl_FragColor = vec4(sky, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.name = 'SkyDome';

  // v5.17: bake the sky into a PMREM environment map once at startup, so
  // the PBR ocean and terrain carry real sky reflections — sun glint on
  // the water, sheen on the canopy. The dome is rendered from the origin
  // in a throwaway scene (far plane 20000, past the dome), then moved
  // into the main scene. A failure here must never break the game.
  let envReady = false;
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(sky);
    const envRT = pmrem.fromScene(envScene, REALISM.sky.pmremBlur, 0.1, 20000);
    scene.environment = envRT.texture;
    scene.add(sky);
    pmrem.dispose();
    envReady = true;
  } catch (e) {
    if (!sky.parent) scene.add(sky);
  }

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
  // Shadow receivers: the terrain (which carries the runway shelves)
  // catches the aircraft's shadow, and the airframe catches its own.
  const terrainMesh = world.group.getObjectByName('Terrain');
  if (terrainMesh) terrainMesh.receiveShadow = true;
  plane.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });

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
    terrainMesh,
    envReady,
    // The sun's direction (unit vector), set by applyLighting per mode.
    // The light position itself goes plane-relative every frame, so the
    // sky shader and the sun sprites read the direction from here.
    sunDir: new THREE.Vector3(1200, 900, 600).normalize(),
    // v4 camera feel state: spring velocity, smoothed look target + roll, FOV.
    camVel: new THREE.Vector3(),
    lookSmooth: new THREE.Vector3(),
    lookInit: false,
    rollSmooth: 0,
    fovSmooth: 62,
    // v5 orbit camera state: the angle the free camera sits at around the plane.
    orbitAngle: 0,
  };
}

/** Sun/lighting preset: 'day' | 'golden' | 'night' | 'storm'.
 *  v5.17: each mode now retunes the Rayleigh/Mie sky uniforms, the fog
 *  colour (which the FogExp2 couples to the horizon), and how strongly
 *  the PBR ocean/terrain reflect the baked day environment — at night
 *  the env map is dimmed hard, or the sea would glow like noon. */
export function applyLighting(r, mode) {
  const u = r.skyMat.uniforms;
  // Per-mode env reflection strength for the PBR surfaces.
  const sea = r.world.sea ? r.world.sea.material : null;
  const terra = r.terrainMesh ? r.terrainMesh.material : null;
  const setEnv = (seaI, terraI) => {
    if (sea) sea.envMapIntensity = seaI;
    if (terra) terra.envMapIntensity = terraI;
  };
  if (mode === 'golden') {
    r.sun.color.set(0xffb36b); r.sun.intensity = 1.5; r.sun.position.set(1600, 320, 900);
    r.hemi.intensity = 0.45;
    u.uZenith.value.set(0x2e4d7d); u.uHorizon.value.set(0xf0a35e); u.uGround.value.set(0x4a3428);
    u.uSunColor.value.set(0xffb36b);
    u.uRayleigh.value = 0.7; u.uMieG.value = 0.86; u.uMieStrength.value = 1.9;
    r.scene.fog.color.set(0xe8a06a); r.scene.background.set(0xe8a06a);
    setEnv(0.9, 0.5);
    r.sunSprite.material.color.set(0xffc27a); r.sunSprite.material.opacity = 0.95;
    r.sunSprite.scale.set(520, 520, 1);
    r.haloSprite.material.color.set(0xff8a3c); r.haloSprite.material.opacity = 0.4;
    r.haloSprite.scale.set(1900, 1900, 1);
  } else if (mode === 'night') {
    r.sun.color.set(0x8fa8d8); r.sun.intensity = 0.25; r.sun.position.set(-800, 600, -400);
    r.hemi.intensity = 0.18;
    u.uZenith.value.set(0x060a18); u.uHorizon.value.set(0x1a2740); u.uGround.value.set(0x0a0f18);
    u.uSunColor.value.set(0x8fa8d8);
    u.uRayleigh.value = 0.25; u.uMieG.value = 0.8; u.uMieStrength.value = 0.35;
    r.scene.fog.color.set(0x101a2c); r.scene.background.set(0x101a2c);
    setEnv(0.15, 0.1);
    // Night sun is the moon: pale, smaller, dimmer halo.
    r.sunSprite.material.color.set(0xdfe8ff); r.sunSprite.material.opacity = 0.55;
    r.sunSprite.scale.set(300, 300, 1);
    r.haloSprite.material.color.set(0x8fa8d8); r.haloSprite.material.opacity = 0.16;
    r.haloSprite.scale.set(900, 900, 1);
  } else if (mode === 'storm') {
    r.sun.color.set(0x9aa5b5); r.sun.intensity = 0.7; r.sun.position.set(400, 900, -600);
    r.hemi.intensity = 0.35;
    u.uZenith.value.set(0x2c3440); u.uHorizon.value.set(0x6a7683); u.uGround.value.set(0x3a4450);
    u.uSunColor.value.set(0x9aa5b5);
    u.uRayleigh.value = 0.3; u.uMieG.value = 0.8; u.uMieStrength.value = 0.5;
    r.scene.fog.color.set(0x5a6675); r.scene.background.set(0x5a6675);
    setEnv(0.5, 0.3);
    r.sunSprite.material.color.set(0xcfd6de); r.sunSprite.material.opacity = 0.4;
    r.sunSprite.scale.set(420, 420, 1);
    r.haloSprite.material.color.set(0x9aa5b5); r.haloSprite.material.opacity = 0.18;
    r.haloSprite.scale.set(1400, 1400, 1);
  } else {
    r.sun.color.set(0xffe0b0); r.sun.intensity = 1.6; r.sun.position.set(1200, 900, 600);
    r.hemi.intensity = 0.7;
    u.uZenith.value.set(0x2f6cb0); u.uHorizon.value.set(0xbcd8ec); u.uGround.value.set(0x5a6a72);
    u.uSunColor.value.set(0xfff2c8);
    u.uRayleigh.value = REALISM.sky.rayleigh; u.uMieG.value = REALISM.sky.mieG; u.uMieStrength.value = REALISM.sky.mieStrength;
    r.scene.fog.color.set(0xa8c8de); r.scene.background.set(0xa8c8de);
    setEnv(1.0, 0.6);
    r.sunSprite.material.color.set(0xfff2c8); r.sunSprite.material.opacity = 0.85;
    r.sunSprite.scale.set(460, 460, 1);
    r.haloSprite.material.color.set(0xffe9a8); r.haloSprite.material.opacity = 0.3;
    r.haloSprite.scale.set(1500, 1500, 1);
  }
  // The sky shader's sun direction follows the light position — stored
  // on r.sunDir, since the light position itself goes plane-relative
  // every frame in updateScene.
  r.sunDir.copy(r.sun.position).normalize();
  u.uSunDir.value.copy(r.sunDir);
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
  // v5.17 Tier 2 — tight aircraft-centred shadow: the sun light and its
  // shadow target track the plane, so the 1024 map always covers the
  // +/-32 m around the aircraft at full resolution, wherever it flies.
  r.sun.position.copy(plane.position).addScaledVector(r.sunDir, REALISM.shadow.sunDistance);
  r.sun.target.position.copy(plane.position);
  r.sun.target.updateMatrixWorld();
  // v5.17 Tier 2 — articulated control surfaces, driven read-only from
  // the flight state (the physics never sees them move). Rates are
  // differenced per frame and smoothed, so the surfaces glide instead
  // of snapping. Sign conventions (plane faces +Z, right wing +X):
  // roll > 0 banks left (right wing rises), so the left aileron goes
  // up; pitch > 0 is nose down, so the elevator goes up when the pitch
  // rate is negative; heading increasing turns right, so the rudder's
  // trailing edge swings right (negative rotation about Y).
  const surf = plane.userData.surfaces;
  if (surf) {
    const prev = plane.userData.prevFlight || { roll: flight.roll, pitch: flight.pitch, heading: flight.heading };
    const dtSafe = Math.max(dt, 1e-3);
    const rollRate = (flight.roll - prev.roll) / dtSafe;
    const pitchRate = (flight.pitch - prev.pitch) / dtSafe;
    let dHdg = flight.heading - prev.heading;
    dHdg = ((dHdg + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const yawRate = dHdg / dtSafe;
    plane.userData.prevFlight = { roll: flight.roll, pitch: flight.pitch, heading: flight.heading };
    const sm = plane.userData.surfSmooth || (plane.userData.surfSmooth = { ail: 0, elev: 0, rud: 0, flap: 0, gear: 0 });
    const k = Math.min(1, dt * 6);
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    // Ailerons: bank left -> left aileron up (+rotation.x), right down.
    // The steady-bank term keeps a visible deflection while held in a
    // turn (a pure rate term would centre the moment the roll stops),
    // so the manoeuvre reads in a still screenshot, not just in motion.
    const ailTarget = clamp(rollRate * 0.9 + flight.roll * 0.3, 0.314);
    sm.ail += (ailTarget - sm.ail) * k;
    surf.aileronL.rotation.x = sm.ail;
    surf.aileronR.rotation.x = -sm.ail;
    // Elevator: pitch up (negative pitch rate) -> trailing edge up.
    const elevTarget = clamp(-pitchRate * 1.2 - flight.pitch * 0.3, 0.314);
    sm.elev += (elevTarget - sm.elev) * k;
    surf.elevator.rotation.x = sm.elev;
    // Rudder: turn right (heading increasing) -> trailing edge right.
    const rudTarget = clamp(-yawRate * 1.5, 0.3);
    sm.rud += (rudTarget - sm.rud) * k;
    surf.rudder.rotation.y = sm.rud;
    // Flaps: deployed -> trailing edge down, eased in over ~1 s.
    const flapTarget = flight.flaps ? -0.44 : 0;
    sm.flap += (flapTarget - sm.flap) * Math.min(1, dt * 3);
    surf.flapL.rotation.x = sm.flap;
    surf.flapR.rotation.x = sm.flap;
    // Gear: retracted only when the flight model says so AND airborne
    // (on the ground the plane must sit on its wheels).
    const gearTarget = (flight.gearDown || flight.onGround) ? 0 : -1.45;
    sm.gear += (gearTarget - sm.gear) * Math.min(1, dt * 2);
    surf.gearL.rotation.x = sm.gear;
    surf.gearR.rotation.x = sm.gear;
    surf.gearTail.rotation.x = sm.gear;
  }
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
  // Sea (v5.17): scroll the first wave normal map diagonally; the second
  // map scrolls the opposite way inside the shader, driven by uOceanTime,
  // which also animates the surf foam. The terrain ember clock rides
  // alongside it.
  if (r.world.sea) {
    const m = r.world.sea.material;
    if (m.normalMap) { m.normalMap.offset.x += dt * 0.008; m.normalMap.offset.y += dt * 0.005; }
    if (m.userData.shader) m.userData.shader.uniforms.uOceanTime.value = time;
  }
  if (r.terrainMesh && r.terrainMesh.material.userData.shader) {
    r.terrainMesh.material.userData.shader.uniforms.uTerraTime.value = time;
  }
  // Wingtip trails: feed the two wingtip positions while airborne and fast.
  updateTrails(r, flight, dt);
  // Takeoff dust on the ground roll.
  updateDust(r, flight, dt);

  // Sun disc + halo follow the camera on the sun direction (r.sunDir —
  // the light position itself is plane-relative since Tier 2).
  const sunDir = r.sunDir;
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
  } else if (cameraMode === 'orbit') {
    // v5 orbit camera (GeoFS free/orbit view, C cycles to it): the camera
    // slowly circles the plane at a fixed distance and height, always
    // looking at the aircraft — the view for admiring the aircraft and the
    // island from outside, and for seeing the autopilot fly the route.
    // The plane stays visible and the cockpit panel stays hidden, like the
    // chase view. The angle advances with the frame delta (game time, not
    // wall time), so a paused game holds its frame and the staged shots —
    // which never use this mode — are unaffected. One full circle takes
    // about 52 seconds at 0.12 rad/s.
    plane.visible = true;
    r.panelMesh.visible = false;
    r.orbitAngle += dt * 0.12;
    const R = 55, H = 16;
    r.camera.position.set(
      flight.x + Math.sin(r.orbitAngle) * R,
      flight.y + H,
      flight.z + Math.cos(r.orbitAngle) * R,
    );
    r.camera.up.copy(up);
    r.camera.lookAt(flight.x, flight.y + 1, flight.z);
    r.lookInit = false;
    // Orbit holds the base FOV, like the cockpit.
    r.fovSmooth += (62 - r.fovSmooth) * Math.min(1, dt * 3);
    if (Math.abs(r.camera.fov - r.fovSmooth) > 0.01) {
      r.camera.fov = r.fovSmooth;
      r.camera.updateProjectionMatrix();
    }
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
