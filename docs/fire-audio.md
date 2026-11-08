# Fire audio — design journal

How the procedural fire sound (`web/js/audio.js`) got to where it is, including
the wrong turns and — importantly — *what each attempt actually sounded like to
the ear*, in the user's own words. Kept so we don't re-make the same mistakes.

## Goal

A fire sound that's **procedural** (no audio files — everything else in this
project is synthesized too), **reactive** to the fire (louder/busier when the
download is fast and well-seeded), and, above all, *sounds like a real fire* —
which turned out to be mostly about **silence between sounds**, not the sounds
themselves. Muted by default (browsers require a gesture); 🔊 button + `m` key.

## What "real fire" taught us (the principles)

- **Continuous broadband noise = ocean/static, not fire.** A steady hiss or roar
  bed is the single biggest thing that makes it *not* read as fire.
- **Fire identity lives in the gaps.** It's mostly quiet, punctuated by discrete
  crackles. "Audio whitespace" is the point.
- **The pop's filter shape is everything** for how a crackle "reads":
  - high-Q band-pass (narrow, resonant) → a tuned *plink* = **raindrop**
  - open high-pass (broadband bright) → a *shhk* = **ripping fabric**
  - moderate-Q band-pass → a *crack* ✅ (the keeper)
- **Random (Poisson) timing clumps.** Pure exponential gaps occasionally stack
  pops right on top of each other, which the ear hears as rain/ripping. Needs a
  hard minimum gap and a rate cap.

## The iterations (and how they sounded)

| # | Commit | What we tried | What the user said |
|---|--------|---------------|--------------------|
| 1 | `b12b31f` | Brown-noise **roar** (∝ vigor) + band-passed white-noise **sizzle** (∝ heat) + crackle pops (rate ∝ vigor×heat). Continuous beds. | *"sounds mostly like white noise, or even like the ocean, and lacks the amount of spaciousness (literally, audio whitespace between the noise) to make it feel real. the crackles should also be responsive to the amount of 'heat'."* |
| 2 | `de1efeb` | Removed the continuous sizzle; bed → near-silent sub-180 Hz rumble. Crackles became **discrete Poisson-spaced events**, rate driven by **heat** (~1.6 → ~11 pops/s). Pops = resonant band-pass ticks + woody pops. | *"pretty good! i think the crackles just need to be slightly louder now. also the sound shape of the crackles sounds more like raindrops — there needs to be more of a sharpness to them."* |
| 3 | `d45c000` | Louder (hotter bus + higher peaks). For sharpness, switched ticks to an **open high-pass** broadband snap with a ~0.5 ms attack. | *"ahh nope now it sounds like fabric ripping. take it back towards the direction of the sound shape i said was 'raindrop', just not all the way there."* |
| 4 | `00c0d0f` | Ticks back to **band-pass with a moderate Q (3–6.5)** — some resonant "crack" body but not the tonal plink — ~1 ms attack. Kept the louder level. | *"not bad, but i think the crackles are coming much too close together sometimes, which still reminds one of heavy rain or ripping. so now it's a matter of keeping the crackles from happening too fast-too-much-too-long."* |
| 5 | `8beefd5` | **Spacing fix (landed):** hard **minimum gap** (~110 ms + exponential) measured from the *end* of each cluster; widened the occasional double/triple "knock" to 80–160 ms; **capped the top rate** (~11 → ~3.8 pops/s at full heat). | _(current)_ |

## Where we landed

Three layers, in `web/js/audio.js`:

- **Bed** — brown noise through an aggressive low-pass (~180 Hz), very low gain
  (`~0.015 + 0.045·vigor`). A faint warmth you barely notice; deliberately nothing
  in the hiss range.
- **Crackle events** — scheduled on a ~16 ms loop. Gap to the next event =
  `MIN_GAP (0.11s) + exponential(meanGap)`, measured from the end of the previous
  cluster, so pops never bunch. `rate = 0.7 + 4.8·intensity` where
  `intensity = heat·(0.45 + 0.55·vigor)` → ~0.7 pops/s cold, ~3.8 hot. Each event
  is usually one pop; 16% chance of a second and 4% a third, spaced 80–160 ms.
- **Pop** — short enveloped white-noise burst, ~1 ms attack:
  - *tick* (72%): **band-pass, Q 3–6.5**, 1.5–4.1 kHz, 3–10 ms — the "crack"
  - *woody pop* (28%): band-pass, Q 1.4–3.6, 230–870 Hz, 12–34 ms — a deeper settle

Measured: at any intensity the closest two pops are ~80 ms apart; rate scales
~1.0 → ~3.8 pops/s with heat.

## What the sound *means* (semantic modes)

The iterations above got the crackle to *sound* right, but the mapping was
aesthetic — crackle rate was a by-ear `heat × speed` blend that gestured at the
torrent without corresponding to anything you could point at. The question then
became: can the sound relate to something *real* about the torrent, even if we
nudge the effects because we want them to mean more?

The honest grounding we found: a torrent's one true discrete, countable event is
**a piece of the file arriving**. BitTorrent downloads in pieces (the torrent's
`pieceSize`), so `crackle rate = download speed ÷ piece size` makes each pop ≈ one
piece landing — not a fudge, a physical quantity. That frees the other real
signals to each get their own voice (seeders → the warmth of the bed; seeding to
others → a distinct soft sound).

Rather than pick one blind, we made it a **live, in-page experiment** — a
swappable mode so you can A/B them against the real fire. Selector in the ⚙ panel
("Sound mapping"), the **`s`** key cycles, and `?snd=` persists/shares it.

| Mode | Crackle rate | Seeders | Extra |
|------|-------------|---------|-------|
| **aesthetic** | `heat × speed` blend (by ear; the pre-meaning feel) | → crackle rate | — |
| **pieces** *(default)* | **speed ÷ piece size** — each pop ≈ a file piece | → bed warmth | silent when nothing's arriving (e.g. done) |
| **events** | same as pieces | → bed warmth | + a soft low **exhale** (`_whoosh`) whenever we're seeding to a peer, so *receiving* (sharp crackle) and *giving* (breath) sound different |

Piece size is plumbed end-to-end: `Progress.piece_bytes` ← Transmission's real
`pieceSize` (live monitor) or a nominal `total/1500` clamped 256 KB–4 MB
(simulated); exposed via `/api/progress`; `app.js` computes `pieceRate =
rate_bps / piece_bytes` and passes it to `FireAudio.update(..., {pieceRate,
upPeers})`. `FireAudio` carries a `mode` and `_crackleRate()` switches on it.

**The honest trade-off to listen for:** `pieces` is *physically* sparse on
large-piece torrents — e.g. "Slow burn" (6 GB → ~4 MB pieces) crackles < 1×/sec
even at its peak. That sparseness *is* the meaning (and may be gorgeous or may
feel empty). `aesthetic` is the busier fallback. **Undecided** which becomes the
real default — pending listening across scenarios; if `pieces` feels too empty,
the lever is the nominal piece size (smaller → more crackles per MB).

## Tuning knobs (all in `web/js/audio.js`)

| Want | Change |
|------|--------|
| sparser / busier (aesthetic) | `MIN_GAP` (0.11) up/down, and the `4.8 * intensity` rate term |
| more/fewer crackles per MB (pieces) | the nominal piece size in the sources (`total/1500`), smaller = more |
| crack vs plink vs rip | tick filter **Q** (↑ ~7 = more defined pluck, ↓ ~2 = more open snap) |
| louder / softer | `crackleBus` gain (1.5) and/or `this.volume` (0.9) |
| snappier / softer attack | the `t + 0.001` attack ramp in `_pop` |
| more/less low warmth | the bed gain in `update()` |
| the "give" exhale (events) | `_whoosh()` shape + the `giveRate` in `_tick` |
