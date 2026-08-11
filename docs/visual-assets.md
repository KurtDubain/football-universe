# Original Visual Asset Register

All assets in this register are original project artwork generated with the
built-in OpenAI image-generation tool. The initial family was created on
2026-07-31, the broadcast/world-moment additions on 2026-08-08, and the football-annual
art-direction pass on 2026-08-11. Dynamic team names,
scores, season numbers, Chinese copy, and commands remain accessible live text.

| Versioned asset | Use | Display source | Dimensions | File budget |
| --- | --- | --- | ---: | ---: |
| `welcome-annual-v2.webp` | Welcome full-bleed football annual cover | `exec-e50d4840-a6cc-4ed1-a01e-bccc53188082.png` | 1440x960 | 147 KB / 160 KB first-view budget |
| `story-dark-horse-v2.webp` | Dark-horse chapter mark | `exec-a32869b2-a0b1-4873-a446-a4d0cd13099b.png` | 256x256 | 7 KB / 12 KB budget |
| `story-giant-crisis-v2.webp` | Giant-crisis chapter mark | `exec-4d7fcdad-ff45-40db-a95d-9ae5a4c10b54.png` | 256x256 | 3 KB / 12 KB budget |
| `story-promoted-survival-v2.webp` | Promoted-survival chapter mark | `exec-23565d41-2c72-45b5-abfa-62fed36b8e82.png` | 256x256 | 8 KB / 12 KB budget |
| `live-scoreboard-v1.webp` | Live-score material foundation | `call_1LOY5tUcAg8l0LNhykG8tt4F.png` | 1200x300 | 16 KB |
| `season-archive-frame-v1.webp` | On-screen and exported season archive frame | `call_OBFi5qjUssqk1loZi022q65U.png` | 960x1200 | 72 KB |
| `key-match-opener-v1.webp` | Spoiler-free featured-match broadcast opener | `exec-290c0734-4fa6-429b-85bc-2297e240c6fd.png` | 1440x630 | 70 KB / 96 KB budget |
| `match-opener-domestic-cup-v1.webp` | Domestic cup and playoff tunnel opener | `exec-62e94998-0dc0-491d-8ff6-9fb5b6a15ddb.png` | 1440x630 | 30 KB / 96 KB budget |
| `match-opener-continental-v1.webp` | Continental night/city-scale opener | `exec-1099bf2a-fc4b-4353-ad20-8001cd37ccf6.png` | 1440x630 | 94 KB / 96 KB budget |
| `match-opener-world-v1.webp` | Neutral world-stage blue-hour opener | `exec-94f0cba1-8f81-4bc2-b01c-a3d576cd9284.png` | 1440x630 | 91 KB / 96 KB budget |
| `champion-ceremony-v1.webp` | Season-review champion ceremony | `exec-797ec9e8-6a10-4c8d-abe4-07384308ded4.png` | 1200x600 | 35 KB / 64 KB budget |
| `world-moment-stage-v1.webp` | Global/continental tournament stage | `exec-2061e6f2-ee14-4d57-8321-6e37a9d5181b.png` | 1440x630 | 63 KB / 72 KB budget |
| `world-moment-rise-v1.webp` | Promotion, upset, survival, dark-horse rise | `exec-fdd3cfb3-c898-4498-ad61-58bd19e56cbf.png` | 1440x630 | 42 KB / 72 KB budget |
| `world-moment-fall-v1.webp` | Relegation, crisis, dismissal, losing run | `exec-3b7b16eb-9ce6-4554-980d-0b106661d180.png` | 1440x630 | 34 KB / 72 KB budget |
| `world-moment-legacy-v1.webp` | Award, retirement, record, legend moment | `exec-cb9cc9f1-72a2-48f6-8fe9-d0428360e044.png` | 1440x630 | 45 KB / 72 KB budget |
| `world-moment-transfer-v1.webp` | Major transfer or negotiation night | `exec-650a51c4-7fcc-4dda-92b3-f9362c9a41a1.png` | 1440x630 | 32 KB / 72 KB budget |

The display sources are retained under the current Codex generated-image
session. The project-consumed WebP files live in `src/assets/visual/`.

## Prompt Intent

- Welcome v2: a 1970s-1990s East Asian sports-annual cover built from a top-down
  stadium, match grids, registration marks, matte paper grain, restrained turf,
  brass, off-white, and signal-red inks. It deliberately avoids photorealism,
  fantasy scale, embedded interface, logos, and text.
- Story marks v2: one shared night-documentary family for a collective tunnel
  entrance, an empty directors' box after a crisis, and boots holding the wet
  touchline. Large simple subjects remain readable at 48px without literal
  horse, crown, or shield symbols.
- Live score: a low-contrast graphite broadcast plate with an uncluttered center
  and neutral team zones.
- Archive: a portrait charcoal paper-and-metal frame with pitch-blueprint detail
  confined to the margins.
- Key match: a high main-stand view over a packed original night stadium with
  a clear pitch, restrained floodlight haze, and dark zones for dynamic clubs.
- Match opener variants: a concrete players' tunnel for domestic knockout
  tension, an open-roof city stadium for continental scale, and a neutral
  blue-hour bowl for the world stage. All retain a sharp, inspectable pitch and
  dark UI-safe zones with no embedded names, scores, brands, flags, or logos.
- Champion ceremony: an original unbranded metallic football trophy on a low
  pitch-side plinth with restrained gold confetti and calm dynamic-text zones.
- World moments: five wide night-sports editorial scenes for tournament scale,
  hard-earned ascent, sober decline, personal legacy, and private transfer
  negotiation. Each keeps the left side calm for live accessible copy.

## Delivery Rules

- The Welcome scene is the only first-view raster and must remain below 160 KB.
- Story, live-score, and archive assets are requested only when their owning
  route or surface mounts. World moments mount at most one artwork per advance,
  selected from authoritative key news or story updates.
- Featured-match artwork is selected by competition type. The three optional
  competition variants stay outside the PWA install precache, are requested and
  runtime-cached only when first used, and fall back to the live text slate if
  the image is unavailable; the shared league opener remains precached.
- The five world-moment images plus three v2 chapter marks total about 243 KB;
  each individual world-moment image stays below 72 KB.
- Every surface has a CSS or Canvas fallback. Artwork never carries exclusive
  information or an interactive command.
- High-contrast mode suppresses background artwork. Reduced motion keeps the
  artwork static and disables nonessential reveal effects.
