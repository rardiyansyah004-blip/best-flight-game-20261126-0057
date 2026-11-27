// MERAPI AIRMAIL v5 — a 3D island flight game for make.fun
// Bounty: best-flight-game-20261126-0057 (Node 22, standard library only).
// The game lives in this directory's game/ folder: plain static files a
// desktop browser loads offline — game/index.html and its ES modules, with
// Three.js vendored as game/vendor/three.min.js and no network request at
// runtime. This program hands the game in: it copies game/ and screenshots/
// from beside this file into /output and writes /output/dossier.json, the
// summary the judge reads, using the vendored make.fun library
// (vendor/makefun-game.ts, copied unchanged from the kit).
//
// What is handed in: game/index.html + the source modules under game/src/
// (config, world, aircraft, flight, missions, render, hud, input, audio,
// shots, main, nav), the vendored Three.js build, and 4 screenshots taken
// from the game's own code (cover, nav, rings, night — see shots.json).
// v3 adds GeoFS material on top of the v2 Skyward flow: a navigation chart
// panel with autopilot (N / A), PAPI glide-slope lights on both runways,
// and elevator trim (Home/End) with a METAR weather report in the nav panel.
// v4 is a UI + graphics-feel revision only, on top of v3, after the user's
// feedback that the interface and graphics were still too stiff: softer
// rounded panels with slide/fade-in animations and eased dials/values, a
// spring-damped chase camera with a speed-based FOV kick, a visible sun
// with halo, wingtip trails, takeoff dust, drifting/bobbing clouds, rising
// volcano smoke, a shimmering sea, colour variation in the terrain, trees
// and houses, nav lights + a tail strobe, and a glow on the next ring gate.
// Every v3 feature is kept; nothing new is added. Everything is generated
// in code; the game makes no network requests.
// Backdrop blur was tried for the HUD and removed — it halved the frame
// rate in software rendering, so the soft look comes from gradients and
// shadows instead.
// v5 fixes the takeoff that never worked: the plane spawned 30 m before
// the far runway end and rolled at the ridge north of the field; it now
// spawns at the threshold end with the full 590 m of strip ahead, the
// ground no longer flickers under it below flying speed, and the
// autopilot joins the final through the final-approach fix when it is too
// high for a direct 3-degree glide path — so a full takeoff-to-landing
// run now completes. v5 also adds the GeoFS free/orbit camera: C cycles
// chase/cockpit/orbit. The 4 screenshots are unchanged (the staging is
// untouched) and every v3/v4 feature is kept.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse — more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files in all, or a path under game/ over 1000 bytes (game/ counts
// beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
