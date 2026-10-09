# Production records, editing, and acceptance

Contents: [record](#small-useful-project-record) · [continuity and prompts](#continuity-and-shot-prompts) ·
[editing](#editing-and-delivery) · [acceptance](#acceptance)

## Small, useful project record

A layout that the bundled scripts fit (adapt to an existing project):

```text
artifacts/videos/<project-id>/
  brief.md           story, look, delivery, models, budget, status, decisions
  source/            Blender build/animate scripts, QA specs (*.qa.json)
  rig/               rig-report.json, stress-pose renders
  blender/           versioned .blend files, frames/, animatic.mp4, motion-qa.json
  requests/          OpenRouter request files (no secrets, no media payloads)
  provider/          attempt-*.json records and their <attempt>/original.* outputs
  audio/ edit/ review/   stems, edit decision list, contact sheets and notes
  final.mp4          delivery, plus final-probe.json
  logs/              run-blender stdout/stderr/resources
```

The bundled scripts' reports and manifests use relative paths (Blender and media
reports from the report's folder, a file on another drive by name only; image
manifests from `provider/`), so a record can be shared without local folder names.
Blender's own stdout log can still contain absolute paths.

Under the user's output destination or `artifacts/videos/<project-id>/`, keep:

- A compact brief with story, visual language, delivery format, model choices,
  authorization/budget, and current status. Reuse an existing record when present.
- Shared character/object reference images and their versions.
- Per-shot sources, render frames/animatic, effective prompts, request/response
  metadata without secrets, generated takes, and the selected take.
- An edit decision list, separate audio tracks, final export, and review notes.

For each shot record ID, duration, camera/lens, staging/action, light, reference
roles and hashes, actual submitted input fields, continuity constraints, render
paths, selected provider/task/model, attempt IDs, and output paths. Record provider-returned model information when present;
do not claim a requested alias resolved to a snapshot unless verified.

Record scene/mesh provenance separately from motion origin (`authored_keyframes`,
`authored_procedural`, or `imported_motion`). Keep the beat/contact plan, editable
rig or object controls, named actions, builder/config and the saved scene used for
the animatic. For imported motion, record the explicit motion-transfer choice and
source. A Blender render of imported motion is not choreography authored from scratch.

Working loop: planned -> scene/rig checked -> motion checked -> artwork checked -> selected
-> edited. Keep tool success and visual acceptance separate. Record the input mode
(first frame, first/last, reference video, deterministic render) rather than
describing a local animatic as provider conditioning when it was never uploaded.
Human approval is recorded only when the user actually gave it; routine agent
review need not create an approval pause.

## Continuity and shot prompts

Keep exact identity references stable across shots. Match screen direction,
costume, mechanical topology, relative scale, time of day, and lens language.
Use a clear composition render; optional masks/depth are helpful only when the
selected endpoint actually accepts the corresponding control, not merely images.

Anchor identity on a character sheet and tone on one approved master frame (set,
light, grade, contrast, exposure). Send both with every image request, repeat the
identity, set and light text word for word, and check each output against them
before the next request. A CIELAB mean/std transfer toward the master evens out the
stills; look at each result, because whole-frame statistics misfire on a frame with
different content (a tilt-up frame with more sky came out darker and yellower) and
the original is then better.

Generated takes drift as a whole: a Seedance take came out about 5 L* darker and
flatter than the master. Grade the take with one fixed transform, computed once
from the take frame that shows the master's moment and applied unchanged to every
frame; a per-frame match would follow the content and flicker. Check clipping and
keep the original take beside the graded one.

For movement-led work, use the [motion plan](motion-and-cinematography.md) before
writing the prompt. Describe observable action, support/contact changes, pace, and
secondary motion rather than relying on words such as "realistic" or "cinematic".
Do not put more actions into a short shot than its animatic can communicate.

A useful shot prompt identifies:

- Which input controls identity, composition, style, and movement.
- One primary action, the start/end state, and the intended camera behavior.
- Physical contacts and timing beats that must survive.
- Whether the shot is continuous, and what audio/dialogue is intended.

Correct the earliest faulty stage. A bad contact in the animatic calls for Blender
repair; inconsistent clothing in the still calls for image repair; warped limbs
appearing only during motion call for video repair. Do not regenerate every stage
for a defect isolated to one take.

## Editing and delivery

Use Blender's sequencer, an available editor, or focused FFmpeg operations. Verify
tool availability; no editor purchase or global installation is implied. Preserve
source audio, normalize clip FPS/size/color deliberately, and trim to the edit.
Do not label a frame-rate conversion as improved motion or an upscale as native
resolution. Match the selected video's input constraints when encoding animatics.

Use a local edit to join shots rather than repeatedly generating the entire film.
Place music according to the edit and inspect transitions. Prevent competing
generated music tracks from accumulating under the score. Dialogue or precise
foley may need separate production; do not promise isolation of a mixed track.

H.264/yuv420p MP4 with compatible audio is a practical preview default, subject to
the requested delivery format. Provider takes rarely match the nominal length
(Seedance returned 121 frames for "5 s at 24 fps"): trim or pad deliberately with
FFmpeg (`trim`/`atrim`, `-frames:v`), never stretch a performance to fill time.
Then check the actual export:

```bash
node <skill>/scripts/media-check.mjs --input <film>/final.mp4 --expect-frames 120 --expect-seconds 5 \
  --expect-size 1280x720 --expect-audio --contact-sheet <film>/review/final-sheet.png --output <film>/final-probe.json
```

It counts frames, checks stream and container durations separately, fully decodes
the file, hashes it and exits 3 on any failed expectation. Probe and decode do not
establish good timing. Do not overwrite a selected master without preserving a version.

## Acceptance

Keep review evidence distinct:

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| Metadata probe and complete decode | File properties and decodability | Good motion, sound, or storytelling |
| Sampled-frame inspection | Visible appearance at recorded timestamps | Contact continuity or natural timing between samples |
| Browser playback reaches the end | Player compatibility/liveness | That an agent watched the movement or heard the audio |
| Continuous temporal review | Observed motion at normal speed; slow review can isolate contacts | Physical correctness merely because playback succeeded |
| Audio audition and sync review | Heard content and its relationship to the action | Guaranteed isolated stems or human approval |

Record what was actually observed, including temporal coverage and whether sound
was heard. If tools provide only screenshots or contact sheets, mark continuous
motion review and audio audition as not performed. A second screenshot at the end
of playback is not continuous review. Keep human approval separate from all of these.

Open actual first/middle/last frames and action extremes; inspect cut boundaries
for identity drift, morphing, extra limbs, sliding feet, intersections, unintended
cuts, framing jumps, lighting shifts, or distracting artifacts. For locomotion,
watch at normal speed for weight/rhythm and slowly around plant, lift, landing,
and action transitions for sliding, limb changes, or pops. Inspect the same events
in the reference. Review sound and contact sync when audition is actually possible.
A contact sheet cannot prove motion quality or audio sync; state those limits if
only frame inspection is possible.

Check delivered duration, aspect ratio, dimensions, FPS, codecs, stream presence,
decode integrity, synchronization, and the requested story/quality. Never call a
silent export complete when sound was required. If an unresolved defect exhausts
the agreed budget, keep the best take, name the defect, and label the result
incomplete rather than presenting the rough cut as accepted.

Return an absolute local video link/embed, the reproducible source/edit locations,
selected models, actual or unknown cost, and remaining limitations. Publishing,
sharing externally, or uploading private assets beyond the production's existing
authorization requires its own applicable authorization.
