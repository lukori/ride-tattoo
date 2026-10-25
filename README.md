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
- **גרירה**: the finger is the playhead. Grains of sound follow the finger; speed changes pitch
  (like tape), moving backwards plays the sound backwards, a still finger is silent.

Add `?debug` for live numbers, +/- tuning and a log.

| param | default | meaning |
|---|---|---|
| grain | 0.09 | grain length (s) |
| every | 0.035 | time between grains (s) |
| pitch | 1 | 1 = pitch follows finger speed, 0 = constant pitch |
| minRate / maxRate | 0.35 / 3 | pitch limits |
| hold | 0 | 1 = a still finger keeps sounding that moment |
| smooth | 0.25 | finger-speed smoothing |

## Next
1. Camera reads the printed line (stage 1).
2. AR progress over the page/skin.
3. Temporary tattoo print + calibration on skin.
