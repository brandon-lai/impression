# Impression

**Turn your voice into an impressionist painting.**

Record thirty seconds. Your pitch contour becomes the horizon. Each breath
group becomes a cluster of brushstrokes. Pauses become open canvas. The loudest
moments become the passages of light. What you talked about picks the subject
and the palette. You watch it paint itself, then you share it.

The claim the whole thing exists to protect: *your voice made this painting,
and no one else's voice would have made the same one.*

- **Live:** https://impression-zeta.vercel.app
- **Renderer harness:** [/harness](https://impression-zeta.vercel.app/harness) — Phase 0 tuning surface
- **Determinism check:** [/harness/determinism](https://impression-zeta.vercel.app/harness/determinism)
- **Audio path check:** [/harness/audio](https://impression-zeta.vercel.app/harness/audio)

---

## What works right now, and what does not

The deployment has **no database configured**, so:

| | State |
|---|---|
| Record, live painting, final pass | Working |
| All six subjects, titles, palette rules | Working |
| Semantic colour from speech | Working (Chrome/Safari live; every browser in the final pass when transcription is configured) |
| Save the still as a PNG | Working |
| Share by link | Working via the **fragment fallback** — the painting travels in the URL, the voice does not |
| Share with audio at `/p/<id>` | Built and tested, **needs a database** |
| Today's gallery | Built and tested, **needs a database** |
| Anonymous delete tokens | Built and tested, **needs a database** |
| Groq final transcription | Built, **needs `GROQ_API_KEY`** — returns 503 and keeps the live transcript without it |

Nothing pretends. Every write path checks one `hasDatabase` flag and refuses
with a 503 and a message rather than silently dropping a share.

### Finishing it

Supabase's free tier allows **two active projects per user**, and both slots
are in use by other live products (`attn`, `heatcheck`). Pausing one would take
someone else's deployment down, so that is a decision for the owner, not for a
build script.

```bash
# 1. a project  (or pause an existing one first, deliberately)
supabase orgs list -o json
PW=$(openssl rand -base64 24 | tr -d '/+=')
supabase projects create impression --org-id <org> --db-password "$PW" --region us-west-1 -o json
# poll until ACTIVE_HEALTHY
supabase projects list -o json

# 2. schema
supabase link --project-ref <ref>
supabase db push                      # applies supabase/migrations/0001_init.sql

# 3. the connection string — ask the API, never hand-build it; the pooler host varies
TOK=$(security find-generic-password -s "Supabase CLI" -w)
curl -s -H "Authorization: Bearer $TOK" \
  https://api.supabase.com/v1/projects/<ref>/config/database/pooler
# take the transaction pooler (port 6543) and substitute the password

printf '%s' "<that connection string>" | vercel env add DATABASE_URL production --force
printf '%s' "<groq key>"               | vercel env add GROQ_API_KEY production --force
git commit --allow-empty -m "redeploy with database" && git push origin main
```

Then confirm: `npm run test:api` against the deployed URL, and
`get_advisors(project_id=<ref>, type="security")` must come back clean.

Any Postgres works — there is nothing Supabase-specific in the schema. A local
one is what the tests run against.

---

## Running it

```bash
npm install
npm run dev            # rebuilds the AudioWorklet, then next dev

npm test               # unit tests over the pure layers
npm run typecheck

createdb impression
psql -d impression -f supabase/migrations/0001_init.sql
DATABASE_URL=postgres://$USER@localhost:5432/impression npm run build && npx next start -p 3011
BASE=http://localhost:3011 npm run test:api
PGDATABASE=impression npm run test:schema
```

Two checks only exist as pixels or as audio, so they are pages rather than test
files: `/harness/determinism` renders the same event stream twice in a real
canvas and diffs it, and `/harness/audio` drives the real AudioWorklet with a
synthesised voice-like source and reports on every stage of extraction.

Rebuilding the colour artifact needs GloVe 6B (~820MB) and takes a couple of
minutes; `public/lexicon.bin` is committed so this is not part of a normal build.

```bash
node scripts/build-lexicon.mjs /path/to/glove.6B.300d.txt public/lexicon.bin
```

---

## How it is put together

```
src/lib/
  prng.ts          mulberry32 and named sub-streams. The only source of randomness.
  color.ts         OKLCH, gamut fitting, and the no-black rule
  events.ts        PaintEvent — the contract between analysis and rendering
  audio/
    features.ts    pure functions over Float32Array frames
    worklet-entry.ts   framing only; bundled to public/worklet/
    analyzer.ts    frames -> breath groups, pauses, peaks, contour, and the per-clip normalisation
    compose.ts     the mapping specification
  render/
    brush.ts       procedural bristle masks and the canvas weave
    renderer.ts    render(marks, seed, config) — pure
    subjects.ts    the six subjects and the selection function
    fit.ts         the one place devicePixelRatio is read
  semantics/
    lexicon.ts     the 25k-word colour table, lazily loaded
    sentiment.ts   VADER, lazily loaded
```

**The renderer is a pure function of `(events, seed, config)`.** Nothing under
`src/lib/render` may read `Math.random`, `Date.now` or `devicePixelRatio` — a
unit test scans for all three, and asserts that `fit.ts` is the only place the
pixel ratio is read at all. Three things depend on that purity: the final pass
must match the painting the user watched form, someone will record the same clip
twice and check, and a server-side video renderer added later replays this same
stream with no other change.

**A stroke is a stamp sequence, not a bezier.** This is the decision that
separates a mark that reads as paint from one that reads as a drawing tool. The
brush walks the path stamping a bristled alpha mask with varying rotation,
scale and opacity.

---

## Decisions this build made

The PRD leaves these open, or does not reach them. Each was decided here rather
than deferred.

### The name

**Kept: Impression.** `github.com/brandon-lai/impression` was free and is now
taken by this repo. On npm the name is taken, which does not matter — nothing
here is published as a package.

Domains: `impression.com`, `impression.app` and `voiceimpression.com` are all
registered. `impression.art`, `impression.ink` and `impressionpaint.com` had no
nameservers when checked and are likely available. `.art` is the one to buy —
it is on-concept and it sidesteps a crowded `.com`. The product ships on a
`vercel.app` subdomain until someone decides.

The name earns itself twice over: it is the movement, and it is what a voice
leaves.

### The colour artifact deviates from the spec, deliberately

The PRD asks for GloVe 300d over "the 25,000 most common English words". Built
literally, that is wrong, and measurably so.

GloVe 6B's frequency order is Wikipedia and Gigaword's frequency order — a news
corpus. The top 25k is dominated by politics, finance and sport, and the words
someone actually says into a microphone when asked to describe somewhere they
felt calm are a small minority that sits close together in embedding space. On
that first build, `ocean`, `street`, `flower` and `fire` landed within **5
degrees of hue of each other**: four unrelated subjects, one colour, and a
language layer that was decorative rather than functional.

The vocabulary is now selected by similarity to everyday sensory description
instead of by raw corpus frequency. Separation between semantic groups went
from 5 degrees to **71**, with cohesion inside them at 0.84. Same pipeline,
same 240KB budget, better spent. There is a unit test asserting the separation
so it cannot silently regress.

Two smaller mapping decisions: hue comes from the **rank** of the UMAP plane's
angle rather than the angle itself, because UMAP puts the vocabulary in one
dense lobe and the raw angle wastes five sixths of the colour circle; and
cluster hues are pulled partway toward the whole clip's content centroid, so a
painting sits in one key instead of coming out as a colour chart.

### The lightness rule is a band, not a floor

PRD 4.4 says "minimum OKLCH lightness spread: L 0.35 to 0.92. Assert this and
correct if violated." Read as a minimum spread only, the first build measured
**L 0.34 to 1.00** — a blown white highlight and a value below the floor in the
same piece, both technically satisfying "at least this much spread". Every piece
is now mapped onto exactly `[0.35, 0.92]`, which satisfies both readings.

### The stroke budget and the cluster budget cannot both always hold

PRD 4.1 fixes one breath group at 4–12 strokes; PRD 13 wants 80–200 strokes.
A clip with six breath groups cannot reach 80 without breaking the first rule.

The cluster rule wins, because it is the unit the whole design is built on. The
80–200 band is treated as the target for a full-length clip and is asserted
across the bulk of generated pieces rather than every one — a hesitant speaker
producing a sparse painting is the system working, not failing. The 300 hard cap
is absolute.

### The light layer is lifted only in the final pass

PRD 7.4 wants highlights on top; PRD 7.7 wants the final pass to be recognisably
the painting the user watched. A live pass cannot put a highlight struck at
second 6 above one struck at second 30. So the live pass paints in time order,
and the final pass lifts the light layer — a handful of strokes, the passages of
light — above everything. It is the only difference between the two renders.

### Audio and stills live in Postgres when no object store is configured

The PRD puts both in Supabase Storage, and that remains the path when
`SUPABASE_URL` is set. Without it they go into `piece_audio` and `piece_still`,
in their own tables so listing the gallery never drags 240KB of opus along. This
makes the product complete on any Postgres, including the local one the tests
run against.

Link-preview stills are rendered by the **client**, from the 2048px final pass
it already holds, and uploaded with the piece. Rendering them server-side would
mean a headless canvas dependency for one image, and the client's copy is by
definition the exact painting the user approved.

### Sharing without a database

The event stream is a few KB, so the fallback share gzips the whole piece into
the URL **fragment**, which browsers never send to a server. The recipient
watches the painting form again with no audio, and the page says so.

Honest limits: a 24-second piece comes to about **7,900 URL characters**. Every
current browser handles that, but some chat clients truncate very long links.
It is a fallback, not the design — `/p/<id>` is.

### The stage is square on a phone

PRD 9 specifies a 70vh painting. Across a 360px phone at 4:3 that is barely a
third of the screen. Under 640px the stage is square instead, which uses the
space and matches the shape these end up being looked at in once a link is
pasted somewhere.

---

## The PRD's open questions

**1. Name.** Kept. Availability checked and reported above; buy `impression.art`.

**2. Upload.** Still cut, and the code is arranged so it stays cheap. Feature
extraction is written as pure functions over `Float32Array` frames with no
knowledge of the worklet, exactly as PRD 6.2 asks — the upload path calls the
same functions from a Web Worker over a decoded `AudioBuffer`, and the two paths
differ only in how frames are delivered. When it lands, audio should default
**off** for uploaded pieces: it reintroduces a copyright surface that recording
does not have.

**3. Video export.** Still cut, and it stayed cheap as predicted. The renderer
is pure, the full stream is persisted, and `render(marks, seed, config)` is
already what a worker would call — `skia-canvas` at 30fps piped to ffmpeg with
the stored audio, no schema migration, one nullable key and a status enum. The
gate stands: build it if people share links at all.

**4. Firefox.** Accepted, silently, as recommended. No Web Speech API means no
live colour: the live painting uses the subject palette alone and the semantic
layer arrives with the final pass. There is no browser warning, because a
warning draws attention to a difference the user cannot act on. The same path
covers the seconds before the colour table finishes loading in any browser.

**5. Voice signature persistence.** `localStorage` only, as specified. The
signature is derived from pitch range and baseline spectral centroid and feeds
the underpainting tone, so the same speaker's pieces share a family resemblance
across subjects. Cross-device consistency stays out of scope.

---

## What has not been verified

**The microphone itself.** Headless Chrome on the build machine hangs on
`getUserMedia` for audio, so the capture path was verified one step in from
there: `/harness/audio` drives the real AudioWorklet with a synthesised
voice-like source and confirms 20Hz feature emission, pitch tracked through a
120–190Hz glide, breath groups and pauses detected, and a painting composed —
everything except the microphone handoff.

**The Phase 1 gate.** PRD 14 makes it five real people saying the same sentence,
judged by someone who has not seen the project. That is a human test and nothing
automated substitutes for it. What is automated: `/harness?view=grid` renders
five speaker profiles side by side on demand, and a unit test asserts that the
expressive profile's stroke-angle variance exceeds the monotone profile's by
half again — because "the streams differ" is not the claim the product makes.

**Phase 0 taste.** The PRD is explicit that tuning the brush is a
taste-and-iteration problem and that Brandon is the loop. The harness is the
surface for it: every subject, speaker and seed is a URL.

### Budgets

| Metric | Target | Measured |
|---|---|---|
| Landing JS | <150KB gz (floor 250KB) | 193KB gz — **over target, within floor** |
| Colour table | <400KB gz | 240KB |
| AudioWorklet | — | 3.2KB |
| Stroke count | 80–200 (cap 300) | 51–144 across generated pieces |
| Lightness spread | L 0.35–0.92 | exactly, asserted |

The landing bundle is over target and it is worth saying so rather than
rounding it down. The sentiment lexicon, the colour table, the analyser, the
composer and the recorder are all deferred off the initial load; what remains is
React, the Next runtime and the renderer, and the renderer is load-bearing —
the landing page's entire job is a painting forming on screen. Getting under
150KB means not shipping React on that route, which is a larger change than this
build should make on its own.

---

## Deploying

Every deploy comes from GitHub. `vercel git connect` is set up; `git push
origin main` is the deploy command. Do not `vercel deploy` — it uploads the
working directory, so what is live then corresponds to no commit that exists
anywhere.
