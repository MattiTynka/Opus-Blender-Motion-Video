# Motion design toolkit for Blender 5.x

Snapshot researched 2026-10-09 for Blender 5.2 LTS. Prefer what is built in; an
add-on or package changes the user's Blender or Python, so install one only with
the user's agreement, from extensions.blender.org or the project's own release page,
and record name, version and licence. Recheck versions before relying on them.

Contents: [built in](#built-in-use-first) · [vetted add-ons](#vetted-add-ons-ask-before-installing) ·
[motion sources](#offline-motion-sources) · [avoid](#avoid-or-treat-with-care)

## Built in (use first)

- **Keyframe easing:** each keyframe has `interpolation` (`CONSTANT`, `LINEAR`,
  `BEZIER`, Penner curves `SINE QUAD CUBIC QUART QUINT EXPO CIRC BACK BOUNCE ELASTIC`),
  `easing` (`AUTO`, `EASE_IN`, `EASE_OUT`, `EASE_IN_OUT`) and `back`, `amplitude`,
  `period`. This replaces easing libraries such as pytweening.
- **F-curve modifiers:** Generator, FnGenerator, Envelope, Cycles, Noise, Limits,
  Stepped, Smooth (Gaussian, 5.1+). Restrict them in time with `use_restricted_range`.
- **Baking and channels:** `bpy_extras.anim_utils.bake_action_objects`,
  `action_ensure_channelbag_for_slot`; fast bulk keys with
  `fcurve.keyframe_points.add(n)` + `foreach_set("co", flat_list)` then `fcurve.update()`.
- **Python in Blender:** `numpy` and `mathutils` (vectors, quaternions, `mathutils.noise`,
  `bvhtree` for interpenetration tests) are bundled; scipy is not. Springs,
  second-order dynamics, splines and footstep planners are about 30 lines each:
  write them in the production script.
- **Geometry Nodes** for motion graphics: simulation zones, bundles/closures (5.0),
  lists and Sample Sound Frequencies (5.2, audio-reactive motion), GN modifiers on
  empties, projection/screen-space node assets. Powerful but harder to inspect than
  keys: bake and check the result.
- **Core tools** that need an editor (fine for a person opening the file, not for
  `--background`): Copy Global Transform (core since 5.0), Graph Editor blend/ease/
  smooth operators, in-betweens, motion paths. Headless scripts reimplement the
  maths on keyframe points.
- **Render passes** for conditioning: Z/depth, Mist and Vector passes, or a
  Workbench/EEVEE clay render (see [motion control](motion-and-cinematography.md#send-the-motion-you-reviewed)).

## Vetted add-ons (ask before installing)

| Add-on | Version (date) | Licence | Use | Headless notes |
| --- | --- | --- | --- | --- |
| [Add Camera Rigs](https://extensions.blender.org/add-ons/add-camera-rigs/) | 1.9.1 (2026-10-02) | GPL-3 | Dolly, crane, 2D camera rigs; lens breathing (1.9.0) | `object.build_camera_rig(mode=...)` needs only scene context; its scripted drivers need trusted auto-run |
| [Camera Shakify](https://extensions.blender.org/add-ons/camera-shakify/) | 0.5.1 (2026-02-07) | GPL-3, CC0 shake data | Recorded real handheld shakes | `object.camera_shake_add` with an active camera; scripted drivers as above. Or bake shake keys yourself |
| [Commotion](https://extensions.blender.org/add-ons/commotion/) | 2.5.0 (2025-03-18) | GPL-3 | Offsets, NLA, proximity effector for motion graphics | Uses the slotted-action API; no release in 18 months |
| [Jiggle Physics](https://extensions.blender.org/add-ons/jiggle-physics/) / [Wiggle Bones](https://extensions.blender.org/add-ons/wiggle-bones/) | 4.5.3 (2026-08-16) / 1.1.2 (2026-09-07) | GPL-3 | Secondary jiggle on bones (antennae, cables, soft parts) | Bake to keys; headless baking untested, overlays need a viewport |
| [CloudRig](https://extensions.blender.org/add-ons/cloudrig/) | 2.2.31 (2026-10-05) | GPL-3 | Studio rig generator, face Action set-ups | 2.2.29 changed control rotation modes (check non-XYZ rigs) |
| [Retarget](https://extensions.blender.org/add-ons/retarget/) | 5.2.0 (2026-08-23) | GPL-3 | Free retargeting (Expy Kit/AnimAide lineage) | Only for chosen motion transfer; headless use unverified |
| Auto-Rig Pro | 3.78.63 (2026-10-08) | Paid | Rigging, Smart face, Remap retargeting | Commercial; the user must own it |
| [Pose Shape Keys](https://studio.blender.org/tools/addons/) | 1.1.1 (2026-07-17) | GPL | Corrective shape keys per pose, slot-aware | Blender 5.0+ |
| [EasyWeight](https://studio.blender.org/tools/addons/easy_weight) | Blender Studio | GPL | Weight smoothing, normalising, island cleanup | Mostly interactive tools |

Add-ons that rely on scripted drivers or rig UI scripts do nothing useful in a run
with auto-run disabled; bake their effect to keys, or ask before trusting the file.

## Offline motion sources

These generate or supply motion data. Anything they produce is `imported_motion`
(the user must choose it; record model, version, licence and prompt).

| Source | Licence and limits | Output |
| --- | --- | --- |
| NVIDIA Kimodo (text-to-motion), Windows port kimodo.cpp (2026-09-18) | Code Apache-2.0; SOMA/G1 weights NVIDIA Open Model License (commercial use allowed); SMPL-X checkpoint R&D only; Llama 3 terms on the text encoder | NPZ / GLB; about 17 GB VRAM (under 3 GB with the text encoder on CPU) |
| Tencent HY-Motion 1.0 | Tencent community licence; check territory clauses | Needs 24-26 GB VRAM; community FBX export |
| MoMask | MIT code, trained on HumanML3D (AMASS-derived, research use) | BVH |
| MuJoCo 3.15 (2026-10-05) | Apache-2.0 | Physics simulation in a separate Python process; key the result in Blender |
| Mesh2Motion | CC0 rigs and animations | Library clips |
| Cascadeur 2026.2 | Commercial; free tier limits export | GUI app; FBX/USD |

Run heavy models in their own environment, never inside Blender's Python, and pass
data files (NPZ/BVH/GLB) into a Blender script that reads them as data.

## Avoid or treat with care

- AnimAide (development stopped), Tissue (reported broken on 5.x), Animation Nodes
  (5.x only via daily builds), Sverchok (lists up to 5.1), Rokoko Studio Live (last
  stated support Blender 4.4), stale pybullet and easing-functions packages.
- Any add-on still using `action.fcurves` is broken on Blender 5.x.
- SMPL/SMPL-X/AMASS bodies and data are research or non-commercial licensed.
- Cloud or account-bound tools (animatica plugin, Mixamo, Meshy/Tripo auto-rigging)
  upload assets and may cost credits: they need the same authorization as any paid
  provider call.
- Compiled wheels must match Blender's Python 3.13; since 5.1 user site-packages are
  not loaded unless `--python-use-user-env` is passed. Keep Blender's Python clean.
