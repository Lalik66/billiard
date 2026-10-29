# Cue Club 3D

A 3D pool game that runs in the browser, built with Vite and Three.js. It has a custom ball physics engine, 8-ball and 9-ball against an AI or a second player, a practice table, 12 trick-shot challenges, and four themed venues.

All models, textures, shaders, sounds and music are generated in code. The repo contains no image, audio or model files. The game is a static site with no backend: settings, stats, unlocked venues and trick-shot stars are stored in `localStorage`.

## Run it locally

You need Node.js 20.19+ or 22.12+ (required by Vite 8).

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

To build and preview the production version:

```bash
npm run build      # outputs the static site to dist/
npm run preview
```

To run the headless test suites (physics, rules, trick-shot solvability, and complete AI-vs-AI games):

```bash
npm test
```

## Deploy to Vercel

1. Push the folder to a Git repository (GitHub, GitLab or Bitbucket).
2. In Vercel, choose **Add New → Project** and import the repository.
3. Vercel detects Vite and fills in the build command (`npm run build`) and output directory (`dist`). No environment variables or other settings are needed. Click **Deploy**.

You can also deploy from the command line with `npx vercel` (or `npx vercel --prod`) in the project folder. Because the build uses relative asset paths (`base: './'`), the `dist/` folder also works on any other static host.

## How to play

### Aiming and shooting

| | Mouse / keyboard | Touch (landscape phone or tablet) |
|---|---|---|
| Aim | Move the mouse. In cue view the aim rotates around the cue ball; in overhead or free view the cue follows the pointer. | Drag on the table. |
| Fine aim | Hold **Shift** while moving, or use **Shift + ← / →**. | Drag the "fine aim" strip at the bottom of the screen. |
| Shoot | Hold the left button, pull back (drag down), and release. Drag back up to cancel. You can also hold **Space** to charge and release it to shoot. | Drag the power bar on the right downwards and let go. |
| Spin | Click the cue-ball widget (bottom left), or use **W A S D**. **X** resets the spin. | Tap or drag on the widget. |
| Cue elevation (jump shots) | Use the slider next to the spin widget, or **Q / E**. | Drag the slider. |
| Camera | **C** cycles cue view, overhead and free orbit (or press **1 / 2 / 3**). Right-drag orbits the free camera or tilts the cue camera. The mouse wheel zooms. | Two-finger drag to orbit or tilt; pinch to zoom. |
| Ball in hand | Drag the cue ball. Its ring turns red where placement is illegal. | Same. |
| Other | **Esc** pauses, **M** mutes, **P** declares a push-out in 9-ball. Holding the mouse button or Space while balls are rolling fast-forwards. | |

The aiming guide shows the line to the first contact, a ghost ball, and the predicted paths of the object ball and cue ball. With the guide setting on "By difficulty", its length follows the opponent: Easy shows the full guide, Medium a medium one, Hard a short one, and Pro shows none. Settings can force the guide to Full, Short or Off.

### Game modes

- **8-Ball** (against the computer or two players on one device). Standard rules:
  - Break from behind the head string. The table stays open until someone legally pockets a ball, and that player takes the group (solids or stripes).
  - Fouls are a scratch, hitting no ball, hitting the wrong ball first, no cushion after contact, and an illegal break. After a foul the opponent gets ball in hand anywhere.
  - On the 8-ball you must call a pocket by clicking it. The guide pre-selects the pocket the 8 is heading for.
  - You lose if you pot the 8 early, put it in the wrong pocket, or scratch while potting it.
- **9-Ball** (against the computer or two players):
  - Always hit the lowest-numbered ball first.
  - Any legal pot lets you keep shooting. Pocketing the 9 on a legal shot wins, including on the break or in a combination.
  - The shot after the break may be a push-out; the opponent then chooses to shoot or pass the table back.
  - Three consecutive fouls lose the game.
- **Practice**: a free table with 8-ball or 9-ball re-racks, undo for the last shot, cue ball in hand, and "Move balls" to drag any ball anywhere.
- **Trick Shot Challenge**: 12 levels of increasing difficulty: a first pot, a thin cut, draw and follow positioning, a cross-side bank, a combination, a kick shot, a split shot, a jump over a blocker, a rail shot, and two clearance levels. You earn 1 to 3 stars depending on how many shots you need. Each level unlocks after the previous one is completed.

### Venues

Venues unlock by beating the computer:

| Venue | Unlocks after |
|---|---|
| The Crooked Cue (pub) | always open |
| Pixel Palace (neon arcade) | 1 win |
| The Velvet Room (luxury lounge) | 2 wins |
| Orbital Station Kepler (space station) | 4 wins |

Each venue has its own felt, table finish, lighting, props, ambient animation and procedural music.

## How it works

The code is split into three layers:

- `src/core/` contains the pure game logic, with no DOM or Three.js, so the same code runs in Node tests and in a Web Worker.
  - **`physics.js`** is a fixed-timestep engine (480 Hz) with continuous collision detection inside each step. It finds the exact time of impact for every ball pair (in 3D, so jump shots work) and every cushion segment or jaw tip. It moves all balls to the earliest impact, resolves it, and repeats, so balls cannot tunnel through each other or the cushions.
    - The engine models sliding-to-rolling friction, rolling resistance, and decay of spin around the vertical axis.
    - Ball-to-ball collisions include speed-dependent friction, which produces cut-induced and spin-induced throw.
    - Cushion collisions use an elevated contact point with friction, so english changes the rebound angle.
    - Pockets are holes in the slate. Balls fall in visibly, and a ball that arrives too fast or too thin rattles back out.
    - A tight rack is resolved with a short Hertz-contact micro-simulation, so the break spreads realistically instead of behaving like a Newton's cradle.
  - **`rules.js`** handles 8-ball and 9-ball rules, fouls and statistics. **`engine.js`** connects the rules to the physics.
  - **`ai.js`** plans the computer's shots in four steps:
    1. Generate direct pots and combinations geometrically, using the ghost-ball method and clear-path checks.
    2. Simulate the best candidates at several speeds and spins on a copy of the table.
    3. Score each result with the real rules, including the quality of the cue-ball position for the next shot.
    4. If no shot scores well, fall back to safeties or kick shots.
  - Difficulty controls how many candidates the AI considers, whether it plays position, and how much aim and speed error it has. The planner runs in a Web Worker so it never blocks rendering.
  - **`levels.js`** defines the trick-shot layouts and their win conditions.
- `src/render/` contains the procedural table, balls, cue, aiming guide, camera rig, venues and post-processing.
  - Shaders cover the felt, fire, rain on glass, the planet with its clouds and atmosphere, the neon grid floor, and dust motes.
  - Post-processing applies bloom and a vignette.
  - Reflections come from an environment map built for each venue.
- `src/game/` and `src/ui/` contain the controller, input, Web Audio synthesis and the HTML/CSS interface.

The graphics quality setting has four options: **Auto** (the default), **Low**, **Medium** and **High**. Low turns off post-processing and real-time shadows and renders at 1× pixel ratio. Auto starts at High on desktop and Medium on phones, then steps down if the frame rate drops.

## Tests

`npm test` runs four suites:

- `tests/physics.test.mjs` plays 120 randomised full-power breaks (with random english, draw and cue elevation) and 120 extreme single-ball shots. It checks every simulation step and confirms that no ball escapes the table, overlaps another ball, or penetrates a cushion. It also checks that draw, stun and follow behave correctly.
- `tests/rules.test.mjs` checks every foul and every win/loss condition for 8-ball and 9-ball, using the real physics where practical.
- `tests/levels.test.mjs` proves all 12 trick-shot levels can be completed: it searches shot parameters for the single-shot levels and lets the AI clear the multi-ball levels within their shot limits.
- `tests/games.test.mjs` plays complete AI-vs-AI 8-ball and 9-ball games at several difficulties through to a winner.
