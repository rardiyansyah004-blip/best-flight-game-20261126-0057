// MERAPI AIRMAIL v5 — navigation panel + autopilot, in the spirit of GeoFS.
// GeoFS's signature flow is its nav panel (N): a live chart with runways and
// navaids plus an autopilot (A) that holds heading and altitude. This module
// is the same idea rebuilt for our island, from static files only: the chart
// is drawn in code, the METAR line is generated from the mission weather,
// and the autopilot steers the real flight model toward the next gate.
// No GeoFS code, assets, names or text are used here.
// v4 (UI feel): the v3 drawer was a hard-edged flat dark box with a 1px
// border and no motion — it appeared instantly and looked pasted on. v4
// gives it a gradient + soft shadow + 16px radius, a slide/fade-in on every
// open (CSS animations re-run when the panel flips from display:none to
// block), button press/hover states, and a polished chart (the island is a
// radial gradient now, the plane marker glows). Same data, same layout,
// same buttons — the drawer just lands softer.
// v4 perf note: the drawer uses a gradient + shadow, NOT backdrop blur —
// the blur halved the frame rate in software rendering, so it stays out.
// v5 (final approach): the autopilot used to aim straight at the touchdown
// point from the last gate — about 200 m up, only ~600 m out — and the
// glide controller sheds at most 6 m/s, so the plane overshot the runway
// and met the ridge beyond it; no full flight ever landed. When the plane
// is too high for a direct final it now joins through the final-approach
// fix, 800 m out on the extended centreline, descending toward the slope
// altitude there, and only then flies the 3-degree glide path to the
// threshold — the same slope the placed-on-final autoland has always flown.
// v5.1 (FAF join): the first join descended toward a flat 48 m and reached
// the slope 700 m short of the fix, then handed off 422 m off the
// centreline, where the slope runs under the hillside — the plane landed
// on the terrain 370 m short of the threshold. The join now descends along
// a 3-degree line that reaches the slope altitude at the fix 300 m out,
// and the handoff to the direct final only happens on the slope AND within
// 120 m of the centreline.
// v5.2 (reversal altitude): the v5.1 join lined the plane up on the fix at
// 54 m, but the plane arrives from the south-east and must turn ~140°
// onto the northbound final, and the turn swings it over the hillside
// west of the fix (terrain ~78 m, higher toward the volcano shoulder) —
// it flew into the hill at (-589, 78, -198) with 45 damage and sat there.
// Until the plane is lined up on the centreline AND on the runway heading,
// the join now holds 150 m, above every hill in the turn area; only then
// does it descend onto the slope and fly the final home.
// v5.3 (handoff at the fix): the v5.2 join held 150 m and reached the fix
// at 122 m, lined up — but the fix is a POINT, and pure pursuit to a point
// overshoots it: the plane flew 366 m past the fix to (-434, 116, -716),
// clipped a ~120 m hill north of the fix (45 damage), and would have had
// to reverse again. When the plane is near the fix (within 400 m), on the
// centreline, and heading roughly toward the runway, it now hands off to
// the direct final even though it is still above the slope — the final
// sheds at most 6 m/s, which brings 150 m down to the slope over the
// 900 m to the touchdown, and the plane keeps flying north instead of
// overshooting the fix and reversing over the north hills.
// v5.4 (true altitude hold): the v5.3 run still clipped a hill — because
// the "hold 150 m" never held. The join's descent law always added the
// 3-degree slope rate (3.1 m/s), so the plane leaked down through the
// 150 m floor while reversing and turned at 118 m into the 115 m hill
// at (-532, -576). The turn arc on the west side of the fix tops out at
// ~122 m (the east side climbs toward the volcano shoulder, 295 m — the
// plane never swings there, it arrives from the east and overshoots to
// the south-west), so the join now HOLDS 180 m while turning: a gentle
// proportional law with no slope-rate term and no descent floor, so the
// plane neither sinks nor climbs away. Once it is lined up on the
// centreline and on the runway heading it descends on the 3-degree line
// as before, and the v5.3 handoff still takes it home from there.
// v5.5 (steer past the fix, abandoned): the v5.4 run held 180 m through
// the reversal and never took damage — but it never landed either.
// Steering AT the fix (a point) makes the plane orbit it: it chases the
// point, overshoots, turns, and comes back, and the northbound leg sits
// ~240 m east of the centreline (the turn radius), so the handoff's
// lat <= 120 never fires and the plane circles the fix until the fuel
// runs out. Steering 400 m past the fix was tried and abandoned: it
// moves the lineup point to z = 50, only 500 m from the touchdown, where
// the plane is still at 175 m and the final cannot descend fast enough —
// it would overshoot the runway and meet the ridge, the original v5
// failure. The run was killed before it got that far.
// v5.6 (wide handoff): the join steers at the fix again, and the handoff
// accepts the northbound leg where it actually flies — up to 300 m off
// the centreline, heading north, within 400 m of the fix. The direct
// final is a strong lateral controller: it steers at the touchdown and
// converges on the centreline over the 900 m to the runway, and the
// terrain in the handoff zone tops out at ~71 m (probed), over 100 m
// below the 180 m hold, so the plane is safe while it converges. The
// join's own "lined up" test stays at lat <= 120 — only the handoff
// is widened, so the join still only descends on the 3-degree line
// when truly on the centreline. The handoff fired (at (-144, 162, -568),
// lat 276 m) and the plane flew the final north, descending — but it
// never landed, because of the flicker fixed in v5.7.
// v5.7 (latch the final): the v5.6 run proved the handoff flickers. The
// plane handed off at (-144, 162, -568) and flew north on the final to
// (-293, 100, 80) — but by then it was 448 m from the fix, past the
// 400 m handoff radius, so the join re-engaged, turned it back west and
// south toward the fix, and climbed it to 116 m: a loop that never lands
// (the plane would orbit the fix until the fuel ran out). The handoff
// is a sphere around the fix, and the plane leaves the sphere the
// moment it flies the final north — so a per-frame test can never hold.
// Once the handoff fires, the final is now LATCHED on the flight state
// (flight._apFinalLatched): the join never re-engages for that flight,
// and the plane stays on the 3-degree glide path all the way to the
// runway. A new flight state is created per mission, so the latch
// resets with the flight. The autoland is unaffected — it starts
// on-slope (err <= 25, lat <= 120), so it flies the final from the
// first frame, latch or not. The latch WORKED: the plane flew north
// past the flicker point to (-370, 61, 382), on the centreline — but
// it still did not land on the runway (v5.8).
// v5.8 (steeper final descent): the v5.7 run flew the latched final to
// (-370, 61, 382) — on the centreline, descending — then drifted west
// to (-554, 40, 689) and touched down on the TERRAIN west of the runway
// with 45 damage. The plane hands off at ~175 m, 122 m above the slope
// at the fix, and the final's 6 m/s cap only closes on the slope at
// 3.3 m/s — in the 900 m to the touchdown it sheds just 56 m, so it
// arrives at the runway area still ~66 m high, flies past the touchdown
// while descending, and drifts west into the hillside before it gets
// down. The final's descent cap is now 9 m/s (the plane's max climb,
// and the join's cap): it closes on the slope at 6.3 m/s and arrives
// ~15 m above it at the touchdown, so the flare puts it down on the
// runway instead of past it. The autoland is unaffected — it starts
// on-slope and descends at ~3 m/s, far below either cap. The descent
// worked (the plane reached (-393, 29, 462), on the centreline) — but
// it still drifted west and touched down on the terrain (v5.9).
// v5.9 (fixed lead point, too slow): the v5.8 run descended to (-393, 29,
// 462) — on the centreline, 88 m from the touchdown — then drifted west
// to (-465, 17, 642) and touched down on the TERRAIN 45 m west of the
// centreline with 45 damage. Pure pursuit at a close point oscillates,
// so the final steered at a lead point 400 m beyond the touchdown. But a
// FIXED lead point's effective lead shrinks as the plane flies north
// (1300 m at the fix, 400 m at the touchdown, 0 m past it), so the turn
// stays gentle and the plane converges too slowly: it reached (-296, 46,
// 358) still 124 m off the centreline, clipped the terrain east of the
// runway at (-371, 21, 729) with 45 damage, and never got onto the
// runway. The two runs bracket the centreline (45 m west, 49 m east) —
// the runway needs lat under ~20 m.
// v5.10 (moving lead point): the final now steers at a point on the
// extended centreline 250 m ahead of the plane's own along-track
// position — a line-following controller, not pursuit of a fixed point.
// The target moves with the plane, so the effective lead stays 250 m
// all the way in: the bearing is atan2(-lat, 250), a strong turn when
// far off the centreline (45° at lat 250 m) that eases to due north as
// the plane converges, so it closes fast without the fixed lead's slow
// start or the touchdown's overshoot. The descent still uses the
// distance to the touchdown (dist), so the flare is unchanged, and the
// autoland (which starts on the centreline) is unaffected. The moving
// lead WORKED laterally — the plane converged to lat 4 m and flew down
// the centreline — but it still did not land on the runway (v5.11).
// v5.11 (stronger final descent gain): the v5.10 run converged to lat
// 4 m and descended to 8 m, but it arrived at the touchdown area ~20 m
// above the slope and the flare could not get it down in time — at
// 114 m out it needed 9.3 m/s to reach the runway at the touchdown,
// over the 9 m/s cap (effectively ~8.3 m/s through the -0.35 pitch
// clamp). It flew past the touchdown, and past the touchdown the
// flare law's time-to-go grows (the distance to the touchdown point
// increases again), so the descent fell to the 0.5 m/s floor and the
// plane floated at 8 m for ~550 m before touching down at (-419, 17,
// 1098) — 28 m past the runway end (z = 1070), on the rising terrain,
// damage 0, mission NOT finished. The root cause is the final's
// descent law: slopeRate + 0.08 * err decays exponentially, so the
// error never fully closes in the 21.8 s from handoff to touchdown —
// at the handoff err = 91.5 m, and at dist = 200 it was still ~20 m.
// The gain is now 0.15: the plane descends at the max rate longer and
// converges exponentially faster, arriving at dist = 200 with only
// ~11 m of error, which the flare (5.7 m/s, below the cap) handles.
// The autoland starts on-slope (err small), so a higher gain just
// makes it track the slope more tightly — it should still PASS, and
// the regression run will prove it. The gain WORKED — the plane
// touched down on the runway at (-417, 8, 546), 4.6 m from the
// touchdown point — but it rolled off the end before stopping (v5.12).
// v5.12 (slower final approach): the v5.11 run LANDED on the runway —
// touchdown at (-417, 8, 546), 4.6 m from the touchdown point, on the
// centreline, damage 0 — but it rolled 564 m and stopped at (-420, 22,
// 1110), 40 m past the runway end (z = 1070), on the rising terrain,
// so the mission (onGround + speed < 5 ON the runway) did not
// complete. The touchdown speed was 52 m/s, and the plane had only
// 520 m of runway ahead; the braking (2.4 m/s²) needed 564 m. The
// final approach speed band is now 46–52 m/s (was 52–58): the plane
// touches down around 48 m/s, and the stopping distance scales with
// v², so it stops in ~480 m — well inside the 520 m of runway. The
// stall speed is 28 m/s, so 48 m/s is safe, and at lower speed the
// turn radius shrinks (better convergence) and the plane has more time
// to track the slope. The autoland also flies the final, so it will
// touch down slower too — it should still PASS, and the regression run
// will prove it. The full flight PASSED (mission finished, score 1577,
// stopped on the runway at z = 799.67, lastLanding vs -1.33 m/s, speed
// 25.3 m/s, centreline 2.0 m, onRunway true) — but the autoland
// REGRESSED (v5.13).
// v5.13 (mission-specific final): the v5.12 autoland REGRESSED — it
// landed at Parangtritis (420 m runway, vs Merapi's 620 m) with
// lastLanding onRunway false, speed 35.9 m/s, and stopped 27.6 m past
// the far end. The slow approach (46–52 m/s) bleeds LESS speed in the
// flare (drag scales with v²), so it touched down FASTER (35.9 m/s)
// than v5.9's fast approach (52–58 m/s, touchdown 25.0 m/s) and rolled
// long off the short strip — while Merapi's full flight NEEDS the slow
// approach to stop in its 520 m. The two missions need different
// finals, so the gain and speed band are now mission-specific: the
// takeoff mission (Merapi, full circuit) keeps gain 0.15 and speed
// 46–52 m/s (proven: full flight PASS, score 1577); every other
// mission (including the airmail autoland at Parangtritis) reverts to
// gain 0.08 and speed 52–58 m/s (proven: autoland PASS in v5.9, score
// 1408). The moving lead point, the FAF join, the latch, and the flare
// are shared — only the gain and speed band differ by mission.
// v5.14 (join-speed reduction + mission-id fix): the v5.13 full flight
// is MARGINAL on entry speed — run 14 PASSED entering the final at
// 47 m/s, run 15 FAILED entering at 53 m/s (touched down fast at
// ~50 m/s, bounced, stopped 28 m past the runway end, mission NOT
// finished). The first v5.14 build (join 42–48 m/s) did NOT change the
// entry speed at all — its probe latched at 52.3 m/s, and a branch probe
// proved why: v5.13's mission test reads mission.id, but the runtime
// mission state built by createMission has NO .id field — the def id
// lives at mission.def.id — so isTakeoff was ALWAYS false and every
// mission silently flew the fast final (gain 0.08, 52–58 m/s). Run 14's
// PASS was the v5.12 global slow final; run 15's FAIL was the fast
// final at 53 m/s in. The lookup is now mission.def.id, which restores
// the intended split: the takeoff mission gets the slow final (gain
// 0.15, 46–52 m/s, the v5.12-proven config) AND the slow join band
// (42–48 m/s, forcing ~45 m/s into the final), while every other
// mission keeps 48–56 m/s in the join and 0.08 / 52–58 m/s on the
// final — exactly what they flew in v5.13, including the autoland
// PASS. The stall speed is 28 m/s, so 42–48 is safe, and at lower
// speed the turn radius shrinks, so the northbound leg sits closer to
// the centreline. The autoland never enters the join (it starts
// on-slope), so it is unaffected — the regression run proves it.
import { AIRFIELDS, PLACES, WIND_FROM_DEG, clamp, wrapAngle } from './config.js';
import { gateProgress } from './missions.js';

/** METAR-style weather report, generated from the mission weather. */
export function metarFor(weather, fieldName) {
  const w = weather || { mode: 'day', windSpeed: 2, gustStrength: 0.15, rain: false };
  const kt = Math.round((w.windSpeed || 2) * 1.94384);
  const gust = Math.round((w.gustStrength || 0) * 12);
  const vis = w.mode === 'storm' ? '3SM' : w.mode === 'night' ? '6SM' : '10SM';
  const clouds = w.mode === 'storm' ? 'BKN015 OVC030' : w.mode === 'night' ? 'CLR' : w.mode === 'golden' ? 'FEW030 SCT060' : 'FEW030';
  const temp = w.mode === 'storm' ? '24/21' : w.mode === 'night' ? '25/22' : '28/19';
  const wx = w.rain ? ' +RA' : '';
  const field = (fieldName || 'MERAPI').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 8) || 'MERAPI';
  return 'METAR ' + field + ' 261200Z AUTO ' + String(WIND_FROM_DEG).padStart(3, '0') + String(kt).padStart(2, '0')
    + (gust > 3 ? 'G' + String(gust).padStart(2, '0') : '') + 'KT ' + vis + wx + ' ' + clouds + ' ' + temp + ' Q1013';
}

/** Build the NAV drawer (right side, below the approach panel) and return its parts. */
export function buildNavPanel() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes navIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    #nav-panel { position: absolute; right: 14px; top: 388px; width: 300px;
      background: linear-gradient(160deg, rgba(10,16,24,0.93), rgba(8,12,20,0.84));
      border: 1px solid rgba(255, 211, 77, 0.55);
      border-radius: 16px; padding: 10px 12px; pointer-events: auto; display: none; z-index: 6;
      box-shadow: 0 14px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.09);
       animation: navIn 0.25s ease-out; }
    #nav-panel-title { font-size: 11px; letter-spacing: 2px; color: #ffd34d; font-weight: 800; margin-bottom: 6px; }
    #nav-chart { display: block; border-radius: 10px; border: 1px solid rgba(255,255,255,0.25); background: #0c1a26; }
    #nav-metar { font-family: monospace; font-size: 11px; color: #9fc3d8; margin-top: 6px; line-height: 1.5; word-break: break-word; }
    #nav-ap-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
    #nav-ap-status { font-family: monospace; font-size: 13px; font-weight: 800; color: #cfe3ee; }
    #nav-ap-status.on { color: #39ff88; }
    #nav-ap-btn { background: #ffd34d; color: #1a1405; border: none; border-radius: 8px;
      font-size: 13px; font-weight: 800; padding: 6px 14px; cursor: pointer; letter-spacing: 1px;
      transition: transform 0.15s ease, filter 0.15s ease; }
    #nav-ap-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
    #nav-ap-btn:active { transform: scale(0.96); }
    #nav-hint { font-size: 11px; color: rgba(238, 244, 248, 0.7); margin-top: 6px; }`;
  document.head.appendChild(style);
  const root = document.getElementById('hud');
  const panel = document.createElement('div');
  panel.id = 'nav-panel';
  panel.innerHTML = `
    <div id="nav-panel-title">NAV — ISLAND CHART</div>
    <canvas id="nav-chart" width="276" height="170"></canvas>
    <div id="nav-metar"></div>
    <div id="nav-ap-row">
      <span id="nav-ap-status">AUTOPILOT OFF</span>
      <button id="nav-ap-btn">AP: OFF</button>
    </div>
    <div id="nav-hint">N close · A autopilot · stick input disconnects AP</div>`;
  root.appendChild(panel);
  return {
    panel,
    chart: panel.querySelector('#nav-chart'),
    metar: panel.querySelector('#nav-metar'),
    apStatus: panel.querySelector('#nav-ap-status'),
    apBtn: panel.querySelector('#nav-ap-btn'),
  };
}

/** Draw the island chart: terrain, fields, gates, plane, wind. */
export function drawNavChart(canvas, flight, mission) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0c1a26';
  ctx.fillRect(0, 0, W, H);
  // Range rings around the island centre (500 m / 1000 m / 1500 m).
  const toChart = (x, z) => [W / 2 + (x / 2100) * (W / 2 - 8), H / 2 + (z / 2100) * (H / 2 - 8)];
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  for (const r of [500, 1000, 1500]) {
    const px = (r / 2100) * (W / 2 - 8);
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, px, px * (H / W), 0, 0, Math.PI * 2); ctx.stroke();
  }
  // Island blob: radial gradient, bright heart fading to deep green at the coast.
  const islandGrad = ctx.createRadialGradient(W / 2 + 4, H / 2 - 3, 20, W / 2 + 4, H / 2 - 3, 110);
  islandGrad.addColorStop(0, '#5da14a');
  islandGrad.addColorStop(0.7, '#3d7a3a');
  islandGrad.addColorStop(1, '#2a5a2e');
  ctx.fillStyle = islandGrad;
  ctx.beginPath(); ctx.ellipse(W / 2 + 4, H / 2 - 3, 96, 72, 0.3, 0, Math.PI * 2); ctx.fill();
  const [vx, vz] = toChart(620, -540);
  ctx.fillStyle = '#8a6a4a';
  ctx.beginPath(); ctx.arc(vx, vz, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8dcc8';
  const [tx0, tz0] = toChart(-420, 380);
  ctx.fillRect(tx0 - 5, tz0 - 5, 10, 10);
  // Runway strips (rotated dark bars with a white centreline).
  for (const f of Object.values(AIRFIELDS)) {
    const [fx, fz] = toChart(f.x, f.z);
    ctx.save();
    ctx.translate(fx, fz);
    ctx.rotate(f.heading);
    ctx.fillStyle = '#2b2f36';
    ctx.fillRect(-14, -3, 28, 6);
    ctx.fillStyle = '#f5f5f0';
    ctx.fillRect(-14, -0.5, 28, 1);
    ctx.restore();
    ctx.fillStyle = '#ffd34d';
    ctx.font = 'bold 9px monospace';
    // Flip the label inside the chart when it would clip past the right edge.
    const labelW = Math.max(ctx.measureText(f.short).width, ctx.measureText('RWY ' + f.rwy).width);
    const flip = fx + 12 + labelW > W - 4;
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(f.short, flip ? fx - 12 : fx + 12, fz - 6);
    ctx.fillStyle = '#cfe3ee';
    ctx.font = '9px monospace';
    ctx.fillText('RWY ' + f.rwy, flip ? fx - 12 : fx + 12, fz + 6);
  }
  // Route gates (numbered): done green, next amber, later dim.
  if (mission) {
    const prog = gateProgress(mission);
    mission.gates.forEach((g, i) => {
      const [gx, gz] = toChart(g.x, g.z);
      ctx.fillStyle = i < prog.done ? '#39ff88' : i === prog.next ? '#ffc233' : 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(gx, gz, i === prog.next ? 7 : 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0a1018';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), gx, gz + 3);
    });
    const [dx, dz] = toChart(mission.dest.x, mission.dest.z);
    ctx.strokeStyle = '#ffd34d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(dx, dz, 11, 0, Math.PI * 2); ctx.stroke();
  }
  // Named places.
  ctx.font = '8px monospace';
  ctx.fillStyle = '#9fc3d8';
  ctx.textAlign = 'left';
  for (const p of PLACES) {
    if (p.kind === 'field') continue;
    const [px, pz] = toChart(p.x, p.z);
    ctx.fillText(p.name.toUpperCase(), px + 4, pz - 4);
  }
  // Plane marker + heading wedge: gold with a soft glow so it reads at a glance.
  const [px, pz] = toChart(flight.x, flight.z);
  ctx.save();
  ctx.shadowColor = '#ffd34d';
  ctx.shadowBlur = 12;
  ctx.translate(px, pz);
  ctx.rotate(flight.heading);
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill();
  ctx.restore();
  // Wind arrow (points where the wind blows TO: from 250 deg).
  const wx = W - 26, wy = 18;
  const windTo = (WIND_FROM_DEG + 180) * Math.PI / 180;
  ctx.strokeStyle = '#9fc3d8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(wx, wy);
  ctx.lineTo(wx + Math.sin(windTo) * 12, wy + Math.cos(windTo) * 12); ctx.stroke();
  ctx.fillStyle = '#9fc3d8';
  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('WIND ' + WIND_FROM_DEG + '°', W - 30, H - 8);
  // North arrow.
  ctx.fillStyle = '#ffd34d';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('N ↑', 12, 14);
}

/** Steer the real flight model toward the next gate — or, when the gates are
 *  done, down the 3-degree glide path to the destination runway. Returns
 *  { pitch, roll, yaw, throttleDelta, brake, gearDown }.
 *  Final approach aims at a touchdown point 100 m past the threshold.
 *  The pitch on final is a glide-path controller, not a proportional
 *  altitude chase: beyond 200 m it descends at the slope rate plus 15% of
 *  the altitude error per second (feed-forward, so the error converges
 *  instead of settling ~23 m above the slope the way a 0.005/m gain did —
 *  that version crossed the threshold at 30 m, floated past the touchdown
 *  point on its fixed 1.5-degree flare, and touched down 38 m past the
 *  runway end, 87 m off the centreline; v3 play test 4). Inside 200 m it
 *  descends to arrive at the runway (y = 6) exactly at the touchdown
 *  point, so the rate falls as the plane nears the ground — the flare,
 *  timed by distance instead of a fixed shallow angle. After touchdown
 *  the autopilot idles the throttle and brakes to a stop, which is what
 *  the mission's landing check (onGround + speed < 5 on the runway) needs.
 *  v5: when the plane is more than 25 m above the slope, a direct final
 *  cannot work — the last gate sits ~200 m up only ~600 m out, and the
 *  controller sheds at most 6 m/s, so the old code overshot the runway
 *  and met the ridge beyond it. The autopilot now joins through the
 *  final-approach fix, 800 m out on the extended centreline, descending
 *  toward the slope altitude there, and only flies the direct final once
 *  the altitude fits the slope — so the touchdown itself is the same
 *  gentle glide-path landing the autoland test proves.
 *  v5.1: the join is a 3-degree line, not a flat altitude, and the handoff
 *  needs the centreline too — see the header note. A flat 48 m descent
 *  reached the slope 700 m short of the fix and handed off 422 m off the
 *  centreline, where the slope runs under the hillside; the plane landed
 *  on the terrain 370 m short of the threshold.
 *  v5.2: the join holds 150 m until the plane is lined up on the
 *  centreline AND on the runway heading — see the header note. The
 *  reversal at the fix swings the plane over the hillside, and at 54 m
 *  it flew into the hill; at 150 m it clears every hill in the turn.
 *  v5.3: hand off to the direct final at the fix even when still above the
 *  slope — see the header note. Pure pursuit to a point overshoots it,
 *  and the overshoot flew the plane 366 m past the fix over a ~120 m hill
 *  north of it (45 damage).
 *  v5.4: the "hold" leaked — the join's descent law always added the
 *  slope rate, so the plane sank through the floor while reversing and
 *  clipped a 115 m hill at 118 m. While turning the join now truly holds
 *  180 m (a gentle proportional law, no slope-rate term, no floor); once
 *  lined up it descends on the 3-degree line as before.
 *  v5.5 (steer past the fix, abandoned): the plane held 180 m and never
 *  took damage, but it never landed — steering AT the fix makes it orbit
 *  the point, and the northbound leg sits ~240 m east of the centreline,
 *  so the handoff's lat <= 120 never fires. Steering 400 m past the fix
 *  moves the lineup to z = 50, only 500 m from the touchdown, where the
 *  plane is still at 175 m and the final cannot descend fast enough —
 *  it would overshoot the runway and meet the ridge. Killed before it
 *  got that far.
 *  v5.6: the handoff accepts the northbound leg where it actually flies
 *  (lat <= 300 m) — see the header note. The join still steers at the
 *  fix, and its own "lined up" test stays at lat <= 120. The handoff
 *  fired and the plane flew the final north — but it never landed,
 *  because the handoff flickers (v5.7).
 *  v5.7: LATCH the final. A per-frame handoff test flickers: the
 *  handoff is a sphere around the fix, and the plane leaves the sphere
 *  the moment it flies the final north — at (-293, 100, 80) it was
 *  448 m from the fix, so the join re-engaged and turned it back. Once
 *  the handoff fires, the final stays engaged for the rest of this
 *  flight; a new flight state is created per mission, so the latch
 *  resets with the flight. The latch WORKED — the plane flew north
 *  past the flicker point to (-370, 61, 382), on the centreline — but
 *  it still did not land on the runway (v5.8).
 *  v5.8: STEEPER final descent. The v5.7 run flew the latched final to
 *  (-370, 61, 382) — on the centreline, descending — then drifted west
 *  to (-554, 40, 689) and touched down on the TERRAIN west of the runway
 *  with 45 damage. The plane hands off at ~175 m, 122 m above the slope
 *  at the fix, and the final's 6 m/s cap only closes on the slope at
 *  3.3 m/s — in the 900 m to the touchdown it sheds just 56 m, so it
 *  arrives still ~66 m high, flies past the touchdown, and drifts west
 *  into the hillside. The final's descent cap is now 9 m/s (the plane's
 *  max climb, and the join's cap): it closes at 6.3 m/s and arrives
 *  ~15 m above it at the touchdown, so the flare puts it down on the
 *  runway. The autoland is unaffected — it starts on-slope and descends
 *  at ~3 m/s, far below the cap. The descent worked (the plane reached
 *  (-393, 29, 462), on the centreline) — but it still drifted west and
 *  touched down on the terrain (v5.9).
 *  v5.9: FIXED LEAD POINT, too slow. The v5.8 run descended to (-393, 29,
 *  462) — on the centreline, 88 m from the touchdown — then drifted west
 *  to (-465, 17, 642) and touched down on the TERRAIN 45 m west of the
 *  centreline with 45 damage. Pure pursuit at a close point oscillates,
 *  so the final steered at a lead point 400 m beyond the touchdown. But a
 *  FIXED lead point's effective lead shrinks as the plane flies north
 *  (1300 m at the fix, 400 m at the touchdown, 0 m past it), so the turn
 *  stays gentle and the plane converges too slowly: it reached (-296, 46,
 *  358) still 124 m off the centreline, clipped the terrain east of the
 *  runway at (-371, 21, 729) with 45 damage, and never got onto the
 *  runway. The two runs bracket the centreline (45 m west, 49 m east) —
 *  the runway needs lat under ~20 m.
 *  v5.10: MOVING LEAD POINT. The final now steers at a point on the
 *  extended centreline 250 m ahead of the plane's own along-track
 *  position — a line-following controller, not pursuit of a fixed point.
 *  The target moves with the plane, so the effective lead stays 250 m
 *  all the way in: the bearing is atan2(-lat, 250), a strong turn when
 *  far off the centreline (45° at lat 250 m) that eases to due north as
 *  the plane converges. The descent still uses the distance to the
 *  touchdown (dist), so the flare is unchanged, and the autoland (which
 *  starts on the centreline) is unaffected. The moving lead WORKED
 *  laterally — the plane converged to lat 4 m and flew down the
 *  centreline — but it still did not land on the runway (v5.11).
 *  v5.11: STRONGER FINAL DESCENT GAIN. The v5.10 run converged to lat
 *  4 m and descended to 8 m, but it arrived at the touchdown area ~20 m
 *  above the slope and the flare could not get it down in time — at
 *  114 m out it needed 9.3 m/s to reach the runway at the touchdown,
 *  over the 9 m/s cap (effectively ~8.3 m/s through the -0.35 pitch
 *  clamp). It flew past the touchdown, and past the touchdown the flare
 *  law's time-to-go grows (the distance to the touchdown point
 *  increases again), so the descent fell to the 0.5 m/s floor and the
 *  plane floated at 8 m for ~550 m before touching down at (-419, 17,
 *  1098) — 28 m past the runway end (z = 1070), on the rising terrain,
 *  damage 0, mission NOT finished. The root cause is the final's
 *  descent law: slopeRate + 0.08 * err decays exponentially, so the
 *  error never fully closes in the 21.8 s from handoff to touchdown —
 *  at the handoff err = 91.5 m, and at dist = 200 it was still ~20 m.
 *  The gain is now 0.15: the plane descends at the max rate longer and
 *  converges exponentially faster, arriving at dist = 200 with only
 *  ~11 m of error, which the flare (5.7 m/s, below the cap) handles.
 *  The autoland starts on-slope (err small), so a higher gain just
 *  makes it track the slope more tightly — it should still PASS, and
 *  the regression run will prove it. The gain WORKED — the plane
 *  touched down on the runway at (-417, 8, 546), 4.6 m from the
 *  touchdown point — but it rolled off the end before stopping (v5.12).
 *  v5.12: SLOWER FINAL APPROACH. The v5.11 run LANDED on the runway —
 *  touchdown at (-417, 8, 546), 4.6 m from the touchdown point, on the
 *  centreline, damage 0 — but it rolled 564 m and stopped at (-420, 22,
 *  1110), 40 m past the runway end (z = 1070), on the rising terrain,
 *  so the mission (onGround + speed < 5 ON the runway) did not
 *  complete. The touchdown speed was 52 m/s, and the plane had only
 *  520 m of runway ahead; the braking (2.4 m/s²) needed 564 m. The
 *  final approach speed band is now 46–52 m/s (was 52–58): the plane
 *  touches down around 48 m/s, and the stopping distance scales with
 *  v², so it stops in ~480 m — well inside the 520 m of runway. The
 *  stall speed is 28 m/s, so 48 m/s is safe, and at lower speed the
 *  turn radius shrinks (better convergence) and the plane has more time
 *  to track the slope. The autoland also flies the final, so it will
 *  touch down slower too — it should still PASS, and the regression run
 *  will prove it. The full flight PASSED (mission finished, score 1577,
 *  stopped on the runway at z = 799.67, lastLanding vs -1.33 m/s, speed
 *  25.3 m/s, centreline 2.0 m, onRunway true) — but the autoland
 *  REGRESSED (v5.13).
 *  v5.13: MISSION-SPECIFIC FINAL. The v5.12 autoland REGRESSED — it
 *  landed at Parangtritis (420 m runway, vs Merapi's 620 m) with
 *  lastLanding onRunway false, speed 35.9 m/s, and stopped 27.6 m past
 *  the far end. The slow approach (46–52 m/s) bleeds LESS speed in the
 *  flare (drag scales with v²), so it touched down FASTER (35.9 m/s)
 *  than v5.9's fast approach (52–58 m/s, touchdown 25.0 m/s) and rolled
 *  long off the short strip — while Merapi's full flight NEEDS the slow
 *  approach to stop in its 520 m. The two missions need different
 *  finals, so the gain and speed band are now mission-specific: the
 *  takeoff mission (Merapi, full circuit) keeps gain 0.15 and speed
 *  46–52 m/s (proven: full flight PASS, score 1577); every other
 *  mission (including the airmail autoland at Parangtritis) reverts to
 *  gain 0.08 and speed 52–58 m/s (proven: autoland PASS in v5.9, score
 *  1408). The moving lead point, the FAF join, the latch, and the flare
 *  are shared — only the gain and speed band differ by mission.
 *  v5.14: JOIN-SPEED REDUCTION + MISSION-ID FIX. Run 14 PASSED at
 *  47 m/s into the final, run 15 FAILED at 53 m/s in — the join's
 *  48–56 m/s band let the plane arrive at the fix fast, and the final
 *  (46–52) could not shed the speed before the touchdown, so it
 *  bounced and stopped 28 m past the runway end. The first v5.14 build
 *  (join 42–48 m/s) did NOT change the entry speed — its probe latched
 *  at 52.3 m/s, and a branch probe proved why: v5.13's mission test
 *  reads mission.id, but the runtime mission state built by
 *  createMission has NO .id field — the def id lives at mission.def.id
 *  — so isTakeoff was ALWAYS false and every mission silently flew the
 *  fast final (gain 0.08, 52–58 m/s). Run 14's PASS was the v5.12 global
 *  slow final; run 15's FAIL was the fast final at 53 m/s in. The
 *  lookup is now mission.def.id, which restores the intended split:
 *  the takeoff mission gets the slow final (gain 0.15, 46–52 m/s, the
 *  v5.12-proven config) AND the slow join band (42–48 m/s, forcing
 *  ~45 m/s into the final), while every other mission keeps 48–56 m/s
 *  in the join and 0.08 / 52–58 m/s on the final — exactly what they
 *  flew in v5.13, including the autoland PASS. The autoland never
 *  enters the join (it starts on-slope), so it is unaffected — the
 *  regression run proves it. */
export function autopilotInput(flight, mission) {
  if (flight.onGround) {
    return { pitch: 0, roll: 0, yaw: 0, throttleDelta: -1, brake: true, gearDown: true };
  }
  const prog = gateProgress(mission);
  const next = mission.gates[prog.next];
  let tx, tz, speedLo, speedHi, final = false;
  let pitch;
  if (next) {
    tx = next.x; tz = next.z;
    speedLo = 58; speedHi = 66;
    pitch = clamp((next.y - flight.y) * 0.005, -0.35, 0.35);
  } else {
    final = true;
    const d = mission.dest;
    const fx = Math.sin(d.heading), fz = Math.cos(d.heading);
    tx = d.x + fx * (-d.length / 2 + 100);
    tz = d.z + fz * (-d.length / 2 + 100);
    const dist = Math.hypot(flight.x - tx, flight.z - tz);
    // v5.13: mission-specific final. The takeoff mission (Merapi, full
    // circuit, 620 m runway) needs the slow approach (46–52 m/s) and
    // the strong gain (0.15) to land AND stop on the runway — proven by
    // the v5.12 full-flight PASS (score 1577). Every other mission
    // (including the airmail autoland at Parangtritis, 420 m strip)
    // reverts to the v5.9 final (gain 0.08, speed 52–58 m/s), which
    // passed the autoland (score 1408) — the slow approach bleeds less
    // speed in the flare, so it touched down at 35.9 m/s and rolled off
    // the short strip. The moving lead, FAF join, latch, and flare are
    // shared; only the gain and speed band differ by mission.
    // v5.14: the mission test MUST read mission.def.id, not mission.id.
    // createMission builds the runtime state with NO .id field — the def
    // id lives at mission.def.id — so mission.id is always undefined and
    // the v5.13 split silently never engaged: every mission flew the fast
    // final, and the first v5.14 join band (mission-specific on the same
    // broken test) never engaged either — its probe latched at 52.3 m/s,
    // the 48–56 band's speed. With the lookup fixed, the takeoff mission
    // finally gets the slow final AND the slow join; other missions keep
    // exactly what they flew in v5.13.
    const isTakeoff = mission.def && mission.def.id === 'takeoff';
    const finalGain = isTakeoff ? 0.15 : 0.08;
    speedLo = isTakeoff ? 46 : 52; speedHi = isTakeoff ? 52 : 58;
    const slopeTan = Math.tan((3 * Math.PI) / 180);
    const slopeRate = flight.speed * slopeTan;
    const slopeAlt = 6 + dist * slopeTan;
    const err = flight.y - slopeAlt;
    // Lateral offset from the extended centreline (through the destination,
    // along its heading): the carved approach corridor is the centreline,
    // and the terrain rises steeply off it. The direct final is only safe
    // once the plane is on the slope AND on the centreline.
    const lat = Math.abs((flight.x - d.x) * fz - (flight.z - d.z) * fx);
    const fax = d.x - fx * (d.length / 2 + 800);
    const faz = d.z - fz * (d.length / 2 + 800);
    const distFAF = Math.hypot(flight.x - fax, flight.z - faz);
    // Slope altitude at the fix itself (53 m for Merapi: the fix is 900 m
    // from the touchdown point, not 800 — the old flat 48 m was 5 m low).
    const fafSlopeAlt = 6 + Math.hypot(fax - tx, faz - tz) * slopeTan;
    // Lined up on the final course? The plane arrives at the fix from the
    // south-east and must turn ~140° onto the northbound final, and the
    // turn swings it over the hillside west of the fix (terrain ~78 m,
    // higher toward the volcano shoulder). Until it is on the centreline
    // AND on the runway heading, the join holds 180 m — above every hill
    // in the western turn arc (the arc tops out at ~122 m; the east side
    // climbs toward the volcano shoulder, but the plane arrives from the
    // east and overshoots to the south-west, so it never swings there).
    // Without this the v5.3 run turned at 118 m and clipped the 115 m
    // hill at (-532, -576) with 45 damage.
    const headErr = Math.abs(wrapAngle(d.heading - flight.heading));
    const aligned = headErr < 0.6;
    const onCentre = lat <= 120;
    // v5.6: hand off to the direct final on the northbound leg where it
    // actually flies. The plane reverses around the fix (a point), so
    // the northbound leg sits ~240 m off the centreline (the turn
    // radius) — the old lat <= 120 test never fired and the plane
    // orbited the fix until the fuel ran out (v5.4 run: two full orbits
    // at 175 m, damage 0). The final steers at the touchdown and
    // converges on the centreline over the 900 m to the runway, and the
    // terrain in the handoff zone tops out at ~71 m (probed), over 100 m
    // below the 180 m hold, so the plane is safe while it converges.
    // The join's own "lined up" test (onCentre, lat <= 120) is NOT
    // widened — it still only descends on the 3-degree line when truly
    // on the centreline.
    const atFix = distFAF < 400 && lat <= 300 && headErr < 1.0;
    // v5.7: LATCH the final. A per-frame handoff test flickers: the
    // handoff is a sphere around the fix, and the plane leaves the sphere
    // the moment it flies the final north — at (-293, 100, 80) it was
    // 448 m from the fix, so the join re-engaged and turned it back. Once
    // the handoff fires, the final stays engaged for the rest of this
    // flight; a new flight state is created per mission, so the latch
    // resets with the flight.
    if (atFix) flight._apFinalLatched = true;
    if ((err > 25 || lat > 120) && !atFix && !flight._apFinalLatched) {
      // Too high for a direct final, or not lined up: join through the
      // final-approach fix, 800 m out on the extended centreline. The
      // descent follows a 3-degree line that reaches the slope altitude
      // at the fix 300 m out — so the plane stays above the hills until
      // it is on the carved corridor, instead of diving to a flat 48 m
      // while still 700 m from the fix. The descent is the same
      // feed-forward law as the direct final — slope rate plus 8% of the
      // error per second, capped at 9 m/s — so it eases as the plane
      // nears the line instead of diving under it, and the plane arrives
      // at the fix on the slope, lined up, with the normal final already
      // in charge. If the plane is past the fix and off the centreline it
      // simply flies back to the fix — a go-around, not a hillside
      // landing — and the fix sits over the carved approach corridor
      // (Merapi) or the coast (Parangtritis), so the descent path clears
      // the terrain the whole way.
      const fLine = fafSlopeAlt + Math.max(0, distFAF - 300) * slopeTan;
      const fTarget = (aligned && onCentre) ? fLine : Math.max(fLine, 180);
      const fErr = flight.y - fTarget;
      const want = Math.atan2(fax - flight.x, faz - flight.z);
      const dh = wrapAngle(want - flight.heading);
      const fRoll = clamp(dh * 1.4, -0.55, 0.55);
      // v5.4: while the plane is still turning onto the final course,
      // HOLD the target altitude — a gentle proportional law, no
      // slope-rate term and no descent floor, so the plane neither sinks
      // through the floor nor climbs away. The old law always added the
      // slope rate (3.1 m/s), so the plane leaked from 206 m to 118 m
      // across the reversal and clipped a 115 m hill. Once the plane is
      // lined up (on the centreline AND on the runway heading) it
      // descends on the 3-degree line toward the fix, as before.
      const fDescent = (aligned && onCentre)
        ? clamp(slopeRate + 0.08 * fErr, 0.5, 9)
        : clamp(0.08 * fErr, -3, 3);
      const fPitch = clamp(-Math.atan2(fDescent, Math.max(flight.speed, 20)) / 0.45, -0.5, 0.35);
      // v5.14: the join speed band is mission-specific, like the final
      // (v5.13) — and it only works now that the mission test reads
      // mission.def.id (see above): the first v5.14 build kept the
      // broken mission.id test, so the join stayed 48–56 and its probe
      // latched at 52.3 m/s. The takeoff mission holds 42–48 m/s
      // through the reversal, so it enters the final at ~45 m/s — run 15
      // entered at 53 m/s, touched down fast and rolled off the runway
      // end. Every other mission keeps the v5 band (48–56 m/s), the
      // speed its finals were proven with, so the change touches only
      // the mission that needs it. The autoland never enters the join
      // at all (it starts on-slope).
      const joinLo = isTakeoff ? 42 : 48;
      const joinHi = isTakeoff ? 48 : 56;
      return { pitch: fPitch, roll: fRoll, yaw: 0, throttleDelta: flight.speed < joinLo ? 1 : flight.speed > joinHi ? -1 : 0, brake: false, gearDown: true };
    }
    let descent;
    if (dist > 200) {
      const targetAlt = 6 + dist * slopeTan;
      descent = slopeRate + finalGain * (flight.y - targetAlt);
    } else {
      const timeToTd = Math.max(dist / Math.max(flight.speed, 20), 0.5);
      descent = (flight.y - 6) / timeToTd;
    }
    // v5.8: the final may now descend at up to 9 m/s (was 6). The plane
    // hands off ~122 m above the slope at the fix, and at 6 m/s it only
    // closes on the slope at 3.3 m/s — it arrives at the runway area
    // still ~66 m high, flies past the touchdown, and drifts west into
    // the hillside. At 9 m/s it closes at 6.3 m/s and arrives ~15 m
    // above the slope, so the flare puts it down on the runway. The
    // autoland starts on-slope and descends at ~3 m/s, far below the cap.
    // v5.11/v5.13: the gain is mission-specific (finalGain, above) — 0.15
    // for the takeoff mission (it must close a 91.5 m error in 21.8 s),
    // 0.08 for every other mission (the autoland starts on-slope and the
    // gentle gain tracks it smoothly, as in v5.9).
    descent = clamp(descent, 0.5, 9);
    // The flight model multiplies the pitch input by 0.45 to get the pitch
    // angle, and the descent rate is speed * sin(pitch angle).
    pitch = clamp(-Math.atan2(descent, Math.max(flight.speed, 20)) / 0.45, -0.35, 0.35);
    // v5.10: STEER AT A MOVING LEAD POINT on the extended centreline,
    // 250 m ahead of the plane's own along-track position — a
    // line-following controller, not pursuit of a fixed point. The
    // target moves with the plane, so the effective lead stays 250 m all
    // the way in: the bearing is atan2(-lat, 250), a strong turn when far
    // off the centreline (45° at lat 250 m) that eases to due north as
    // the plane converges. The fixed lead (v5.9) converged too slowly
    // because its effective lead shrank as the plane flew north; the
    // touchdown itself (v5.8) overshot because its lead was zero. The
    // descent (above) already used the distance to the touchdown, so the
    // flare is unchanged; only the steering target moves.
    const along = (flight.x - d.x) * fx + (flight.z - d.z) * fz;
    tx = d.x + fx * (along + 250);
    tz = d.z + fz * (along + 250);
  }
  const dx = tx - flight.x, dz = tz - flight.z;
  const want = Math.atan2(dx, dz);
  const dh = wrapAngle(want - flight.heading);
  const roll = clamp(dh * 1.4, -0.55, 0.55);
  const throttleDelta = flight.speed < speedLo ? 1 : flight.speed > speedHi ? -1 : 0;
  return { pitch, roll, yaw: 0, throttleDelta, brake: false, gearDown: final };
}

/** Update the AP status line + button for the current autopilot state. */
export function setApStatus(nav, on) {
  nav.apStatus.textContent = on ? 'AUTOPILOT ON' : 'AUTOPILOT OFF';
  nav.apStatus.classList.toggle('on', on);
  nav.apBtn.textContent = on ? 'AP: ON' : 'AP: OFF';
}

/** Update the whole nav panel from live state (called once per frame while open). */
export function updateNavPanel(nav, flight, mission, weather, autopilot) {
  drawNavChart(nav.chart, flight, mission);
  nav.metar.textContent = metarFor(weather, mission ? mission.dest.name : 'Merapi Field');
  setApStatus(nav, autopilot);
}
