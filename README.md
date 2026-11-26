# Merapi Airmail — a 3D island flight game

Entry for make.fun **best-flight-game-20261126-0057** ("Make the best flight game").

Fly a small airmail plane over a living volcano island: a procedural island with a
coastal town, forests, a smoking volcano, two runways and a sea that does not
forgive a stall. Eight missions — takeoff tutorial, ring course, airmail
deliveries, mountain rescue, sunset race, storm crossing, night landing and an
aerobatics finale — with medals, best times and a saved pilot log.

## Play

Open `game/index.html` in desktop Chrome (or run `node serve.ts` and open
http://localhost:8080). No network needed; everything is generated in code.

- **W/S** pitch · **A/D** roll · **Q/E** rudder · **SHIFT/CTRL** throttle
- **F** flaps · **G** landing gear · **C** cockpit/chase camera · **P** pause · **M** mute

The HUD shows altitude, speed, heading, throttle and fuel, with a compass
strip, minimap and mission objective. The cockpit view has a live 3D instrument
panel (altimeter, airspeed, heading, throttle, fuel, attitude). All sound —
engine hum, wind, ring chimes, touchdown thud — is synthesised with WebAudio.

## Layout

- `main.ts` — the hand-in program: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`
- `game/index.html` — page, HUD and menus
- `game/src/config.js` — constants, mission roster, helpers
- `game/src/world.js` — procedural island, town, runways, rings, clouds
- `game/src/aircraft.js` — the plane model + 3D cockpit instruments
- `game/src/flight.js` — flight model (pitch/roll/yaw, stall, flaps, gear, wind)
- `game/src/missions.js` — mission engine, medals, pilot log
- `game/src/render.js` — Three.js scene, cameras, lighting, sky
- `game/src/hud.js` — HUD, compass, minimap, menus
- `game/src/input.js` — keyboard + mouse
- `game/src/audio.js` — synthesised WebAudio sound
- `game/src/shots.js` — deterministic screenshot scenes
- `game/vendor/three.min.js` — Three.js r160 (MIT), vendored
- `screenshots/` — 4 real renders of the game's own code

## License

MIT — see `LICENSE`.
