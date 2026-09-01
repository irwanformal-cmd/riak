# Riak brand assets

The Riak logo — *a cause drops in, event nodes ripple outward through the web.*

| File | Use |
|---|---|
| `logo.png` / `logo.svg` | Main logo, brand color `#136F8F` — for light backgrounds |
| `logo-dark-bg.png` / `.svg` | Accent `#58A9C7` — for dark backgrounds |
| `logo-mono.png` / `.svg` | Single-color (black) — print, embroidery, single-ink |

PNGs are 1024×1024 with transparency (alpha). SVGs are the scalable masters.
The live app favicon is `static/favicon.svg` (same design as `logo.svg`).

**Brand palette**

| Token | Light | Dark |
|---|---|---|
| Accent (ocean teal) | `#136F8F` | `#58A9C7` |
| Accent deep | `#0D5670` | `#3F8AA8` |
| Brand text | `#175F7A` | `#7FC3DC` |

**Typography**: Sora (brand/headings) · Inter (body).

SVG masters scale to any size. To re-render PNGs after changing the SVGs:
```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --screenshot=logo.png --window-size=1024,1024 --default-background-color=00000000 \
  "file://$PWD/logo.svg"
```
