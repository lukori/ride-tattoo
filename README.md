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

## Next
1. Camera reads the printed line (stage 1).
2. AR progress over the page/skin.
3. Temporary tattoo print + calibration on skin.
