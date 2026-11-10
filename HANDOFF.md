# Deep Ball – handoff for the next AI developer

You are continuing development of **Deep Ball** (https://deepball.org), a free browser game site by a 15-year-old
solo creator (@wyaclaw). Main focus right now: **Street Hoops 3D** (1v1 streetball) – animation quality, player
models and game feel. The owner tests on an iPhone and reports problems with screenshots / screen recordings.

## Stack
- Cloudflare Pages: static `public/` + Pages Functions in `functions/api/[[path]].js` (D1 database bound as `DB`,
  Workers AI as `AI`). `functions/_middleware.js` redirects www -> deepball.org. Deploys on push to `main`.
- three.js r160 vendored in `public/vendor/` (ES modules, no bundler, no build step).
- Key files:
  - `public/hoops3d.js` – the 3D game: input, movement, moves, shooting, dunks, ball, AI, camera, online (WebRTC).
    Tunable constants at the top: SHOT, DUNK, CAM, MOVE, CHAIN, CROSS, BTB, SNATCH, LEGS, HESI, JUMPS, POSTER.
  - `public/rig3d.js` – character loading + all animation (mocap clip blending + procedural bone posing). DRIB, SHUFFLE.
  - `public/arena3d.js` – arena, crowd, jumbotron, lights, hoop.
  - `public/app.js` – site shell, menus, trivia modes; `public/hoops.js` – old 2D game (fallback).
  - `public/models/` – `player.glb`, `player2.glb` (MakeHuman via MPFB, Mixamo-named 52-bone rig), `anim_*.glb`
    (idle/walk/run retargeted clips), ball textures. `tools/autorig.mjs` – custom auto-rigger.
- Every deploy: bump `CACHE` in `public/sw.js` (currently deepball-v77).

## How to test
- Local: `wrangler pages dev` with a temp `wrangler.toml` (D1 binding `DB`, `pages_build_output_dir = "public"`); delete it
  before committing. Playwright + `--use-gl=swiftshader` works for WebGL (slow, ~16 fps).
- `?debug3d` exposes `window.__h3`: `players`, `ball`, `input`, `doMove(kind)`, `givePoss(team)`, `freeze = true`
  (pause time), `cam = [dx, y, dz, lookY]` (camera override relative to player 0). Use these to freeze a pose and
  screenshot it from the front/side, and to log bone positions per frame.
- Freestyle mode (`#hfs` button) = no clock, defender toggle (`#hfAi`) – best place to check animations.
- Before every push: `node -e "import('./public/hoops3d.js')"` style load check for hoops3d/rig3d/arena3d AND an
  in-game behavior test of what you changed.

## Controls
WASD/joystick move · E shoot (hold, release in green) / block on D · F steal on D · moves: Q cross, X behind,
F spin, C step back, V between legs, G hesi, R snatch back, T size-up combo. Different moves chain at 50%.

## Lessons learned (rules from the owner's feedback – follow all of them)
1. Measure before changing: freeze frames, per-frame numbers. Find the root cause, don't patch symptoms.
2. Never set a position/pose directly mid-animation. Everything moves along eased, continuous paths; one path per
   move through all phases (no switching between separate poses).
3. Moves are named, timed phases (anticipation, action, follow-through, recovery) with constants at the top.
4. Ball sits in the palm (`p.palms`), leaves from the real hand, and each move defines start hand -> end hand.
5. Arms are always [upper arm, forearm] with a real elbow bend; never a single straight direction.
6. Layer procedural poses over mocap and fade them out when the mocap is better (running/walking).
7. Procedural bone edits must start from the mixer's clean pose each frame (see `m.clean` in rig3d.js) – the mixer
   skips unchanged bones, so edits otherwise stack up (this caused folded/spinning bodies).
8. Legs must match real travel: shuffle sideways on D, real steps toward/away; no forward run cycle while sliding.
9. Defenders face the ball handler; heads track the other player's chest, not the ball.
10. Keep jumps/reach realistic (shot jump ~0.66 m, release at apex, 43-47 deg entry).
11. Camera frames both players + ball + hoop, never follows jump height.
12. Online-interpolated values must land exactly at rest (never test airborne with `> 0`).
13. Measure rigged models only after the skeleton is posed; stand them on their real soles.
14. NEVER put a `//` comment in the middle of a one-line statement (it has silently cut off code twice).
15. Match reference clips by cropping in on the player and stepping frame by frame; copy the body motion, not the name.
16. Favor smooth over fast, cohesive over flashy. Don't break controls or gameplay; say what a fix could affect.

## Owner constraints
- Owner is 15: payments need a parent (Stripe in a parent's name). Never fake ages.
- Never put the owner's phone number or raw player code in the repo (admin check is a SHA-256 hash only).
- Don't ask them to paste secrets in chat. Explain things simply; they read on a phone.
- Reference videos (2K etc.) are for studying motion only – never copy assets.

## Open work (owner's priority order)
1. Animation polish – owner still finds moves stiff. Re-check every move in Freestyle now that the pose-stacking
   bug is fixed (many earlier "fixes" were compensating for it): dribble, cross, behind, legs, hesi, snatch, spin,
   step back, jump shot, dunks (4 styles + poster), defense stance/shuffle/contest/steal reach.
2. Bodies clip through each other; ball can pass through the defender (only center-point separation exists).
3. Crowd: more variety, lower contrast, subtle blur. On-screen callouts cover the play – move to a fixed spot.
4. Fixed-timestep simulation with render interpolation; debug panel (slow-mo, frame step, trajectories, FPS).
5. Player detail: better faces/clothes (MPFB + Blender available; see CREDITS in public/models).
6. SEO: owner is adding deepball.org to Google Search Console + Bing; offer extra crawlable pages (how to play).
