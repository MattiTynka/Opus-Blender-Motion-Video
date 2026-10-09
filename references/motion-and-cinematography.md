# Motion control and cinematography

Read for movement-led shots or a request for stronger cinematic impact. No video
model obeys exact choreography; choose the control route from what must survive.
How to author the motion itself: [scene and motion](blender-scene-and-motion.md).

Contents: [choose control](#choose-motion-control) · [motion references](#send-the-motion-you-reviewed) ·
[direction](#make-the-shot-memorable) · [hardest shot](#review-and-improve-the-hardest-shot)

## Choose motion control

| Required property | Approach | Limit to disclose |
| --- | --- | --- |
| Broad action and visual invention | Text + finished first frame | Contacts, step count and timing drift |
| Specific opening/closing composition | First/last frames | Endpoints say nothing about the path |
| Recognisable timing, performance or camera path | Reference video (Seedance 2.5 `input_references`), motion control (Kling), depth/pose conditioning (LTX IC-LoRA, Wan) | Conditioning still drifts; verify the route's inputs |
| Exact steps, rigid mechanics, contact timing, camera path | Blender-rendered final, generated art only for compatible backgrounds/materials or approved composites | Restyling the moving subject per frame can reintroduce deformation |

Resolve this before paying for generation. If the selected route has no documented
trajectory control and exact motion matters, propose the Blender final immediately.
Motion transfer from licensed capture or footage is allowed only when the user
chooses it; record it as `imported_motion`, retarget carefully and repair contacts.
For composites check parallax, shadows, reflections and occlusion at the interface.

## Send the motion you reviewed

Make the animatic **unambiguous, not beautiful**: clay or flat shading, a clear
subject silhouette against the background, readable joints, feet and ground contact,
no fog, heavy blur or crushed contrast over the action. Kling 4.0 documents that a
depth or white-model (clay) video transfers motion and spatial information. Tint the
stand-in to the character's skin, hair and costume colours: a dark-skinned,
black-haired stand-in leaked its face and hair into a Seedance take mid-air; after
retinting, no leak was seen.

Render the variant the route needs, from the same saved animation:

- **Locked camera**, one character, full body visible, no cuts: motion-control
  routes (Kling Motion Control asks for 3-30 s, at least 3 s of continuous motion,
  short edge at least 340 px, moderate travel across the frame).
- **Shot camera** with its authored move: omni-reference routes such as Seedance 2.5
  that can take camera behaviour from the reference.
- **Depth pass** (normalised, consistent range, no flicker): depth-conditioned
  routes (LTX IC-LoRA, some Wan workflows).

Match the reference to the output: same duration, FPS intent, aspect and framing;
encode to the route's limits and check with `media-check.mjs` (Seedance on
OpenRouter rejected a clip under 407696 pixels; see [OpenRouter](openrouter.md#motion-reference-inputs)).
Reported Seedance 2.5 limits (secondary sources): up to 10 reference videos, 2-30 s
each, 30 s total, 200 MB per clip. Photoreal face images are refused, generated faces
included ([face-image refusals](generation-failures.md#face-image-refusals)).

In the prompt give every input one job: the image controls identity, materials and
environment; the video controls choreography, timing and camera; tell the model to
ignore the animatic's proxy look. Describe the movement concretely (support changes,
kicks, turns, finish) and ask for one continuous shot. Record each submitted input's
hash, role, dimensions/duration and field; the attempt record must show the clip was
actually sent. Never silently downgrade a required reference to first-frame mode,
switch providers, or drop a required end pose; disclose the reduced control instead.

For acrobatics, give the beats with times read from the animatic
(t = (frame - 1) / fps), state counts outright ("exactly three backward rotations,
not two and not four"), and add stills of the key contacts labelled with their
times (touchdown, deepest point of the landing). With untimed beats, a Seedance take
did four rotations instead of three; with times and landing stills, the next take
matched the count and the landing (one take each, with other inputs also changed,
2026-10-09). Secondary beats still
slipped: the rise came about 0.5 s late, a small rebound hop and the camera's follow
tilt were dropped, and the crowd reacted late and weakly. When such beats must land
exactly, use the Blender-rendered or composited route from the table above.

## Make the shot memorable

Choose one visual idea and one moment of change the viewer can read (scale revealed
against a hangar door; a shaft of light at full height; a hesitant first step in an
intimate workshop). Pick a direction, not every effect.

- Layers: clear silhouette, meaningful foreground, readable midground action, a
  background that gives depth or scale. Restrained value/colour hierarchy, motivated
  light, grounded contact shadows, coherent reflections, purposeful wear.
- Lens and height set emotion and scale. A locked camera can make an approach
  powerful; a moving camera should reveal, follow or change the relationship. Do not
  stack orbit, zoom and shake to sound cinematic. Account for camera motion when
  judging foot sliding.
- Depth of field, volumetrics, motion blur, particles and simulation only when they
  serve the shot and fit memory/time, and only after contacts and framing work. Hold
  the payoff long enough to register. Across shots keep screen direction and continuity.
- Sound, when in scope: actuator tension on effort, weight-specific footfalls on
  visible contacts, environment response. A generated audio track is not proof of sync.

## Review and improve the hardest shot

Finish one representative difficult shot before adding scenes or resolution. Review
the animatic at normal speed, then slowly around contact changes; review the
generated take the same way and compare contacts, silhouette and camera path with
the reference at matching times: take frame n shows reference frame
round((n - 1) x reference fps / take fps) + 1 (Seedance returns 24 fps for a 30 fps
reference). Fix the earliest stage that introduced the defect
([acceptance](production.md#acceptance)).

A useful experiment, only with its own authorized attempts: the same design, action,
camera, duration and settings through first-frame and reference-video modes, scored
separately on contact/sliding, limb shape, weight transfer, identity, camera
agreement and impact, with the Blender render as the deterministic baseline. One
stochastic pair is a pilot, not a benchmark.
