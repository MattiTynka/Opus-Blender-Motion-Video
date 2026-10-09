---
name: opus-blender-motion-video
description: Produces short films and cinematic shots end to end - Blender scenes, characters rigged from scratch or supplied rigs, face rigs and lip sync, authored body and camera motion with automated QA, then image/video finishing via OpenRouter (Seedance, Veo, Kling, GPT Image, Nano Banana) or other providers, music and editing. Use for films, shots, animatics, character animation or rigging for video. Not for standalone images or playable games.
argument-hint: "[brief, shot or project folder]"
---

# Opus Blender Motion Video

Carry a film or shot from brief to a delivered video file: plan, build the scene and
character in Blender, author and verify the motion, finish artwork and video with the
user's chosen models, score, edit and inspect. Deliver a video, not just prompts.

`<skill>` below and in the references means this skill's directory, the folder
containing this file (`${CLAUDE_SKILL_DIR}` in Claude Code).
Open renders, frames and contact sheets with your image-viewing tool to look at them;
a tool's success message is not visual review.

## Ground rules

- **Original motion by default.** Author the performance yourself in Blender:
  keyframes or procedural Python on rig controls. Downloaded clips, mocap, Mixamo,
  text-to-motion models or video-extracted poses are motion transfer: use them only
  when the user asks for or accepts it, and label the shot `imported_motion`.
  Observational references may inform movement without supplying animation data.
- **Authorization.** Planning-only requests stay planning. Installing or updating
  this skill authorizes nothing paid. Before the first paid call, record the spending
  ceiling, attempt limit, allowed uploads and model choices; then honor them without
  re-asking at every stage. If authorization is absent, prepare the shots and an
  estimate, then ask once. "Choose for me" authorizes model selection within that scope.
- **Never invent** model IDs, API fields, rig control names or results. Verify against
  current docs, the live catalog (`openrouter.mjs catalog`) or `inspect_rig.py`. Do
  not claim a native image tool used a model its interface does not let you select,
  and do not silently change the selected models or relax motion requirements.
- **Secrets** stay in the repo-root `.env` (the OpenRouter key may instead be in
  `.env.local`, which wins over `.env`), loaded only by provider processes;
  Blender and FFmpeg run with them stripped. Never print them or ask for them in chat.
- **Blender scripts run isolated.** A `--python` script is full Python, so the runner
  runs every script except its bundled entry points in a container with no network,
  no credentials files, hard CPU and memory limits and only the `--write` folders
  writable (build the image once).
  Use `--trusted-host` only with the user's consent, never for code from downloads,
  web pages or a model's reply ([trust and isolation](references/blender-headless.md#trust-and-isolation)).
- **Fix the earliest faulty stage**: bad contacts in Blender, wrong costume in the
  still, warped limbs only in motion in the video take. Do not regenerate everything.

## Workflow

Copy this checklist into the production notes and keep it current:

```text
- [ ] 1 Brief: duration, aspect, FPS, style, beats, audio, destination, budget
- [ ] 2 Choices: image / video / audio models, motion-control route
- [ ] 3 Character: rig built or supplied rig mapped; stress poses rendered
- [ ] 4 Scene and motion: blocking -> breakdowns -> spline; motion_qa passes
- [ ] 5 Animatic: full duration rendered, media-checked, reviewed
- [ ] 6 Artwork: finished still(s) from the Blender render, inspected
- [ ] 7 Video: attempts submitted within budget, takes saved and inspected
- [ ] 8 Edit and sound: cut, score/stems, normalized delivery
- [ ] 9 Inspect and deliver: probe, decode, temporal/audio review, report
```

### 1-2. Establish the production

Read existing notes and supplied references; disclose any reference you cannot
open. Resolve what the context already answers and ask once, together, only about
missing choices that change the work (use a structured question tool if available);
continue local planning meanwhile. Offer these independent choices before the first
paid call when not already made:

| Stage | Starting choices (verify current access) |
| --- | --- |
| Images | GPT Image 2.5 Sunburst/Flare, Nano Banana 2.1, FLUX 3, Seedream 5.0 Flash via OpenRouter; direct OpenAI/Google; Higgsfield |
| Video | Seedance 2.5 (image + Blender motion reference), Veo 3.1, Kling v3.0, Wan 3.0 via OpenRouter; Gemini Omni direct; fal; Higgsfield |
| Audio | ElevenLabs score; existing authorized audio; none |

Explain the trade-off that matters for this shot (reference continuity, motion
inputs, duration, resolution, region, price); do not force a preset combination.
OpenRouter and Higgsfield can each supply images, video or both; choose the model
per stage. A provider choice neither proves model access nor lifts regional
restrictions. Decide the motion-control route
before paying for anything ([motion control](references/motion-and-cinematography.md#choose-motion-control)):
if exact steps, contacts or camera path are required and the route has no
deterministic control, propose a Blender-rendered or composited final immediately.
Spend on generative motion experiments only when the user accepts them as experiments.

### 3. Character

- **Supplied rig:** map it first with `inspect_rig.py` and follow
  [ready rig animation](references/ready-rig-animation.md).
- **New rig:** pick the route (rigid mechanical, Rigify organic, simple props) in
  [rigging from scratch](references/rigging-from-scratch.md).
- **Face or dialogue:** [face and lip sync](references/face-and-lipsync.md).

Establish reusable character, object and environment references (identifying
features, scale, palette, light) from original or authorized inputs. Render rest
plus stress poses (crouch, reach, single-leg support, the shot's extremes, and face
poses if used) before choreography.

### 4-5. Scene, motion and animatic

Follow [scene and motion authoring](references/blender-scene-and-motion.md) and run
every Blender job through the runner ([headless Blender](references/blender-headless.md)):

```bash
node <skill>/scripts/run-blender.mjs --script <film>/source/build_shot.py --log-dir <film>/logs --name build \
  --write <film>/blender -- <args, file paths absolute>
```

Production scripts import the helpers with `sys.dont_write_bytecode = True;
sys.path.insert(0, "<skill>/scripts/blender"); import animkit as ak`
(slot-aware F-curves, keying, IK/FK switch keys, pose assets, evaluated contacts,
camera bounds, provenance). Write a shot spec (beats, contacts, camera), block in
CONSTANT interpolation, add breakdowns, spline only after timing reads.

**Motion feedback loop** - repeat until it passes, then look at the frames:

1. Save the `.blend`, then in a separate run reopen it with
   `scripts/blender/motion_qa.py -- --blend <shot.blend> --spec <shot>.qa.json --output <film>/blender/motion-qa.json --fail-on-tolerance`
   (contacts, skating, floor, rigid lengths, rotation pops, jerk, framing; tolerances
   chosen from the character's scale).
2. Fix the reported frames at their cause (support plan, IK, pivots, poses), not by
   lifting the whole body or adding blur.
3. Render the full-duration animatic from the shot camera and a diagnostic camera;
   check it with `media-check.mjs` and review the movement.

Check free RAM; one Blender process at a time; small representative frame first.

### 6-7. Artwork and video

Read [providers](references/providers.md) and, for OpenRouter,
[OpenRouter](references/openrouter.md); read [credentials and jobs](references/credentials-and-jobs.md)
before any external call. For OpenRouter use the bundled client; it dry-runs by
default, enforces the ceiling and attempt limit, never resubmits an existing attempt
and resumes interrupted jobs:

```bash
node <skill>/scripts/check-env.mjs --repo <repo-root> --providers openrouter
node <skill>/scripts/openrouter.mjs submit --request <film>/requests/<shot>.json --dir <film>/provider \
  --attempt <shot>-video-01 --estimate-usd <x> --ceiling-usd <y> --max-attempts <n> --repo <repo-root> [--submit]
node <skill>/scripts/openrouter.mjs resume --dir <film>/provider --attempt <shot>-video-01 --repo <repo-root>
```

- Finish artwork from the Blender render plus labelled identity/style references;
  inspect framing, silhouette, scale and pose before animating it. Returned bytes are
  saved by magic number (JPEG may arrive when PNG was expected).
- For video, choose first/last frame or reference mode by the route's real
  capabilities. The still gives identity and environment; only an uploaded
  reference video can carry the authored choreography, and it still guides rather
  than reproduces. Name each input's role in the prompt.
- Rejections and refusals: classify the actual error with
  [generation failures](references/generation-failures.md) before changing anything.
- Photoreal people on Seedance: reference images that show a face are refused as
  possible real people, generated faces included. Send faceless references and
  carry the face in text ([face-image refusals](references/generation-failures.md#face-image-refusals)).

For a new visual approach, finish one representative difficult shot before scaling
up; it exposes identity drift, mechanical deformation and camera fidelity early.

### 8-9. Edit, inspect, deliver

Follow [production and review](references/production.md): assemble selected takes,
stabilize pacing before final music, keep dialogue/effects/music as separate
stems, trim or pad deliberately, then
`node <skill>/scripts/media-check.mjs --input <final.mp4> --expect-frames <n> --expect-seconds <s> --expect-audio`.
Separate decode checks, sampled frames, continuous temporal review and audio
audition; say which were not possible. Fix demonstrated defects within budget.

## Keep the work resumable

Use `artifacts/videos/<project-id>/` unless the user names a destination
([layout](references/production.md#small-useful-project-record)). Keep the brief,
model choices, budget ledger (`openrouter.mjs ledger`), shot IDs, asset versions,
attempt records, selected takes and remaining work current. Preserve originals next
to derivatives. After an interruption, reconcile unfinished attempts and existing
media before any new paid call. A revision changes only downstream work: a new score
does not regenerate video; a new camera can invalidate artwork and motion. Keep
accepted takes usable until replacements pass inspection.

No worker routing or delegation is required.

## Report

State the deliverable path, actual models/providers, motion origin, checks actually
run (QA numbers, probe/decode, what was viewed or heard), known limitations, and
actual vs unknown spend. Distinguish documentation checks, local render/encoding
tests and authenticated provider results. Generation success is not evidence of
quality or approval.

## Reference index

| Read | When |
| --- | --- |
| [blender-headless.md](references/blender-headless.md) | Before any Blender run: runner, script pattern, 5.x API facts, memory |
| [blender-scene-and-motion.md](references/blender-scene-and-motion.md) | Authoring a movement-led shot; physics/timing numbers; review loop |
| [rigging-from-scratch.md](references/rigging-from-scratch.md) | No rig yet: mechanical rigs, Rigify, weights, correctives |
| [ready-rig-animation.md](references/ready-rig-animation.md) | User supplies a rigged character |
| [face-and-lipsync.md](references/face-and-lipsync.md) | Eyes, expressions, dialogue |
| [motion-design-toolkit.md](references/motion-design-toolkit.md) | Considering add-ons, libraries or motion generators |
| [motion-and-cinematography.md](references/motion-and-cinematography.md) | Choosing motion control; preparing reference animatics; shot direction |
| [providers.md](references/providers.md) / [openrouter.md](references/openrouter.md) / [higgsfield.md](references/higgsfield.md) | Model routes, request shapes, catalog |
| [credentials-and-jobs.md](references/credentials-and-jobs.md) | Keys, budget, attempts, interruption rules |
| [generation-failures.md](references/generation-failures.md) | Any provider error or refusal |
| [production.md](references/production.md) | Records, prompts, editing, acceptance evidence |
| [observations.md](references/observations.md) | Dated field notes from real productions with this skill |

Scripts (run them; read the source only to debug): `run-blender.mjs`,
`blender/inspect_rig.py`, `blender/motion_qa.py`, `blender/animkit.py` (imported),
`blender_probe.py`, `openrouter.mjs`, `persist-image.mjs` (imported), `media-check.mjs`,
`check-env.mjs`. Offline tests: `node --test "<skill>/scripts/*.test.mjs"`.
