# Character specification

What the character pipeline is today (measured 2026-11-05, v1.3.0), why
characters looked blurry, what was fixed in code, and the specification new
character art should be made to. Code: `tools/build_characters.py` (slicer),
`js/ui/sprites.js` (drawing), `js/core/locomotion.js` (facing and walk cycle),
`js/ui/screens/scene.js` (actors).

## 1. The pipeline today

| Stage | What happens | Numbers |
|---|---|---|
| Source | `characters/<id>-spritesheet.png`: an illustrated page with a hero figure, labels and 48 frames (4 idle + 8 walk x 4 directions) | 1536x1024 or 1448x1086 px; each figure about 130 px tall on the page |
| Slice | `build_characters.py` finds each frame, removes the backdrop and shadow, scales the tallest frame of the character to `BODY_H` with LANCZOS, centres the torso, puts the feet on the baseline, thresholds alpha | cell 72x108, body 96 px, baseline row 101, alpha 0/255 only |
| Sheet | `assets/characters/<id>.png`: 12 columns (0-3 idle, 4-11 walk) x 4 rows (down, left, right, up) | 864x432, 17 characters |
| Draw | `drawCharacter()` copies one cell into the actor canvas | smoothed when shrinking below 108 px, nearest-neighbour when enlarging |
| Screen | actor height = stage height x `actorHeight` (0.1 by default), at least 40 CSS px | 44 CSS px on a landscape phone, 76 on a 1440x900 laptop, 101 on a 1080p monitor |

## 2. Why characters looked blurry

Three resamplings were stacked, and the last one was the worst:

1. **The source is not pixel art on a grid.** The pages say "pixel art,
   32x48 per frame", but measuring the pixel pitch of frames on the same page
   gives 2.1 to 6.0 page px per "pixel", with weak periodicity: these are
   illustrations in a pixel style, with soft edges, not sprites on a grid.
   There is no native grid to recover, so "snapping to native resolution"
   is not possible without redrawing.
2. **The slicer rescales** each figure (about 130 px) to 96 px with LANCZOS.
3. **The game rasterised at CSS size.** Each actor canvas was exactly its CSS
   size and the browser enlarged it by the device pixel ratio with
   `image-rendering: pixelated`. On a 3x phone in landscape the character was
   a **29x44 bitmap shown 132 device px tall**: soft from the 2.45x shrink,
   then blocky from the 3x blow-up.

**Fixed (v1.3.0):** the actor canvas is now `renderScale()` (device pixel
ratio, capped at 3) times its CSS size: 87x132 on that phone, 102x152 on a 2x
laptop. Same CSS size and position, so layout, depth order, collision and the
x-ray are unchanged. The create screen preview does the same. Checked at
844x390@3, 390x844@3, 1440x900@2 and 1920x1080@1 (crop the player with
Playwright at those sizes to compare).

What remains soft is (1) and (2): that is the art itself, and only new art
fixes it. On a 1x monitor the 108 px cell is shown at about 101 px, so it is
shrunk slightly with smoothing; that is the right call for this art (nearest
would drop whole rows unevenly).

## 3. Animation inventory

| | Today |
|---|---|
| States | **idle** (shown as idle frame 0 only: "characters hold still"; idle frames 1-3 exist in every sheet and are not used) and **walk** (8 frames). No run, interact, talk, sit or celebrate. |
| Who animates | The player only. NPCs stand, facing the direction set in data (`down`, `left`, `right`, `up`). |
| Directions | 4 rows in every sheet. |
| Timing | One walk frame per 0.09 s at full speed (a 0.72 s cycle), a footstep sound every 4 frames. |
| Frame consistency | Every frame 72x108; tallest frame 96 px; head and torso locked to the first idle pose of the row. |

Bugs found and fixed in v1.3.0:

- **Diagonal flicker:** facing was `|dx| > |dy|` with no memory, so a path
  near 45 degrees (A* routes, a joystick held diagonally) switched between two
  rows every few frames. Now `facingFor()` keeps the current cardinal on a
  diagonal when it is one of the diagonal's halves (a 22.5 degree hysteresis).
- **Foot sliding:** legs cycled by time, so at a light joystick tilt (35%
  speed) the legs ran at full pace. Frames now advance per distance walked.
- **Walking on the spot:** pushing into a wall played the walk cycle. Now the
  character stands, facing the wall.
- **Hovering:** pinning walk frames by the torso lifted 45 of 816 frames 3-5 px
  off the ground. The planted foot now stays within 1 px of the baseline.

Not fixed (needs a decision or art): idle frames 1-3 unused (turning them on
is a design choice: they read as a slight sway); NPCs do not turn to face the
player when spoken to (possible with existing rows); no turn transitions.

## 4. Eight directions: what is ready

`js/core/locomotion.js` resolves movement to eight directions (`up`,
`up-right`, `right`, `down-right`, `down`, `down-left`, `left`, `up-left`).
A sheet shows the best direction it has:

1. its own row for that direction;
2. the mirror image of the opposite side, if the sheet allows mirroring;
3. a cardinal half of the diagonal (steady, as above).

A sheet declares its rows in `assets/characters/manifest.json`:

```json
"sprites": {
  "boy": { "src": "...", "rows": ["down", "down-right", "right", "up-right", "up"], "mirror": true }
}
```

Without `rows` a sheet uses the global `rows` (today's four). So an
eight-direction character needs **five drawn rows** (down, down-right, right,
up-right, up) and `mirror: true`; the left side is drawn flipped. Mirror only
characters that read correctly flipped (a bag on one shoulder, a parting in
the hair, text on a shirt will swap sides). Nothing in the game fabricates a
direction: until a sheet has the rows, characters show the four they have.

The slicer (`build_characters.py`) still writes four rows; it needs a layout
entry for the five-row pages when they exist.

## 5. Specification for new character art

For characters that look like intentional pixel art. Consistency matters more
than quantity: one character made to this spec is the test of the pipeline.

**Grid and size**

- Native frame **32 x 48 px** (what the current pages claim), drawn on a real
  pixel grid: one art pixel = one image pixel, no sub-pixel detail.
- Body about **44 px** tall standing, feet on row **46** (0-based), at least
  1 px clear on every side.
- Proportions as today's cast: about 2.5 heads tall (head about 16 px, torso
  14, legs 14); shoulders 12-14 px wide from the front, 8-10 from the side.
- Delivered as **PNG, RGBA, alpha 0 or 255 only**. No JPEG, no lossy WebP, no
  soft drop shadow (the game draws its own), no backdrop.

**Outline and shading**

- 1 px outline on the silhouette, dark and slightly warm (the procedural
  fallback uses `#1b1420`); inner lines may use the darker shade of the
  material instead (selective outlining).
- Light from the upper left. Per material: base, shadow, deep shadow,
  highlight (4 tones). No anti-aliasing against transparency; sparing
  anti-aliasing inside the figure.
- At most about 24 colours per character. Skin and hair use shared ramps
  (same number of tones, same order) so they can be recoloured (section 6).

**Animation**

- Rows: down, down-right, right, up-right, up (left side mirrored), or all
  eight where mirroring would be wrong.
- Idle: 4 frames, 250 ms each, feet fixed, at most 1 px of breathing.
- Walk: 8 frames, contact frames 0 and 4 with the leading foot on the
  baseline; the body bobs 1 px on the passing frames 2 and 6; the planted
  foot never leaves the baseline.
- Frame-to-frame the head may move at most 1 px except on purpose.
- Later states, same grid: interact (reach, 3-4 frames), talk (2 frames),
  sit (for café and club tables), celebrate (4-6 frames).

**In the game**

Characters scale with the room (`actorHeight`), so on screen they will not be
exactly 2x or 3x. Once 32x48 art exists, the draw step should round the
displayed height to a whole multiple of 48 device px and draw with
nearest-neighbour; that is a few lines in `scene.js` resize() and must be
checked against the depth layers (a character a few px taller or shorter
changes nothing in collision, which uses `actorHeight`).

## 6. Customisation: what the pipeline must support first

The brief asks for hairstyles, hair colours, skin tones, clothing, hats,
accessories and faces combined as layers. Build the pipeline before the UI:

- Every layer is a full sheet on the **same frame grid** (section 5), aligned
  to the same baseline, so layers composite by simple stacking.
- Draw order per frame, bottom to top: hair (back) > body (skin) > legwear >
  footwear > top > face > hair (front) > hat > accessory. The back view
  swaps hair front/back; the side view may need the far arm as its own layer.
- Colours by **palette ramps**, not repainting: hair and skin drawn in a
  reference ramp and remapped at load time (a lookup per pixel on a 32x48
  frame is cheap). `build_characters.py` already has a hue-band `recolour()`
  that can serve as a starting point for clothing tints.
- Composite once per look into a cached sheet (one canvas per character),
  so drawing a frame stays one `drawImage`.

Today's sheets are single illustrations per character: they cannot be split
into layers, and AI-generated variants do not stay consistent frame to frame.
A layered system therefore needs **new art made as layers** (section 5).

## 7. Checklist for a new sheet

1. PNG, RGBA, binary alpha, 32x48 frames on a grid, named rows.
2. `python3 tools/build_characters.py` (after a layout entry for the page).
3. Feet on the baseline: the check in the v1.3.0 audit (every frame's lowest
   pixel within 1 px of the baseline) passes.
4. In a scene at 390x844@3, 844x390@3 and 1920x1080@1: crisp, no shimmer
   while walking, the x-ray outline aligned (`python3 tools/cdp_depth.py`).
