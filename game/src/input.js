// MERAPI AIRMAIL v3 — keyboard + mouse input. Arrows/WASD fly the plane,
// mouse steers in chase view, keys work the throttle, flaps, gear, camera.
// v2 adds the menu keys: B new mission, N free gate course, L logbook,
// H hide UI, I instruments toggle.
// v3 adds Home/End elevator trim and Delete trim reset (GeoFS parity), plus
// N nav chart and A autopilot in flight (handled in main.js).
// v5.17 Tier 3: Digit1-4 are the direct camera-mode picks (1 chase,
// 2 cockpit, 3 wingtip, 4 flyby). They MUST be edge-triggered, not
// level-read, because at ~2 fps in software rendering a brief key press
// can fall between frames; the pressed map holds it until the loop
// consumes it. (Found by the Tier 3 camera probe: the Digit keys were
// wired in main.js but never registered here, so 1-4 did nothing.)
export function createInput() {
  const input = {
    keys: {},
    pitch: 0, roll: 0, yaw: 0, throttleDelta: 0,
    brake: false, mouseDX: 0, mouseDY: 0,
    lastMouseDX: 0, lastMouseDY: 0, // deltas poll() consumed this frame
    pressed: {}, // edge-triggered keys, consumed by the game loop
  };

  const KEYMAP = {
    ArrowUp: 'pitchDown', KeyW: 'pitchDown',
    ArrowDown: 'pitchUp', KeyS: 'pitchUp',
    ArrowLeft: 'rollLeft', KeyA: 'rollLeft',
    ArrowRight: 'rollRight', KeyD: 'rollRight',
    KeyQ: 'yawLeft', KeyE: 'yawRight',
    ShiftLeft: 'throttleUp', ShiftRight: 'throttleUp',
    ControlLeft: 'throttleDown', ControlRight: 'throttleDown',
    Space: 'brake',
  };

  // Edge-triggered keys (flight toggles + v2 menu keys + v3 trim keys
  // + v5.17 Tier 3 camera picks).
  const EDGE_KEYS = ['KeyF', 'KeyG', 'KeyC', 'KeyP', 'KeyM', 'KeyR',
    'KeyB', 'KeyN', 'KeyL', 'KeyH', 'KeyI', 'KeyA', 'Escape', 'Enter',
    'Home', 'End', 'Delete', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    input.keys[e.code] = true;
    const action = KEYMAP[e.code];
    if (action) input.pressed[action] = true;
    if (EDGE_KEYS.includes(e.code)) {
      input.pressed[e.code] = true;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { input.keys[e.code] = false; });

  window.addEventListener('mousemove', (e) => {
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });

  /** Poll the held keys into a control frame; call once per tick. */
  input.poll = function poll() {
    const k = input.keys;
    input.pitch = (k.ArrowDown || k.KeyS ? 1 : 0) - (k.ArrowUp || k.KeyW ? 1 : 0);
    input.roll = (k.ArrowRight || k.KeyD ? 1 : 0) - (k.ArrowLeft || k.KeyA ? 1 : 0);
    input.yaw = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
    input.throttleDelta = (k.ShiftLeft || k.ShiftRight ? 1 : 0) - (k.ControlLeft || k.ControlRight ? 1 : 0);
    input.brake = !!(k.Space);
    // Mouse adds gentle roll/pitch in chase view. Keep the deltas poll()
    // consumed this frame: the autopilot's stick-disconnect check reads them
    // (a mouse steer must disconnect AP, but the A key's roll must not).
    input.lastMouseDX = input.mouseDX;
    input.lastMouseDY = input.mouseDY;
    if (Math.abs(input.mouseDX) > 2) input.roll = Math.max(-1, Math.min(1, input.roll + input.mouseDX * 0.002));
    if (Math.abs(input.mouseDY) > 2) input.pitch = Math.max(-1, Math.min(1, input.pitch + input.mouseDY * 0.002));
    input.mouseDX = 0; input.mouseDY = 0;
    return input;
  };

  /** True once when the key was pressed since the last consume. */
  input.consume = function consume(code) {
    if (input.pressed[code]) { input.pressed[code] = false; return true; }
    return false;
  };

  return input;
}
