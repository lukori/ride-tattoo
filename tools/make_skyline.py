"""Jaffa skyline above the water line, the coded ride as its reflection below.

    python3 tools/make_skyline.py line-105        # uses line-105.json for the code

1. Cleans art/sky-source.svg (an image trace): drops the white full-canvas background, turns the white
   windows/arches into real holes, crops to the drawing -> art/sky-clean.svg
2. Measures the skyline height above the water line per tick (headless Chrome) -> art/sky-profile.json
3. Writes two print-ready variants in real millimetres:
   art/skyline-a.svg  reflection bars in 4 fixed lengths; the reader reads this (sky-105.json, layout "reflection")
   art/skyline-b.svg  reflection bars that also follow the buildings above (looks more like a reflection;
                      the reader would need to know the expected length per position - not built yet)
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC = Path("art/sky-source.svg")
BAR_MM = 0.5                     # reflection bar width
LEN_A_MM = [2.0, 4.0, 6.0, 8.0]  # variant A: bar length per level
FRAC_B = [0.3, 0.5, 0.7, 0.9]    # variant B: bar length per level, as a fraction of the building above
MIN_B_MM = 1.5
PAD_MM = 3


def clean():
    svg = SRC.read_text()
    shapes = re.findall(r'<(?:path|polygon|rect)\b[^>]*/>', svg)
    white = [s for s in shapes if 'cls-1' in s]
    black = [s for s in shapes if 'cls-1' not in s]
    holes = [re.sub(r'\s*class="cls-1"', '', s) for s in white[1:]]   # white[0] is the background
    return black, holes


def bbox_and_profile(black, holes, n):
    """Draw the silhouette big in Chrome; return its bounds and the height above the water line per tick."""
    body = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2172 592" width="4344" height="1184">'
            f'<defs><mask id="m"><rect x="-10" y="-10" width="2200" height="620" fill="#fff"/><g fill="#000">{"".join(holes)}</g></mask></defs>'
            f'<g mask="url(#m)" fill="#000">{"".join(black)}</g></svg>')
    page = f"""<html><body><pre id="o"></pre><script>
const svg = {json.dumps(body)}, n = {n};
const img = new Image();
img.onload = () => {{
  const c = document.createElement('canvas'); c.width = 4344; c.height = 1184;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const ink = (x, y) => d[(y * c.width + x) * 4 + 3] > 128;
  let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (ink(x, y)) {{
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }}
  const top = [];
  for (let x = x0; x <= x1; x++) {{ let y = y0; while (y <= y1 && !ink(x, y)) y++; top.push(y1 - y); }}
  const prof = [];
  for (let i = 0; i < n; i++) {{
    const a = Math.floor(i * top.length / n), b = Math.floor((i + 1) * top.length / n);
    const s = top.slice(a, b).sort((p, q) => p - q);
    prof.push(s[Math.floor(s.length * 0.75)] / 2);   // upper quartile of the buildings over this tick
  }}
  document.getElementById('o').textContent = JSON.stringify({{ bbox: [x0 / 2, y0 / 2, (x1 - x0 + 1) / 2, (y1 - y0 + 1) / 2], prof }});
}};
img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
</script></body></html>"""
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(page)
    dom = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--virtual-time-budget=5000", "--dump-dom", "file://" + f.name],
                         capture_output=True, text=True).stdout
    return json.loads(re.search(r'<pre id="o">(.*?)</pre>', dom, re.S).group(1))


def silhouette(black, holes, bbox, k, ox, oy):
    x, y = bbox[0], bbox[1]
    t = f'translate({ox - x * k:.4f} {oy - y * k:.4f}) scale({k:.6f})'
    return (f'<defs><mask id="holes" maskUnits="userSpaceOnUse"><rect x="-1000" y="-1000" width="5000" height="5000" fill="#fff"/>'
            f'<g transform="{t}" fill="#000">{"".join(holes)}</g></mask></defs>'
            f'<g mask="url(#holes)"><g transform="{t}" fill="#000">{"".join(black)}</g></g>')


def compose(black, holes, info, line, lengths, path):
    bbox = info["bbox"]
    width_mm = line["lengthMm"]
    k = width_mm / bbox[2]
    sky_h = bbox[3] * k
    n = len(line["levels"])
    pitch = width_mm / n
    water = PAD_MM + sky_h
    total_h = water + max(lengths) + PAD_MM
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm + 2 * PAD_MM:.2f}mm" height="{total_h:.2f}mm" '
             f'viewBox="0 0 {width_mm + 2 * PAD_MM:.3f} {total_h:.3f}">',
             silhouette(black, holes, bbox, k, PAD_MM, PAD_MM),
             f'<g stroke="#000" stroke-width="{BAR_MM}" stroke-linecap="butt">']
    for i, ln in enumerate(lengths):
        x = PAD_MM + (i + 0.5) * pitch
        parts.append(f'<line x1="{x:.3f}" y1="{water - 0.2:.3f}" x2="{x:.3f}" y2="{water + ln:.3f}"/>')
    parts.append('</g></svg>')
    Path(path).write_text("\n".join(parts) + "\n")
    return sky_h


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "line-105"
    line = json.loads(Path(name + ".json").read_text())
    n = len(line["levels"])
    black, holes = clean()
    info = bbox_and_profile(black, holes, n)
    Path("art/sky-profile.json").write_text(json.dumps(info))

    bbox = info["bbox"]
    Path("art/sky-clean.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{bbox[0]} {bbox[1]} {bbox[2]} {bbox[3]}">'
        f'<defs><mask id="m" maskUnits="userSpaceOnUse"><rect x="-10" y="-10" width="2200" height="620" fill="#fff"/>'
        f'<g fill="#000">{"".join(holes)}</g></mask></defs><g mask="url(#m)" fill="#000">{"".join(black)}</g></svg>\n')

    k = line["lengthMm"] / bbox[2]
    len_a = [LEN_A_MM[l] for l in line["levels"]]
    len_b = [max(MIN_B_MM, p * k * FRAC_B[l]) for p, l in zip(info["prof"], line["levels"])]
    sky_h = compose(black, holes, info, line, len_a, "art/skyline-a.svg")
    compose(black, holes, info, line, len_b, "art/skyline-b.svg")
    # what the scanner needs to read variant A: same code, one-sided bars hanging from the water line
    sky = dict(line, layout="reflection", heightsMm=LEN_A_MM, tickMm=BAR_MM, art="art/skyline-a.svg")
    Path(name.replace("line", "sky") + ".json").write_text(json.dumps(sky))
    print(f"skyline {line['lengthMm']} x {sky_h:.1f} mm, {n} reflection bars; "
          f"B lengths {min(len_b):.1f}-{max(len_b):.1f} mm")


if __name__ == "__main__":
    main()
