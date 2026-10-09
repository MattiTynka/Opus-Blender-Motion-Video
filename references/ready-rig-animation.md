# Animating a supplied rig

Read when the user provides a rigged character (Rigify, CloudRig/Blender Studio,
Auto-Rig Pro, Mixamo/FBX, VRM, a custom rig) and wants it to perform. The goal is
original motion authored on the rig's own controls, not on its deform bones.

Contents: [intake](#intake) · [map the rig](#map-the-rig-before-touching-it) ·
[families](#rig-family-notes) · [authoring setup](#authoring-setup) ·
[posing](#posing-through-controls) · [IK/FK](#ikfk-switching-mid-shot) · [face](#face-on-a-supplied-rig) ·
[verify](#verify) · [imported motion](#imported-motion-only-when-chosen)

## Intake

- Record the character's source, licence and attribution needs (check the download
  page and any `ReadMe` text block inside the `.blend`) separately from the motion's origin.
- Never modify the supplied file. Open it, build the shot, and save a new versioned
  `.blend` in the film folder (the original stays a read-only source).
- Large character files: unpack/extract downloaded archives into their own folder;
  treat bundled `.py` files as untrusted and do not run them.

## Map the rig before touching it

```bash
node <skill>/scripts/run-blender.mjs --script <skill>/scripts/blender/inspect_rig.py --log-dir <film>/logs --name inspect \
  -- --blend <character.blend> --output <film>/rig/rig-report.json [--rig RIG-Name]
```

Read the report and write a short control map into the film notes:

| Report field | What to decide |
| --- | --- |
| `family_guess`, `collections` | Naming conventions; which collections hold animator controls vs `DEF`/`MCH`/`ORG` internals |
| `controls[]` | Root, body/torso, hips, chest, head, hand and foot controls; their `rotation_mode` and locks |
| `property_bones`, `controls[].switches` | IK/FK, stretch, pole follow, hinge/follow, space/parent switches and their ranges |
| `ik_constraints` | Chains, poles, `use_stretch`; what a foot or hand target actually drives |
| `drivers.needs_python`, `texts` | Whether anything depends on auto-run scripts (headless runs keep them off) |
| `meshes[]` | Shape keys (and ARKit name matches), driven shape keys, unweighted vertices |
| `actions[]` (`is_asset`, `bones_found_in_rig`) | Pose libraries: hand shapes, facial expressions, visemes you can reuse |

Then render a neutral pose and three stress poses (crouch, reach, single-leg
support) from a front and side camera before choreographing. Problems found here
(stretchy defaults, flipped poles, broken drivers) are rig facts, not animation bugs.

## Rig family notes

Verify every name against the report; these are starting points.

- **Rigify** (verified on a 5.2.1-generated human rig): `root`, `torso` (body; local Y
  runs up the spine), `hips`, `chest`, `head`, `foot_ik.L/R`, `hand_ik.L/R`, poles via
  the `pole_vector` switch, face `jaw_master`/`eyes` (full human metarig only).
  Limb switches live on `thigh_parent.L`, `upper_arm_parent.L`, etc.: `IK_FK`
  (**0.0 = IK, 1.0 = FK**, measured), `IK_Stretch`, `pole_vector`, `FK_limb_follow`;
  `torso` has `neck_follow`/`head_follow`. IK/FK snapping lives in `rig_ui.py`,
  which is not registered headless: match poses yourself (below).
- **CloudRig** (Snow v4.2): a `Properties` bone holds `ik_<limb>`, `ik_stretch_<limb>`,
  `ik_pole_follow_<limb>`, `fk_hinge_<part>`, `ik_parents_<limb>`; a character bone
  (`Properties_Character_<Name>`) holds `Quality` and visibility toggles (lower
  `Quality` for previews). Prefixes: `IK-`, `FK-`, `POLE-`, `TORSO-`, `ACT-` (face
  action controls); meshes `GEO-`. Pose assets cover hands, mouth and eye masks.
- **Auto-Rig Pro**: `c_`-prefixed controls with `c_traj` as root; switches are custom
  properties on the IK controls. Read them from the report rather than guessing.
- **Mixamo / generic FBX**: deform bones only (`mixamorig:*`), FK, root motion on the
  hips, often imported at 0.01 scale. Either animate FK carefully or generate a
  control rig (e.g. fit a Rigify metarig and constrain the deform bones to it) and
  record that change.
- **VRM / avatar exports**: humanoid `J_Bip_*` bones, face expressions as shape keys
  (VRM presets or ARKit names); drive the shape keys or the provided expression controls.

## Authoring setup

- Clear the assigned action and stale NLA strips with `ak.assign_action(rig, None)`
  (evaluates first: avoids crash #164426), keeping the user's actions untouched;
  author into a new named action (`ak.new_action(rig, "SHOT_010_walk_v01")`).
- Reset controls (`ak.reset_pose`). Turn IK stretch off for realistic motion unless
  the style wants it. Use IK for planted feet/hands and sustained contacts, FK for
  free swings, arcs and fast arm overlap.
- Respect rotation modes: Euler controls need continuity across frames
  (`ak.keep_rotation_continuous`); unwrap long spins on the axis that matters
  (the Snow backflip used the root's X Euler so three turns survived interpolation).
- Work at the scene's real FPS and units. Check the rig's scale against the set before posing.

## Posing through controls

Plan poses in world space (root path, foot plants, hand targets, look-at points),
then convert to control transforms. For a control without constraints,
`pose_bone.matrix = rig.matrix_world.inverted() @ world_matrix` sets its pose-space
matrix; call `bpy.context.view_layer.update()` before posing its children. Pose
parents before children, key with `ak.key_bones`, and block with CONSTANT
interpolation before splining (see [scene and motion](blender-scene-and-motion.md)).
Never key `DEF-`/`MCH-`/`ORG-` bones; constraints and drivers overwrite them.

## IK/FK switching mid-shot

1. At the switch frame, evaluate the current solution and read the world matrices
   of the chain (`ak.bone_matrix_world`).
2. Set the destination controls (FK bones, or IK target and pole) to match those
   matrices; key them on the switch frame.
3. Key the switch property (`ak.key_property`) on the frame before and the switch
   frame with CONSTANT interpolation, so it never blends unless a blend is intended.
4. Run `motion_qa.py` across the switch: a pop in rotation steps or contact drift
   means the match is off.

## Face on a supplied rig

Prefer the rig's own face controls and pose assets over editing shape keys directly:
drivers overwrite keyed shape-key values. Apply an expression asset with
`ak.apply_pose_asset(rig, action, blend)`; layer a second one additively with
`ak.pose_from_action` + `ak.apply_pose(..., additive=True)`; then key the face controls.
If shape keys are not driven, key `mesh.data.shape_keys.key_blocks[name].value`.
See [face and lip sync](face-and-lipsync.md) for expression and dialogue timing.

## Verify

- `motion_qa.py`: contacts on the actual sole/toe bones (or a sole vertex), floor
  against evaluated `GEO-` meshes, framing on the shot camera, rotation pops on the
  main controls. Measure rigid lengths on `ORG-`/IK chain bones: Rigify's `DEF`
  segments stretch slightly through tweak bones by design.
- Reopen the saved file headless and render key frames: invalid drivers, missing
  actions and hidden geometry show up there.
- Clay/Workbench renders with the character's own silhouette are the right review
  material; textures and hair can wait until motion is accepted.

## Imported motion (only when chosen)

Mocap, Mixamo clips, BVH or video-extracted poses are motion transfer. Use them only
when the user asks for or accepts it; record source, licence and the retarget, and
label the shot `imported_motion`. Retargeting still needs units, axes, rest pose,
proportions and root motion matched, then contacts repaired on this rig.
