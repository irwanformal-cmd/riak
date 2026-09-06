# Riak — Landing Page

Standalone marketing / product-experience site for Riak. **Completely separate
from the main application** (`server.py` on `:8000`) — no shared state, no
changes to the engine, API, or existing UI.

## Run

```bash
python3 landing/serve.py
# → http://127.0.0.1:8001
```

or any static server:

```bash
python3 -m http.server 8001 -d landing
```

Requires Python 3.9+ (standard library only), like the rest of the project.

## Stack

Zero-build, zero-dependency static site — same philosophy as the main app:

| file | role |
|---|---|
| `index.html` | 8 sections: hero → concept → network → branching → intervention → math → open source → final CTA |
| `styles.css` | dark ocean identity, Manrope, glass panels, responsive + `prefers-reduced-motion` |
| `main.js` | water height-field ripple simulation, cursor ripple layer, scroll-driven SVG causal graphs, network canvas with activation pulses, intervention A/B lab, derivation replay |
| `serve.py` | stdlib static server on port **8001** |

## Interaction notes

- **Cursor = touching water.** Moving the pointer disturbs the height-field
  water simulation in the hero and final sections and emits ripple rings
  across the whole page; clicking drops a larger ripple.
- **Scroll = storytelling.** The concept and branching sections are sticky
  scrollytelling stages — nodes and edges of the causal web grow with scroll
  progress.
- **Touch fallback.** On mobile, `pointermove`/`pointerdown` events come from
  touch, and ambient "rain" ripples keep the water alive without a cursor.
- **Performance.** All canvases render only while on screen
  (IntersectionObserver), DPR is capped at 2, and `prefers-reduced-motion`
  disables ambient animation.

## Links

“Try Riak” buttons point to the app at `http://127.0.0.1:8000`.
GitHub links use the same placeholder URL as the main README
(`https://github.com/USERNAME/riak`) — swap in the real repository URL when
available.
