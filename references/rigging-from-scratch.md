# Building a rig from scratch

Read when no suitable rig exists. Build only the controls the shot's performance
needs, and test them before choreography. Face rigs are in
[face and lip sync](face-and-lipsync.md); animating an existing rig is in
[ready rig animation](ready-rig-animation.md).

Contents: [choose the route](#choose-the-route) · [mechanical rig](#mechanical-and-rigid-characters) ·
[Rigify humanoid](#organic-humanoids-and-animals-with-rigify) · [weights](#skin-weights) ·
[deformation tests](#deformation-tests-and-correctives) · [deliverable](#make-it-usable-by-a-person)

## Choose the route

| Subject | Route | Why |
| --- | --- | --- |
| Robot, mech, vehicle, armoured prop | Custom armature; each rigid part bone-parented (or one vertex group at weight 1.0) | Armour must not bend; automatic weights make metal rubbery |
| Human or humanoid with soft skin | Rigify human metarig → fit → generate → automatic weights → fix | Tested IK/FK limbs, spine, fingers and face controls in seconds |
| Quadruped, bird, fish | Rigify animal metarigs (`basic_quadruped`, cat, wolf, horse, bird, shark) | Same pipeline; fit carefully to the anatomy |
| Simple prop or creature with few joints | Object hierarchy, empties, or a handful of bones | Fewer moving parts, easier to key |

Mixed characters (a soft pilot inside rigid armour) combine the two: rigid parts
parented to the generated rig's `DEF-` bones, skin weighted normally.

## Mechanical and rigid characters

Tested on 5.2.1 (`animkit.fit_pole_angle`, `animkit.parent_rigid`):

```python
bpy.context.view_layer.objects.active = rig            # rig = new armature object, linked to the scene
bpy.ops.object.mode_set(mode="EDIT")
eb = rig.data.edit_bones
def bone(name, head, tail, parent=None, deform=True, connect=False):
    b = eb.new(name); b.head, b.tail = Vector(head), Vector(tail)
    b.parent, b.use_connect, b.use_deform = (eb[parent] if parent else None), connect, deform
bone("root", (0, 0, 0), (0, 0.4, 0), deform=False)
bone("pelvis", (0, 0, 1.0), (0, 0, 1.2), "root")
bone("thigh.L", (0.15, 0, 1.0), (0.15, -0.05, 0.55), "pelvis")       # pre-bent knee defines the bend plane
bone("shin.L", (0.15, -0.05, 0.55), (0.15, 0, 0.1), "thigh.L", connect=True)
bone("foot_ik.L", (0.15, 0, 0.1), (0.15, -0.2, 0.1), "root", deform=False)   # target outside the chain
bone("knee_pole.L", (0.15, -0.8, 0.55), (0.15, -0.9, 0.55), "root", deform=False)
bpy.ops.object.mode_set(mode="POSE")
ik = rig.pose.bones["shin.L"].constraints.new("IK")
ik.target, ik.subtarget, ik.pole_target, ik.pole_subtarget = rig, "foot_ik.L", rig, "knee_pole.L"
ik.chain_count, ik.use_stretch = 2, False
ak.fit_pole_angle(rig, "shin.L")                       # keeps the rest pose; returned -90 here
bpy.ops.object.mode_set(mode="OBJECT")
ak.parent_rigid(armor_part, rig, "shin.L")             # no weights, no deformation
```

- Put each bone's head at the real hinge, with the bone's Y axis along the part and
  roll chosen so the hinge rotates about one local axis. Add `LIMIT_ROTATION` for
  single-axis joints and leave clearance between armour plates.
- Pistons: two bones that `DAMPED_TRACK` each other (cylinder and rod), each parented
  to the parts they connect. Wheels: rotation from distance travelled (`distance / radius`).
- Pre-bend every two-segment chain; keep IK targets and poles outside the chain to
  avoid dependency cycles; keep stretch off.
- Split a single mesh into parts, or give each part one vertex group at weight 1.0
  with an Armature modifier; never smooth weights across rigid seams.

## Organic humanoids and animals with Rigify

```python
addon_utils.enable("rigify", default_set=True)
bpy.ops.object.armature_human_metarig_add()        # human with face and fingers; basic_human has neither
meta = bpy.context.object
# fit: edit meta's bones (head/tail/roll) to the mesh landmarks, see below
bpy.ops.pose.rigify_generate()                     # with the metarig active; works headless
rig = bpy.context.view_layer.objects.active        # "rig": controls, ORG/MCH/DEF bones, rig_ui.py
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")    # automatic (bone heat) weights to DEF bones
```

Fitting is the step that decides quality:

- Scale and place the metarig from measured landmarks of the evaluated mesh (floor,
  crotch, knees, ankles, shoulders, elbows, wrists, chin, eye centres). Measure with
  vertex positions or bounding boxes per region; do not eyeball a rest pose you cannot see.
- Keep knees slightly forward and elbows slightly back so IK has a bend direction;
  keep left/right symmetric (mirror X); align bone rolls with the joint's hinge axis.
- Generate, then inspect with `inspect_rig.py` (collections, `IK_FK` switches, controls)
  and run the stress poses below before animating.
- The full human metarig uses Rigify's legacy face; `bpy.ops.pose.rigify_upgrade_face()`
  converts it to the newer skin-chain face. Fitting all face bones is laborious; for a
  stylised or simple face prefer the lightweight face rig in [face and lip sync](face-and-lipsync.md).

## Skin weights

- `ARMATURE_AUTO` (bone heat) needs one closed, manifold, non-self-intersecting mesh
  at a sensible scale. It fails or leaks on separate islands (eyes, teeth, buttons),
  duplicate vertices, inner geometry and touching fingers ("Bone Heat Weighting:
  failed to find solution"). Fix the mesh (merge by distance, remove interior faces),
  or weight a clean proxy and transfer weights (Data Transfer modifier, nearest face
  interpolated), and bone-parent rigid accessories.
- After weighting: zero unweighted vertices on deforming meshes (`inspect_rig.py`
  reports `unweighted_vertices`), weights normalised, at most four influences when
  the result must export to a game engine, no influence from distant bones (a hand
  bone moving the hip).
- Enable `use_deform_preserve_volume` (dual quaternion) only after testing; it keeps
  twisting volumes but can bulge elbows. Bendy bones (Rigify tweak segments) smooth
  long limbs and spines.

## Deformation tests and correctives

Before choreography render front and side clay views of: rest, deep crouch, full
reach overhead, arms forward and crossed, single-leg support, a 90 degree twist, the
shot's own extreme poses, and (for faces) jaw open, smile, blink. Look for collapsing
elbows/knees, candy-wrapper twists, shoulder pinching, intersections and stretched
textures. Fix weights first; then add corrective shape keys driven by bone rotation:
a driver variable of type `TRANSFORMS` on the bone's local rotation with a simple
expression (`max(0, var / 1.57)`), which evaluates without Python (safe with
auto-run disabled). Record which correctives exist and their driving range.

## Make it usable by a person

The user may open the file. Give controls simple custom shapes, put them in bone
collections (`Controls`, `IK`, `FK`, `Face`, hidden `DEF`/`MCH`), colour left/right
consistently, lock unused channels, and name everything with `.L`/`.R` suffixes so
mirroring works. Save the rig in a rest pose with no action assigned, plus a separate
test action with the stress poses.
