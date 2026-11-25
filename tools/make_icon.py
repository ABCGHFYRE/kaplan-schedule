"""Draws the Kaplan Food convenience-store app icon as SVG, then renders PNG sizes with headless Chrome."""
import math
import sys

def store_svg(rounded=True):
    W = 512
    stripes = 6
    ax0, ax1, ay0, ay1 = 92, 420, 178, 232  # awning box
    sw = (ax1 - ax0) / stripes
    parts = []
    # background
    bg = f'<rect width="{W}" height="{W}" rx="{112 if rounded else 0}" fill="url(#bg)"/>'
    # ground shadow
    parts.append('<ellipse cx="256" cy="420" rx="178" ry="16" fill="#0d3b28" opacity=".35"/>')
    # building body
    parts.append('<rect x="116" y="222" width="280" height="194" rx="10" fill="#ffffff"/>')
    # sign board
    parts.append('<rect x="102" y="96" width="308" height="76" rx="18" fill="#ffffff"/>')
    parts.append('<rect x="116" y="110" width="280" height="48" rx="11" fill="#1f6f4f"/>')
    # little "open" stars / dots on sign
    parts.append('<circle cx="150" cy="134" r="9" fill="#f6b73c"/><circle cx="362" cy="134" r="9" fill="#f6b73c"/>')
    parts.append('<rect x="178" y="126" width="156" height="16" rx="8" fill="#ffffff" opacity=".95"/>')
    # awning stripes with scalloped bottom
    for i in range(stripes):
        x = ax0 + i * sw
        color = '#f6b73c' if i % 2 == 0 else '#fff1cf'
        parts.append(f'<rect x="{x:.2f}" y="{ay0}" width="{sw + 0.6:.2f}" height="{ay1 - ay0}" fill="{color}"/>')
        parts.append(f'<circle cx="{x + sw / 2:.2f}" cy="{ay1}" r="{sw / 2:.2f}" fill="{color}"/>')
    parts.append(f'<rect x="{ax0}" y="{ay0 - 6}" width="{ax1 - ax0}" height="12" rx="6" fill="#e39b1b"/>')
    # window with shelves
    parts.append('<rect x="146" y="282" width="116" height="92" rx="10" fill="#d6efe2"/>')
    parts.append('<rect x="146" y="282" width="116" height="92" rx="10" fill="none" stroke="#1f6f4f" stroke-width="8"/>')
    parts.append('<line x1="152" y1="312" x2="256" y2="312" stroke="#1f6f4f" stroke-width="6"/>')
    parts.append('<line x1="152" y1="344" x2="256" y2="344" stroke="#1f6f4f" stroke-width="6"/>')
    for (x, y, c) in [(168, 300, '#e8574a'), (190, 300, '#f6b73c'), (212, 300, '#3c74c9'), (234, 300, '#e8574a'),
                      (172, 332, '#3c74c9'), (198, 332, '#e8574a'), (226, 332, '#f6b73c'),
                      (176, 362, '#f6b73c'), (204, 362, '#3c74c9'), (232, 362, '#e8574a')]:
        parts.append(f'<rect x="{x - 7}" y="{y - 9}" width="14" height="16" rx="3" fill="{c}"/>')
    # door
    parts.append('<rect x="284" y="282" width="84" height="134" rx="10" fill="#1f6f4f"/>')
    parts.append('<rect x="296" y="294" width="60" height="60" rx="6" fill="#d6efe2" opacity=".9"/>')
    parts.append('<circle cx="350" cy="372" r="7" fill="#f6b73c"/>')
    defs = ('<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#2a8a62"/><stop offset="1" stop-color="#1a5f43"/></linearGradient></defs>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}">{defs}{bg}{"".join(parts)}</svg>'

if __name__ == '__main__':
    out = sys.argv[1]
    open(f'{out}/icon.svg', 'w').write(store_svg(True))
    open(f'{out}/icon-maskable.svg', 'w').write(store_svg(False))
    print('svg written')
