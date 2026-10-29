# ReadRad

**Read with your eyes still.** ReadRad keeps a magnifier lens fixed in the center of the screen and glides the page through it, so each word arrives where you're already looking — like subtitles that know exactly where your gaze is. The full page stays visible (dimmed) around the lens, so you never lose your place in the text.

**Live app:** [dbashman1.github.io/ReadRad](https://dbashman1.github.io/ReadRad/)

Works in desktop Chrome and on iPhone Safari. No build step, no dependencies, no account — it's a static site.

> **Also in this repo:** an in-house Remotion kinetic typography system lives in [`kinetic/`](./kinetic/) — see [`plan.md`](./plan.md). Run `cd kinetic && npm run dev` for Studio.

## Features

- **Fixed-gaze reading** — the page moves, your eyes don't. The current word (or word group) is magnified and highlighted inside the lens.
- **Lens distance (1–4 words)** — like holding a real magnifier closer or farther: 1 word at high zoom, up to 4 words at lower zoom. Groups automatically shrink at line ends, the end of the text, or when they wouldn't fit inside the lens, so words never get clipped.
- **Human-like pacing** — each word gets its own dwell time instead of a fixed metronome. See [Pacing modes](#pacing-modes).
- **Speed from 30 to 300 WPM** (default 130).
- **Personal calibration** — tap along with your natural reading for 12 words and ReadRad sets your WPM from the median interval. "Too fast" / "Too slow" buttons fine-tune it later. Your pace is remembered.
- **Smooth lens motion** — glides follow minimum-jerk trajectories (see [How the motion works](#how-the-motion-works)).
- **Adjustable reading** — font size (80–160%), lens size, zoom fine-tune, and focus highlighting.
- **Dark and light themes** with an iOS-style interface.
- **Bring your own text** — paste it, upload a `.txt` / `.md` file, drag and drop a file onto the page, or try the built-in sample.

## Try it

- **Hosted:** <https://dbashman1.github.io/ReadRad/>
- **Local:** serve the folder with any static file server, for example:

```bash
npx serve -l 5199 .
```

Then open <http://localhost:5199>. Opening `index.html` directly from disk also works in most browsers.

To try a local build on a phone on the same network, open `http://<your-computer-ip>:5199`.

## Using ReadRad

1. Paste text, upload a file, or press **Sample**.
2. Press **Enter lens**.
3. Keep your gaze on the center of the lens and press **Space** (or the play button).

### Controls

| Control | Action |
| --- | --- |
| `Space` | Play / pause (taps along during calibration) |
| `Esc` | Cancel calibration, close settings, or leave the reader |
| Progress bar | Drag or click to scrub through the text |
| `←` / `→` on the focused progress bar | Step back / forward one word group |
| Dock sliders | WPM and lens distance |
| Settings (gear icon) | Pacing mode, font size, zoom, lens size, highlight, theme, calibration |

### Pacing modes

| Mode | How dwell time is decided |
| --- | --- |
| **Human** (default) | Blends word length and syllable count, skims short function words ("the", "of", "and"), adds pauses after punctuation, and adds a beat at the start of each paragraph. |
| **Syllables** | Scales with the number of syllables. |
| **Word length** | Scales with the number of letters. |
| **Hybrid** | Uses whichever of syllables or length asks for more time. |
| **Natural** | Mostly syllables, partly length, with extra time for long words. |
| **Even** | Same time for every word, like classic speed-reading apps. |

All modes are scaled to your WPM setting and calibrated pace.

### Calibrating your pace

Open settings and press **Calibrate**. The lens shows one word at a time; tap **Space** each time you'd naturally move on. After 12 taps ReadRad sets your WPM from the median gap between taps (accidental double-taps and long pauses are ignored). Press `Esc` to cancel.

## How the motion works

Two layers move together: the full page behind the lens, and a magnified copy of the page inside it.

- **Minimum-jerk glides.** Each move follows a quintic curve that eases in and out with no sudden jolt — the same model used to describe natural human eye and hand movements. If a new move starts mid-glide, it inherits the current velocity and acceleration so there's no hitch.
- **Anticipation.** The glide to the next word starts slightly before its turn, so the word is already settling into the lens as it lights up, and the lens rests still for most of each word's dwell.
- **Carriage returns.** Moving to the next line takes a little longer and starts a little earlier, and the lens content fades briefly so the long sweep doesn't smear.
- **Frame-rate independent.** Positions are computed from the clock, not accumulated per frame, so 60 Hz and 120 Hz screens trace the same path.
- **Crisp, fitted magnification.** The lens copy is laid out at 2.5× and only scaled down, so text stays sharp. Zoom adapts per word group so the group fills at most 84% of the lens width.

Users with *Reduce motion* enabled in their OS get instant jumps instead of glides.

## Project structure

```
index.html        Markup: landing screen, reader, dock, settings sheet
css/styles.css    Themes, layout, lens, glass UI
js/app.js         Text parsing, pacing, lens geometry, motion engine, controls
```

## Privacy

Everything runs in your browser. Text you paste or upload never leaves your device. Only your preferences (theme, pace, font size) are saved, in `localStorage`.
