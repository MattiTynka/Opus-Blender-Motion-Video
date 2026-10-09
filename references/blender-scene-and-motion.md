# Author scenes and motion in Blender

Read before building a movement-led shot. The working source is an editable 3D scene
with its own performance, authored from the brief: keyframes or procedural Python
that computes poses, not a downloaded animation rendered again.

Contents: [shot spec](#define-the-shot-in-space-and-time) · [stage](#build-the-stage-and-subject) ·
[controls](#controls-that-can-produce-the-performance) · [pose and transition](#pose-then-design-the-transitions) ·
[physics and timing](#physics-and-timing-references) · [support](#solve-support-instead-of-fixing-floor-height) ·
[procedural tools](#procedural-tools-that-work-headless) · [camera](#camera-motion-is-authored-motion) ·
[review](#review-before-dependent-generation)

## Define the shot in space and time

Write a compact spec: duration and one scene FPS, units (1 unit = 1 m), subject
dimensions and joint landmarks, set layout, framing, action beats and the visual
payoff. For each beat record frame range, root position/facing, supporting contacts,
moving limbs, leading body part and camera behaviour. N delivered frames are an
inclusive range `start..start+N-1` (5 s at 30 fps = 150 frames).

Decide the choreography yourself from the character's proportions and mass (a robot
dance might be compression and weight shift, an opposing kick, a crossing step, a
supported quarter turn, a readable finish). Do not search for a ready-made routine.

Record motion origin: `authored_keyframes`, `authored_procedural` or `imported_motion`
(`ak.stamp_provenance`). Imported animation needs the user's explicit motion-transfer
choice and source/rights records; an original mesh does not make retargeted motion original.

## Build the stage and subject

1. Named collections for set, subject, controls, cameras, lights; explicit floor
   height and axes; one reproducible builder with stable names and recorded seeds.
   Preserve unrelated content in an existing scene.
2. Primary volumes and clearances at real scale; pivots at real hinges; contact and
   occluding surfaces as real geometry; feet and hands good enough to judge contacts.
3. Establish the shot camera early (position, height, sensor/lens, subject size) and
   check the tallest, widest and nearest action poses, not just the rest pose. Add a
   side or front diagnostic camera.
4. Clay/flat render first: silhouette, scale, intersections, foot placement, negative
   space, occlusion. One coherent visual idea; procedural variety changes useful
   structure, not random detail.
5. Refine only what is visible or mechanically necessary. Shared geometry for repeats,
   small material vocabulary. Structure and articulation before atmosphere or samples.

## Controls that can produce the performance

A new rig: [rigging from scratch](rigging-from-scratch.md). A supplied rig:
[ready rig animation](ready-rig-animation.md). Either way you need a root/world
control, an independent pelvis/body control, and hand/foot targets wherever contact
matters; pre-bent two-segment chains with stable poles; IK targets outside the chain;
stretch off for rigid limbs; FK where a free swing is easier to shape.

Before choreography, pose a crouch, reach, single-leg support, turn and the shot's
maximum extension and look at the actual mesh. Fix pivots, axes and weights before
compensating with more keys.

## Pose, then design the transitions

**Block.** Complete key poses from a clean rest state (`ak.reset_pose`), keying all
main controls on each pose, with CONSTANT interpolation (`ak.set_interpolation(rig,
"CONSTANT")`). Make silhouettes, weight shifts, anticipation, contacts and the finish
readable before smoothing. Mark beats with `ak.set_markers`.

**Breakdowns.** Author the route between poses: pelvis lead, foot clearance, knee
direction, arm arcs, torso opposition, head delay. These decide the movement; default
in-betweens cannot. For dance, design rhythm and alternating support first. Avoid one
sine wave driving every joint and random per-frame noise.

**Refine in layers.** Root/pelvis and feet, then torso/arms, then secondary parts.
Switch to BEZIER with AUTO_CLAMPED handles (`ak.set_handles`) only once timing is
locked; then check that smoothing has not spread a short action over a hold. A landing
or passing pose inside continuous motion is not a hold: keep the momentum and author
compression/recovery. Overlap: offset follow-through parts by about 2-4 frames.

**Polish.** Mechanical lag, balance corrections and settles that fit the design.
Rigid armour stays rigid; squash/stretch only where the style allows it. Check
rotation continuity (`ak.keep_rotation_continuous`), especially on long turns.

## Physics and timing references

Use real physics for anything airborne or falling, and treat craft numbers as
starting points that depend on style and character:

- Ballistics (g = 9.81 m/s^2): only the centre of mass follows the parabola; limbs
  overlap around it. Flight time `T = 2 v0 / g`, apex `h = g T^2 / 8`. A 0.5 m rise
  lasts about 0.64 s (about 15 frames at 24 fps). The Snow triple backflip used a
  14-segment mass model; its saved checks hit gravity within 0.006 m/s^2.
- Walk: about 12 frames per step at 24 fps ("on twelves", 2 steps/s) reads natural,
  12-14 realistic, 16 relaxed. Measured adult cadence: about 101 steps/min at 1.0 m/s,
  118 at 1.32 m/s. Contacts, downs, passing and ups fall roughly every quarter step.
- Weight: transfer support before lifting the next foot; heavier characters take
  longer to start, stop and recover. A centre-of-mass projection inside the support
  polygon is a check for slow poses only; dynamic gait legitimately leaves it.
- Camera shake: body sway below about 3 Hz, handheld operator 3-5 Hz, tremor 7-11 Hz
  at under a degree. At 24 fps keep procedural shake mostly below about 5 Hz.

## Solve support instead of fixing floor height

Define stance, rolling contact, sliding contact and flight intervals. During a planted
interval hold the sole/heel/toe contact fixed in world space (or in the moving
support's space) and move the body relative to it; a target that follows the moving
root needs compensating motion. Plan stride targets from the root path (a simple
footstep planner: compute each foot's world target per step, lock it during contact,
arc it during swing) rather than looping feet independently of travel.

Do not raise or lower the whole character each frame to keep the lowest foot on the
floor: that erases jumps and hides bad support planning. Airborne phases release
contacts and follow a coherent flight and landing. Intentional slides get an authored
trajectory. A flat mechanical foot can land flat; do not force a human heel roll.

## Procedural tools that work headless

- **Baking:** `anim_utils.bake_action_objects([(obj, action)], frames=range(a, b + 1),
  bake_options=anim_utils.BakeOptions(only_selected=False, do_pose=True, do_object=False,
  do_visual_keying=True, do_constraint_clear=False, do_parents_clear=False, do_clean=False,
  do_location=True, do_rotation=True, do_scale=False, do_bbone=False, do_custom_props=False))`
  turns IK, constraints or simulations into plain keys without an editor context.
- **Springs:** a critically damped spring (half-life parameter) gives exact,
  frame-rate-independent overlap, camera lag and settles; compute values in Python and key them.
- **F-curve modifiers:** Noise (`scale`, `strength`, `phase` as seed, `depth`,
  `blend_type`) for handheld or idle drift; Cycles for loops; Stepped for
  limited-animation looks. Restrict noise in time with `use_restricted_range`,
  `frame_start`/`frame_end` and `blend_in`/`blend_out`.
- **Rigid-body props:** simulate and bake through the point cache; keep the hero
  motion authored.
- Libraries and add-ons: see [motion design toolkit](motion-design-toolkit.md).

## Camera motion is authored motion

Start with a camera that makes the action readable. Add a dolly, orbit, track or
path only for a reveal or a relationship change. Key the camera's trajectory, timing
and aim independently, then evaluate both together. Dolly and zoom change the image
differently. Check aim flips, clipping, occlusion and framing over the whole shot
(`motion_qa.py` framing check). Keep blur and depth of field mild during contact review.

## Review before dependent generation

Save stage versions (scene/rig, blocking, refined). Then, in a separate run that
reopens the saved file:

1. `motion_qa.py` with a spec written for this shot: contacts on the planted
   intervals, automatic `skating` detection near the floor, floor penetration on
   evaluated meshes, rigid lengths, rotation steps and jerk on the main controls, and
   framing on the shot camera. Choose tolerances from scale and visibility (research
   heuristics: about 2.5 cm slide while within 5 cm of the floor for a 1 m hip;
   5 mm penetration). Expect jerk spikes at authored impacts only.
2. Render the full-duration animatic from the shot camera and a diagnostic angle;
   `media-check.mjs --contact-sheet` for an overview strip.
3. Look at pose strips around contact changes, the action extremes and the payoff;
   review at normal speed when playback is available. A frame strip shows popping,
   interpenetration and sliding between samples poorly; say what was not reviewed.
   Compare the extremes with real footage of the move from a similar angle: a
   landing fold with the elbows riding up over the back read as wings from the front
   and was rejected as inhuman.

Fix structure or motion before paying for any dependent generation. Keep the
editable `.blend`, builder/config, beat/contact plan, named actions, QA reports,
frames and the exact-duration recording together. A Blender-rendered final is the
deterministic baseline whenever exact mechanics matter.

Sources: Blender 5.2 API (`bpy_extras.anim_utils`, `FModifierNoise`), Blender Studio
animation fundamentals, HyperPhysics trajectories, gait cadence (J NeuroEng Rehabil
2007), foot-skate metrics (arXiv 2305.12577, 2610.03691), springs (theorangeduck.com),
mcp-for-blender animation guide (2026-09-30). Earlier studied skills (Scenario, Rivello,
RobLe3, Blender CLI skill) informed the staged workflow; none is a dependency.
