# Face rigs, expressions and lip sync

Read when a shot needs readable eyes, expressions or dialogue. For a supplied rig,
use its own face controls and pose assets first ([ready rig](ready-rig-animation.md#face-on-a-supplied-rig)).

Contents: [choose](#choose-a-face-approach) · [lightweight rig](#lightweight-face-rig-tested-headless) ·
[shape set](#shape-set-and-naming) · [eyes](#eyes-and-blinks) · [expressions](#expressions) ·
[lip sync](#lip-sync) · [generated video](#faces-in-generated-video)

## Choose a face approach

| Need | Approach |
| --- | --- |
| Stylised or simple character, robot visor, short shots | Lightweight hybrid rig below: jaw + eye bones, a few named shape keys, one control bone with 0-1 properties |
| Realistic close-ups on a Rigify human | Full human metarig face; `bpy.ops.pose.rigify_upgrade_face()` converts the legacy face to skin chains (`face.skin_eye` with eyelid follow, `face.skin_jaw` with mouth lock, `face.basic_tongue`) |
| Blender Studio / CloudRig character | CloudRig face components and Action set-ups (Action constraints driven by one control channel; shape keys named after an action slot get drivers automatically) |
| Interop with avatars or capture | ARKit 52 or VRM expression names on shape keys |

Studio practice is hybrid: bones (and ribbon meshes) for lips, lids and jaw; shape
keys for brows, cheeks, combination and corrective shapes.

## Lightweight face rig (tested headless)

Verified on Blender 5.2.1 with auto-run disabled:

1. Bones: `head` (deform), `jaw` (deform, pivot just below and in front of the ear),
   `eye.L/R` (deform, pivot at the eyeball centre), `eyes_target` (control, in front
   of the face, parented to head; optional per-eye children for convergence), and a
   non-deforming `face_ctrl` bone that carries custom properties.
2. Eyes: `DAMPED_TRACK` from each eye bone to its target.
3. Properties on `face_ctrl` (`jaw_open`, `funnel`, `blink_L`, ...) with
   `id_properties_ui(prop).update(min=0.0, max=1.0)`.
4. Drivers from those properties to shape-key values **and** to the jaw bone, using
   only simple expressions (`var`, `var * 0.35`, `clamp(var, 0, 1)`,
   `max(0, var / 1.57)`, `smoothstep(0, 1.57, var)`). Simple expressions evaluate
   without Python, so they work headless and in files opened with auto-run off;
   check `driver.is_simple_expression`. One control then moves bone and shape together.
5. Teeth, tongue and mouth interior as separate meshes: upper teeth parented to
   `head`, lower teeth and tongue to `jaw`.
6. Test poses (front and three-quarter clay renders): jaw fully open, smile with jaw
   open, `mouthClose` with jaw open (lips sealed), pucker, blink at each gaze
   extreme. Fix collisions with correctives before animating.

Topology prerequisite: concentric edge loops around eyes and mouth, enough loops
across the lips and lids to close them, and a mouth bag. Without them no rig will
make convincing expressions; say so instead of hiding it with blur.

## Shape set and naming

Use ARKit names (exact camelCase) so shapes map to capture, avatars and tooling.
A useful starting subset (15-25 shapes): `eyeBlinkLeft/Right`, `eyeWideLeft/Right`,
`eyeSquintLeft/Right`, `jawOpen`, `mouthClose`, `mouthFunnel`, `mouthPucker`,
`mouthSmileLeft/Right`, `mouthFrownLeft/Right`, `mouthPressLeft/Right`,
`mouthStretchLeft/Right`, `browDownLeft/Right`, `browInnerUp`, `browOuterUpLeft/Right`,
`cheekPuff`. Full list: https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation .
VRM 1.0 presets (`aa ih ou ee oh`, `blink*`, `look*`, emotions) are the avatar
alternative. `inspect_rig.py` reports ARKit matches on supplied meshes. Key the
driving controls, not driven shape keys (drivers overwrite keyed values).

## Eyes and blinks

Eyes sell life. Starting points at 24 fps (style-dependent, tune in playback):

- Gaze moves in quick saccades (about 2-4 frames) with holds, and usually leads a
  head turn by a few frames. Avoid slow continuous eye drift.
- Blink: fast close (about 2 frames), optional 1-frame hold, slower open (3-4 frames);
  upper lid follows gaze vertically (roughly a quarter to a third of the eye's pitch).
- Blinks often accompany head turns and changes of thought; do not blink on a timer.
- Keep a little asymmetry in brows and mouth corners; perfect symmetry reads as dead.

## Expressions

Block expressions as key poses with the body poses, then offset: brows and eyes
lead, mouth follows, settle with a moving hold (tiny drift, not a frozen face).
Reuse pose assets: `ak.apply_pose_asset(rig, action, blend)` applies one (deselects
bones first); layer another with `ak.pose_from_action` + `ak.apply_pose(..., additive=True)`,
then key the face controls. Record which assets were used.

## Lip sync

1. Get clean dialogue audio (a separate track, never the mixed score) and its
   transcript. Keep the audio's exact start offset relative to frame 1.
2. Timing: Rhubarb Lip Sync (offline CLI, MIT) produces mouth cues:
   `rhubarb -f json --extendedShapes GHX -d dialog.txt -o cues.json dialog.wav`
   (`-r phonetic` for non-English). It is an external binary: ask before downloading
   it, verify the release checksum, and run it outside Blender.
3. Key the cues with `ak.key_mouth_cues(cues, shapes, fps)`; it keys every mouth
   channel at every cue and merges cues shorter than `min_frames` to prevent flapping.
   Starting map from Rhubarb shapes to controls (adjust per character):

   | Cue | Sound | Mouth |
   | --- | --- | --- |
   | A | M, B, P | lips pressed (`mouthClose`, slight `mouthPress`) |
   | B | K, S, T, EE | jaw barely open, teeth together, slight stretch |
   | C | EH, AE | jaw half open |
   | D | AA | jaw wide open |
   | E | AO, ER | slightly rounded, jaw mid |
   | F | UW, OW, W | pucker / funnel, jaw small |
   | G | F, V | upper teeth on lower lip (`mouthRollLower`) |
   | H | L | jaw open, tongue up |
   | X | rest | relaxed, mouth closed |

4. Polish: lead the sound by about 1-2 frames, make sure every M/B/P closes fully for
   at least 2 frames, let the jaw carry most of the motion, and drop small shapes in
   fast speech. Review with the audio playing; a frame strip cannot show sync.
5. Alternatives: Meta's 15 visemes are another target set (its plugin is end-of-life).
   Audio-to-ARKit networks (NVIDIA Audio2Face-3D: no Blender plugin, NVIDIA model
   licence; LAM-A2E: Apache-2.0) need a GPU and count as generated facial motion:
   record source and licence.

## Faces in generated video

Image/video models resynthesise faces: identity, expression and lip sync can drift
between frames. When dialogue must match exactly, keep the face (or the whole
character) Blender-rendered and composite, or accept and disclose the drift.
Seedance 2.5 reference mode refuses photoreal face images as possible real people,
generated fictional faces included (confirmed on OpenRouter 2026-10-09); clay or
stylised faces passed. Send faceless references and describe the face in text
([face-image refusals](generation-failures.md#face-image-refusals)). Real-person
likeness needs the person's consent regardless of the route.
