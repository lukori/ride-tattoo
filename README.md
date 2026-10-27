# הדרך / The Ride

"What will remain of me": a recorded bike ride, played back through a (temporary) tattoo.

## How the line works
`tools/make_line.py` turns the recording into a line of ticks, one tick per 0.25 s.
Tick height follows loudness, but is nudged so that every run of 5 neighbouring ticks
is unique (also read backwards). A camera that sees only ~5 ticks (~7 mm of a 150 mm line)
can then tell exactly where on the ride it is. 4 heights, 2.5–8.5 mm.

    python3 tools/make_line.py audio/ride.m4a   # writes line.json + line.svg (print-ready, real mm)

## Stage 0 (now): finger on screen
`index.html` draws the line; two modes:
- **ניגון מהנקודה**: touch a point, the ride plays on from there.
- **גרירה**: the finger is the playhead. Default engine is *tape*: one continuous voice whose speed
  follows the finger. Finger speed within 1 ± `snap` plays at exactly real time, so dragging at about
  the natural pace sounds like normal playback. Faster/slower changes pitch, backwards plays reversed,
  a still finger is silent. Tested with ±50% per-step finger jitter at 1x: 96% of the time exactly 1x,
  sound never more than 0.13 s from the finger, no restarts.
  The first engine (short grains) is still there: `?engine=0`.

Add `?debug` for live numbers, +/- tuning and a log.

| param | default | meaning |
|---|---|---|
| engine | 1 | 1 = tape (since v2), 0 = grains (the v1 default) |
| snap | 0.25 | finger speed within 1 ± snap locks to real time |
| tau | 0.12 | finger-speed smoothing time (s) |
| drift | 0.2 | how far (s) the sound may drift from the finger before being pulled back |
| pull | 0.6 | strength of that pull |
| stopAt | 0.12 | below this finger speed: silence |
| grain | 0.09 | grains only: grain length (s) |
| every | 0.035 | grains only: time between grains (s) |
| pitch | 1 | 1 = pitch follows finger speed, 0 = constant pitch |
| minRate / maxRate | 0.35 / 3 | pitch limits |
| hold | 0 | grains only: 1 = a still finger keeps sounding that moment |
| smooth | 0.25 | grains only: finger-speed smoothing |

## Stage 1: camera reads the printed line (`scan.html`)
Print `line.pdf` at 100% (the 50 mm ruler checks the scale). Point the phone so the line runs along the frame;
the red mark is the reading point. Tap the screen in play mode to pause.
- **ניגון מהנקודה** (since scan.js v5): on or off, always real time forwards. Hand shake and small drift are
  ignored: the camera must move more than `moveMin` (0.6 s of line ≈ 3.5 mm) from where it rested, and then
  settle (stay within `settle` 0.15 s for `settleMs` 150 ms); the sound then jumps there once, with a short fade.
  Losing the line keeps playing. Fake-camera test: ±0.2 s shake and 0.3 s slow drift → no jumps; a deliberate
  3 s move → exactly one jump. History: v1 (tag `checkpoint-stage1-camera-works`) jumped only after 1.5 s of
  movement with a hard cut; v3 followed the camera like scrub, which made hand shake audible.
- **גרירה**: the camera is the playhead; a resting camera is silence.
- **סלחני** (glide, scan.js v8): sounds only while the camera moves; any comfortable forward movement plays at
  real time. From rest the camera must travel `gStart` 2.5 mm one way (hand shake never does). When the camera
  runs ahead the sound speeds up by at most 12% (`gUp`) from `gNudge` 1.5 mm, and jumps softly past `gLead` 4 mm;
  when it lags, it slows by at most 8% (`gDown`) and jumps back past `gLag` 8 mm. Faster than `gFast` 15 mm/s
  it follows like scrub; backwards like scrub. Stops after resting `gHold` 350 ms. All thresholds are in mm on
  the arm, so they fit any recording length. Fake-camera test on the 10.5 cm line (1x = 4.1 mm/s): shake at rest
  → silent; 0.5x–2.4x → 100% of the sounding time within −10%/+15% of real time (100% exactly 1x at 1x), about
  one soft jump per second at 2.4x; backwards plays reversed.
  Since scan.js v9 the sound also follows part of the hand's pace: `gFollow` 0.3 (was 0.35 in v9; v8 behaviour = `gFollow=0`;
  1 = like scrub). Near 1x (±`snap`) it is still exactly real time. Measured, hand pace → sound speed (jumps/s):
  0.5x → 0.81x (0.3), 1x → 1.00x (0), 1.7x → 1.27x (0.3), 2.4x → 1.54x (1.0); with gFollow 0 it was
  0.98x / 1.00x / 1.02x / 1.02x with up to 1.7 jumps/s.

How it reads (`js/reader.js`): ink = darker than its neighbourhood → base line and tilt (±12°) from the
strongest straight row → each tick measured perpendicular to the base line → heights in units of the tick
spacing, fitted with a free scale and offset (phone tilt, blur) → slid along the whole sequence in both
directions; accepted only when far better than any other place. Ticks shorter than the shortest real tick
(the start dot) are ignored.

Synthetic tests (rendered line, noise, uneven light, tilt, upside down, blur): with ≥6 px per mm in the
800-px strip, 99–100% read, 0 wrong readings in ~500 tries, median position error 0.015 s.
Below ~5 px/mm with blur it can't read (phone too far) and says "התקרב לדף". The frame must be tall enough
that the tallest ticks fit (`band`). Fake-camera end-to-end test: reading follows a moving line within a few
frames; scrub at 1x → speed 1.00.

`?debug` shows the ink mask, all reader numbers and +/- for every parameter (see `DEFAULTS` in `js/scan.js`).

Not verified yet: real iPhone camera (focus distance, lighting, glare), real hand motion.

## 10.5 cm line (forearm)
Same recording, same tick spacing (1.48 mm), 71 ticks of 0.36 s each:
`python3 tools/make_line.py audio/ride.m4a --length 105 --pitch 1.47 --out line-105`
Print `line-105.pdf`, or `line-105-mirror.pdf` for temporary-tattoo paper (most need a mirrored print).
`print.html?line=line-105&len=10.5[&mirror]` is the page both PDFs are made from.
Scan with `scan.html?line=line-105`. A mirrored line reads correctly too (it is the same as reading backwards).
Synthetic test on a skin-coloured background, normal and mirrored, 8–24 px/mm: 144/144 read, 0 wrong.

## Jaffa skyline (design study)
`art/sky-source.svg` is the traced skyline. `python3 tools/make_skyline.py line-105` cleans it (drops the white
background, windows become holes, crops) and writes two variants, shown on `mockup.html`:
- `art/skyline-a-105.svg`: the coded reflection in 4 fixed lengths (2/4/6/8 mm) hanging from the water line.
- `art/skyline-b-105.svg`: reflection lengths also follow the buildings above (30–90% of their height).
**Variant A is the chosen design and is readable**: `scan.html?line=sky-105` (print `sky-105.pdf`, or
`sky-105-mirror.pdf` for tattoo paper). `sky-105.json` = the line-105 code with `layout: "reflection"` and bar
lengths 2/4/6/8 mm. For this layout the reader finds the water line as the strongest straight dark-to-light edge
(any tilt within ±12°, either way up; `edgeMin` = minimum brightness step) and measures bars only on the light
side, from the edge outwards. Everything after that (spacing, height fit, matching, position) is shared.
Synthetic test (skyline rendered on skin colour, noise, blur, glare spot, normal / upside down / mirrored,
6–22 px/mm): 288/288 read, 0 wrong; with the water line off-centre and 11° tilt also 0 mismatched bars
(the reading point is where the vertical red mark crosses the water line). Fake camera: play mode ignores
hand shake, scrub at 1x measures 1.02.

## 9.5 cm skyline (trial)
`python3 tools/make_line.py audio/ride.m4a --length 95 --pitch 1.47 --out line-95` then
`python3 tools/make_skyline.py line-95` → `sky-95.json`, `art/skyline-a-95.svg`; print `sky-95.pdf` /
`sky-95-mirror.pdf`; scan `scan.html?line=sky-95`. Same bar spacing and lengths (2/4/6/8 mm) as 10.5 cm,
65 bars; city 15.0 mm tall (bars now relatively longer). Synthetic test: 96/96 read, 0 wrong.
Skyline outputs are now named by size (`-105`, `-95`); the 10.5 cm files regenerated byte-for-byte identical.

## 2-minute test recording on the 9.5 cm print
`audio/test-2min.m4a` (124.7 s) plays under the existing 9.5 cm print: `sky-95-2min.json` is `sky-95.json` with
`audio`/`duration`/`tickSeconds` swapped (65 bars of 1.92 s, 1.31 s per mm). The bars no longer follow this
recording's loudness - fine for testing; the final recording gets its own line. Scan: `scan.html?line=sky-95-2min`.
The page now loads the audio named in the line file.

Since scan.js v11 every distance threshold is in mm on the line (old → new, same feel on the 30 s recording):
`jump` 0.6 s → `jumpMm` 2.5, `moveMin` 0.6 s → `moveMm` 2.5, `settle` 0.15 s → `settleMm` 0.6,
`drift` 0.3 s → `driftMm` 1.2, `pull` 0.6/s → 0.15/mm, `stopAt` 0.2x → `stopMm` 0.8 mm/s, the fixed 1 s
"too far, restart" → `farMm` 4. Glide gets `gRef` 4 mm/s = the hand speed that plays at exactly real time
(on the 30 s recording that equals real time, so nothing changes there).
Fake camera, 2-min recording: play - shake 0 jumps, a 10 mm move 1 jump to the right place; glide - shake
silent, 2 mm/s → 0.85x, 4 mm/s → 1.02x (≈1 soft jump per 1.5 s), 8 mm/s → 1.32x; scrub - real time is
0.76 mm/s, below the stop threshold, so scrub here is always fast-forward (lower `stopMm` to allow it).

## Final recording (T2_bike_03, 2:34)
Source mp3 192 kb/s stereo, 3.7 MB; its channels are almost identical (correlation 0.975), so it is stored as
mono AAC 80 kb/s: `audio/final.m4a`, 1.6 MB.
`python3 tools/make_line.py audio/final.m4a --length 95 --pitch 1.47 --out line-95-final` then
`python3 tools/make_skyline.py line-95-final 95-final` → `sky-95-final.json`, `art/skyline-a-95-final.svg`,
print `sky-95-final.pdf` / `sky-95-final-mirror.pdf`; scan `scan.html?line=sky-95-final`.
65 bars of 2.38 s, 1.63 s per mm; bar heights follow this ride's loudness (17 nudged for uniqueness).
Synthetic test: 95/96 read, 0 wrong. (`make_skyline.py` now takes an optional output tag.)

## Next
1. Tune stage 1 on the phone with the printed page.
2. AR progress over the page/skin.
3. Temporary tattoo print + calibration on skin.

## UI (scan page, v12)

- Mode buttons: "ניגון מהנקודה" and "גרירה". The "גרירה" button runs the forgiving glide mode (`mode=glide`).
  The old strict scrub button was removed; scrub still works with `?mode=scrub`.
- Buttons have a red border (the playhead colour #d4553c); the active one is filled red.
- The ride map above the buttons is a white tyre track (chevron tread with "dirt", drawn in `makeTread`), with a
  soft shadow so it stays legible on light skin. Only the stretches the sound has actually passed are printed solid
  (`trail`, kept for the visit, gaps of up to 3 ticks filled); the rest is a 22% ghost of the tread. The red line is
  the sound, the white arrow the camera. (v12 had white loudness bars instead.)
- Font: Heebo (Google Fonts), falling back to the system font.
- The reading frame is marked by four white corners (v14; before: a full rectangle, green when locked).
- Start screen (light, v15): "הדרך" in Secular One 73 px (the subtitle "מה שישאר אחרי" was removed), the line
  "כוון את הקו האדום לקעקוע ונגן את הדרך", then a smaller start button (padding 11/34 px, was 14/40).
  Experimental: a thin black line runs up the middle of the screen, broken 28 px above the title and below the
  button, trembling (a few summed sines with a slowly swelling strength; `pulse()` in scan.js). Remove by deleting
  the canvas `#pulse` and `pulse()`.

## Permanent link and QR code (v16)

- https://lukori.github.io/ride-tattoo/scan.html with no parameters opens the printed tattoo (`sky-95-old-final`)
  in glide mode ("גרירה"). The QR code in `qr/ride-qr.svg` / `qr/ride-qr.png` points to that plain link, so when a
  new tattoo is printed only the default `LINE` in `js/scan.js` changes and the printed QR keeps working.
  `?line=` and `?mode=play|scrub` still override.
- Start-screen tremble strength raised: amp = 1.1 + 1.0·swell px (was 0.6 + 0.9·swell), so it is never near straight.

## Glare (reader v3, scan v17)

A lamp reflected in the glossy tattoo shows up as blown-out white, on a forearm usually a long streak along the arm
(the same direction as the line). The reader now treats glare as "unknown" instead of skin:

- `glareMask`: pixels at or above `glare` (228, and at least 35 above the skin level) are glare, grown by 2 px.
  The skin level is the median of the bright half of the frame (Otsu split), so a frame full of dark city is fine.
- The ink mask compares each pixel only with the non-glare pixels around it, so skin next to glare is not "ink".
- The water-line search ignores brightness steps that touch glare (the edge of a glare spot is not the water line).
- A bar is followed through glare when ink carries on behind it. A bar that ends in glare, or ends where the skin is
  `halo` (25) brighter than usual, is "cut": it only says "at least this long". Cut bars still mark their place,
  are left out of the height fit, only contradict shorter bars on the line, and count 0.3 in the acceptance rule.
- Hint "יש ברק על הקעקוע. הטה מעט את הטלפון" when glare covers more than 3% of the frame. Debug shows glare % and cut bars.

Synthetic test (60 renders each, 18-38 px per bar, tilt ±8°, flips, blur, noise), right / wrong, before -> after:
no glare 60/0 -> 60/0; round spots 53-60 -> 57-60, all 0 wrong; streak over the bars 1/0 -> 22/0;
soft sheen over the bars 2/0 -> 26/0; streak over the water line 6/0 -> 10/0 (hard: the water line itself is hidden).
`glare` 240 read the soft sheen better (28) but gave one wrong reading with the water line hidden, so 228.
Anchor before this change: `checkpoint-ui-tyre-qr`.

## Real skin: relaxed acceptance (reader v4, scan v18)

A phone log on the printed tattoo showed many frames with 30-50 bars seen and the right place far ahead of every
other place (e.g. 7 misread bars at the winner vs 17 at the runner-up) rejected only because more than `errFrac`
(10%) of the bars were misread. Now a reading is also accepted with up to `errMax` (30%) misread bars when the
winner leads the runner-up by at least `gapFrac` (25%) of the bars (and at least 5). The old rule still applies too.
Bars that run out of the reading frame now count as "at least this long", like bars cut by glare.
Debug has a "Save frame" button: it downloads the exact strip the reader sees, so real frames can be replayed.

Synthetic test, right / wrong of 60, old rule -> new: worn tattoo (rubbed-off bits, specks) 45/0 -> 57/0;
heavily worn 15/0 -> 45/0; worn + glare streak 13/0 -> 19/0; all other scenarios unchanged or better, 0 wrong.
Anchor before this change: `checkpoint-glare-reader`.
