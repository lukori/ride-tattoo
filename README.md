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
- `art/skyline-a.svg`: the coded reflection in 4 fixed lengths (2/4/6/8 mm) hanging from the water line.
- `art/skyline-b.svg`: reflection lengths also follow the buildings above (30–90% of their height).
**Variant A is the chosen design and is readable**: `scan.html?line=sky-105` (print `sky-105.pdf`, or
`sky-105-mirror.pdf` for tattoo paper). `sky-105.json` = the line-105 code with `layout: "reflection"` and bar
lengths 2/4/6/8 mm. For this layout the reader finds the water line as the strongest straight dark-to-light edge
(any tilt within ±12°, either way up; `edgeMin` = minimum brightness step) and measures bars only on the light
side, from the edge outwards. Everything after that (spacing, height fit, matching, position) is shared.
Synthetic test (skyline rendered on skin colour, noise, blur, glare spot, normal / upside down / mirrored,
6–22 px/mm): 288/288 read, 0 wrong; with the water line off-centre and 11° tilt also 0 mismatched bars
(the reading point is where the vertical red mark crosses the water line). Fake camera: play mode ignores
hand shake, scrub at 1x measures 1.02.

## Next
1. Tune stage 1 on the phone with the printed page.
2. AR progress over the page/skin.
3. Temporary tattoo print + calibration on skin.
