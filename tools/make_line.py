"""Turn a ride recording into the tattoo line.

Each tick is one slice of time. Its height follows the loudness of that slice,
but is nudged so that every run of WINDOW neighbouring ticks is unique (also
when read backwards). That way a camera seeing only a few ticks knows exactly
where on the ride it is.

Usage: python3 tools/make_line.py audio/ride.m4a
Writes line.json (for the app) and line.svg (vector, real millimetres, for print).
"""
import json
import subprocess
import sys

import numpy as np

TICK_SECONDS = 0.25   # one tick per quarter second
LEVELS = 4            # number of distinct tick heights
WINDOW = 5            # ticks needed to know the position
LENGTH_MM = 150       # printed length of the line
TICK_MM = 0.5         # tick stroke width
HEIGHTS_MM = [2.5, 4.5, 6.5, 8.5]  # full height of each level (half above, half below the base line)
BASE_MM = 0.25        # base line stroke width
SR = 16000


def load(path):
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
        check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def loudness_targets(samples):
    hop = int(TICK_SECONDS * SR)
    n = len(samples) // hop
    rms = np.array([np.sqrt(np.mean(samples[i * hop:(i + 1) * hop] ** 2)) for i in range(n)])
    db = 20 * np.log10(rms + 1e-6)
    lo, hi = np.percentile(db, 5), np.percentile(db, 95)
    norm = np.clip((db - lo) / max(hi - lo, 1e-6), 0, 1)
    return norm * (LEVELS - 1)  # continuous target in 0..LEVELS-1


def pick_levels(targets):
    """Depth-first search: closest-to-loudness level first, backtrack when a window repeats."""
    n = len(targets)
    seq, used = [], set()
    sys.setrecursionlimit(10000)

    def ok(window):
        rev = window[::-1]
        return window not in used and rev not in used and window != rev

    def step(i):
        if i == n:
            return True
        for lvl in sorted(range(LEVELS), key=lambda l: abs(l - targets[i])):
            seq.append(lvl)
            if len(seq) >= WINDOW:
                w = tuple(seq[-WINDOW:])
                if not ok(w):
                    seq.pop()
                    continue
                used.add(w)
            if step(i + 1):
                return True
            if len(seq) >= WINDOW:
                used.discard(tuple(seq[-WINDOW:]))
            seq.pop()
        return False

    if not step(0):
        raise SystemExit("could not find a unique sequence; raise WINDOW or LEVELS")
    return seq


def write_svg(levels, path):
    n = len(levels)
    pitch = LENGTH_MM / n
    pad = 3
    h = max(HEIGHTS_MM) + 2 * pad
    w = LENGTH_MM + 2 * pad + 3
    cy = h / 2
    x0 = pad + 3  # room for the start dot
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w:.2f}mm" height="{h:.2f}mm" viewBox="0 0 {w:.2f} {h:.2f}">',
        f'<g stroke="#000" stroke-linecap="butt" fill="none">',
        f'<line x1="{x0 - 1.5:.3f}" y1="{cy:.3f}" x2="{x0 + LENGTH_MM:.3f}" y2="{cy:.3f}" stroke-width="{BASE_MM}"/>',
        f'<circle cx="{x0 - 2.2:.3f}" cy="{cy:.3f}" r="0.8" stroke-width="{BASE_MM}"/>',
    ]
    for i, lvl in enumerate(levels):
        x = x0 + (i + 0.5) * pitch
        half = HEIGHTS_MM[lvl] / 2
        parts.append(f'<line x1="{x:.3f}" y1="{cy - half:.3f}" x2="{x:.3f}" y2="{cy + half:.3f}" stroke-width="{TICK_MM}"/>')
    parts.append('</g></svg>')
    with open(path, "w") as f:
        f.write("\n".join(parts) + "\n")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "audio/ride.m4a"
    samples = load(src)
    targets = loudness_targets(samples)
    levels = pick_levels(targets)
    changed = sum(1 for l, t in zip(levels, targets) if l != round(t))
    data = {
        "audio": src,
        "duration": len(samples) / SR,
        "tickSeconds": TICK_SECONDS,
        "levels": levels,
        "loudness": [round(float(t) / (LEVELS - 1), 3) for t in targets],
        "levelCount": LEVELS,
        "window": WINDOW,
        "lengthMm": LENGTH_MM,
        "heightsMm": HEIGHTS_MM,
        "tickMm": TICK_MM,
    }
    with open("line.json", "w") as f:
        json.dump(data, f)
    write_svg(levels, "line.svg")
    print(f"{len(levels)} ticks, {data['duration']:.2f}s, pitch {LENGTH_MM / len(levels):.2f}mm, "
          f"{changed} ticks nudged away from pure loudness")


if __name__ == "__main__":
    main()
