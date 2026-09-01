# Riak brand assets

The Riak logo — *a cause drops in, event nodes ripple outward through the web.*

| File | Use |
|---|---|
| `logo.svg` | Main logo, brand color `#136F8F` — for light backgrounds |
| `logo-dark-bg.svg` | Accent `#58A9C7` — for dark backgrounds |
| `logo-mono.svg` | Single-color (`currentColor`) — print, embroidery, single-ink |

The live app favicon is `static/favicon.svg` (same design as `logo.svg`).

**Brand palette**

| Token | Light | Dark |
|---|---|---|
| Accent (ocean teal) | `#136F8F` | `#58A9C7` |
| Accent deep | `#0D5670` | `#3F8AA8` |
| Brand text | `#175F7A` | `#7FC3DC` |

**Typography**: Sora (brand/headings) · Inter (body).

Logo format is plain SVG — scales to any size, no raster needed.
To export PNG: `qlmanage -t -s 1024 -o . assets/logo.svg` (macOS) or any SVG renderer.
