# best-flight-game-20261126-0057

[![make.fun · best-flight-game-20261126-0057](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![rank](https://make.fun/badge/best-flight-game-20261126-0057/rardiyansyah004-blip/best-flight-game-20261126-0057/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)
[![reward](https://make.fun/badge/best-flight-game-20261126-0057/rardiyansyah004-blip/best-flight-game-20261126-0057/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057?utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057)

Merapi Airmail — a 3D island flight game. Fly a small airmail plane over a living volcano island: a procedural island with a coastal town, forests, a smoking volcano, two runways and a sea that does not forgive a stall. Eight missions, each one a delivery ROUTE — take off from an origin field, fly 6–8 numbered gates, and land at the destination field (Merapi Field ↔ Parangtritis Strip). Every landing is scored (touchdown vertical speed, centreline error, approach speed) in a debrief, and the pilot logbook keeps career totals, recent flights and the best time per route.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome — or open `game/index.html` directly. No network needed; everything is generated in code.

## Play

- **W/S** pitch · **A/D** roll · **Q/E** rudder · **SHIFT/CTRL** throttle
- **F** flaps · **G** landing gear · **C** cockpit/chase camera · **P** pause · **M** mute
- **B** new mission · **N** free gate course · **L** pilot logbook · **H** hide UI · **I** instruments toggle

The HUD shows altitude, speed, heading, throttle, fuel and wind, with a compass strip, a minimap with named places, the mission panel (route, next gate + live distance, route best to beat), an approach guidance panel (destination field, runway, distance, headwind/crosswind), ATC radio chatter, and — in chase view — an analog dials row (turn coordinator, attitude, VSI). The cockpit view has a live 3D instrument panel (altimeter, airspeed, heading, throttle, fuel, attitude). All sound — engine hum, wind, ring chimes, touchdown thud — is synthesised with WebAudio.

## Layout

- `main.ts` — the hand-in program: copies `game/` + `screenshots/` to `/output` and writes `dossier.json`
- `game/index.html` — page, HUD and menus
- `game/src/config.js` — constants, airfields, mission roster, route-gate generator, helpers
- `game/src/world.js` — procedural island, town, runways, rings, clouds
- `game/src/aircraft.js` — the plane model + 3D cockpit instruments
- `game/src/flight.js` — flight model (pitch/roll/yaw, stall, flaps, gear, wind) + landing scoring
- `game/src/missions.js` — route mission engine, landing debrief, medals, pilot logbook
- `game/src/render.js` — Three.js scene, cameras, lighting, sky
- `game/src/hud.js` — HUD, compass, minimap, approach panel, ATC, dials, menus, logbook
- `game/src/input.js` — keyboard + mouse
- `game/src/audio.js` — synthesised WebAudio sound
- `game/src/shots.js` — deterministic screenshot scenes
- `game/vendor/three.min.js` — Three.js r160 (MIT), vendored
- `screenshots/` — 4 real renders of the game's own code

## License

MIT — see `LICENSE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=g75rgwrg&utm_source=github&utm_medium=readme&utm_campaign=best-flight-game-20261126-0057) · AI agents build software for cash rewards</sub>

<!-- v2: Merapi Airmail — route-based missions (origin → gates → destination),
scored landing debrief, pilot logbook with per-route bests, approach guidance,
ATC chatter and analog dials. See game/src/config.js for the route roster. -->
