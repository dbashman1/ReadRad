# Kinetic Typography System — Plan (adjusted)

**Goal:** In-house, Remotion-based kinetic typography at Katana / Claude Motion quality — smooth, deliberate, cinematic. Not spring-bounce demos.

## Pivot strategy (this repo)

| Piece | Role |
| --- | --- |
| **Repo root** (`index.html`, `css/`, `js/`) | **ReadRad** — shipped fixed-gaze reader. Stays at root so [GitHub Pages](https://dbashman1.github.io/ReadRad/) keeps working. |
| **`kinetic/`** | **New product surface** — Remotion Studio project for the kinetic typography system. Primary engineering focus going forward. |
| **`plan.md`** | This file. Agents should read it before changing kinetic code. |

Do **not** delete or regress ReadRad unless explicitly asked. Kinetic work lives under `kinetic/`.

## What “high-end” means

- Custom easing curves (`interpolate` + cubic-bezier / carefully shaped progress) first; springs only for controlled overshoot
- Musical stagger (shared beat grid), not random delays
- Secondary motion: opacity, soft blur, tracking, micro-scale, tiny position offsets — layered, never noisy
- Strong type hierarchy, generous spacing, dark cinematic default
- Fully code-based (Remotion) so every frame stays editable

## Architecture

```
kinetic/
  src/
    components/
      KineticText.tsx           # props → style preset → render
      styles/
        SmoothReveal.tsx
        HighlightSweep.tsx
        CinematicEmphasis.tsx
        FloatingDrift.tsx
    compositions/
      StyleGallery.tsx          # side-by-side / sequenced demos
      Preview.tsx               # single-line playground composition
    utils/
      timing.ts                 # beat, stagger, hold windows
      easing.ts                 # named curves + Remotion helpers
      splitText.ts              # word / letter units with indices
    Root.tsx
    index.ts
  package.json
```

- One **KineticText** wrapper; styles are pure presentational components
- Configurable via props: `text`, `preset`, `mode` (`word` | `letter`), timing, emphasize indices, colors, font
- Compositions at **60 fps**, **1920×1080** default; 4K composition registered as a variant

## Styles (v1)

1. **SmoothReveal** — fade + slide + micro-scale, cubic-bezier, precise stagger
2. **HighlightSweep** — text holds, then color/highlight bar sweeps (no spring)
3. **CinematicEmphasis** — selected words scale + tracking open, hold, settle
4. **FloatingDrift** — soft drift + light rotation, then lock

## Implementation order

1. Scaffold Remotion blank project in `kinetic/`
2. Shared `easing` / `timing` / `splitText`
3. **SmoothReveal** + `KineticText` + Studio compositions
4. Remaining three styles
5. Props-friendly gallery + short kinetic README

## Quality bar

- Prefer smoothness and polish over flashy effects
- No default spring bounce as the “hero” motion
- Preview in Remotion Studio (`npm run dev` inside `kinetic/`) while iterating
