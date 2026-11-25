from playwright.sync_api import sync_playwright
import pathlib
d = pathlib.Path('/home/claude/kaplan-schedule/docs/icons')
jobs = [('icon.svg', 'favicon-32.png', 32), ('icon.svg', 'favicon-48.png', 48), ('icon.svg', 'icon-192.png', 192),
        ('icon.svg', 'icon-512.png', 512), ('icon-maskable.svg', 'apple-touch-icon.png', 180),
        ('icon-maskable.svg', 'icon-maskable-512.png', 512)]
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    for src, name, size in jobs:
        pg = b.new_page(viewport={'width': size, 'height': size})
        svg = (d / src).read_text()
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg.replace("<svg ", f"<svg width=\"{size}\" height=\"{size}\" ")}</body></html>')
        pg.screenshot(path=str(d / name), omit_background=True, clip={'x': 0, 'y': 0, 'width': size, 'height': size})
        pg.close()
    b.close()
print('png written')
