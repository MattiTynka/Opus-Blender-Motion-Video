"""Data-API helpers for authoring and sampling animation in Blender 5.x.

Import from a production script that Blender runs:

    import sys
    sys.dont_write_bytecode = True
    sys.path.insert(0, "<skill>/scripts/blender")
    import animkit as ak

Uses no editor-context operators except save_blend(); makes no network calls.
Verified against Blender 5.2.1 LTS (slotted actions; legacy Action.fcurves is gone).
"""
import math

import bpy
from bpy_extras import anim_utils
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Quaternion, Vector

ROTATION_PATH = {"QUATERNION": "rotation_quaternion", "AXIS_ANGLE": "rotation_axis_angle"}
REST_VALUE = {"location": 0.0, "rotation_euler": 0.0, "scale": 1.0}


def frames_for(seconds, fps):
    """Frame count for a duration; 5 s at 30 fps is 150 frames (1..150 inclusive)."""
    return round(seconds * fps)


def rotation_path(pose_bone_or_object):
    return ROTATION_PATH.get(pose_bone_or_object.rotation_mode, "rotation_euler")


# --- F-curves on slotted actions ------------------------------------------------

def fcurves(id_data):
    """F-curves of the action slot assigned to ``id_data`` (empty if unanimated)."""
    ad = id_data.animation_data
    if ad is None or ad.action is None:
        return []
    bag = anim_utils.animdata_get_channelbag_for_assigned_slot(ad)
    return list(bag.fcurves) if bag else []


def action_fcurves(action):
    """Every F-curve in every layer/strip/channelbag of an action (e.g. a pose asset)."""
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def set_interpolation(id_data, interpolation, *, path_contains=None, frames=None, easing=None):
    """Set interpolation ('CONSTANT' for blocking, 'BEZIER', 'LINEAR') on assigned-slot keys."""
    wanted = None if frames is None else {float(f) for f in frames}
    for fc in fcurves(id_data):
        if path_contains and path_contains not in fc.data_path:
            continue
        for key in fc.keyframe_points:
            if wanted is None or key.co.x in wanted:
                key.interpolation = interpolation
                if easing:
                    key.easing = easing
        fc.update()


def set_handles(id_data, handle_type="AUTO_CLAMPED", *, path_contains=None):
    for fc in fcurves(id_data):
        if path_contains and path_contains not in fc.data_path:
            continue
        for key in fc.keyframe_points:
            key.handle_left_type = key.handle_right_type = handle_type
        fc.update()


def assign_action(obj, action, slot=None):
    """Assign (or clear, with action=None) an action safely.

    Blender 5.0.1-5.2.x can crash (#164426) when an armature's action/slot changes
    before its pose was ever evaluated, so evaluate the view layer first.
    """
    bpy.context.view_layer.update()
    ad = obj.animation_data or obj.animation_data_create()
    ad.action = action
    if action is not None:
        ad.action_slot = slot or (ad.action_suitable_slots[0] if ad.action_suitable_slots
                                  else action.slots.new(id_type=obj.id_type, name=obj.name))
    return ad


def new_action(obj, name):
    """Create an empty action with a slot for ``obj`` and assign it."""
    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type=obj.id_type, name=obj.name)
    assign_action(obj, action, slot)
    return action


# --- Keying ---------------------------------------------------------------------

def key_bones(rig, names, frame, *, location=True, rotation=True, scale=False,
              keytype="KEYFRAME"):
    """Key the named pose bones at ``frame``; F-curves are grouped by bone name."""
    for name in names:
        pb = rig.pose.bones[name]
        paths = (["location"] if location else []) + ([rotation_path(pb)] if rotation else [])
        paths += ["scale"] if scale else []
        for path in paths:
            pb.keyframe_insert(path, frame=frame, group=name, keytype=keytype)


def key_object(obj, frame, paths=("location", "rotation_euler"), keytype="KEYFRAME"):
    for path in paths:
        obj.keyframe_insert(path, frame=frame, keytype=keytype)


def key_property(owner, prop, value, frame, *, group=""):
    """Key a custom property such as an IK/FK switch: ``key_property(pb, 'IK_FK', 1.0, 24)``."""
    owner[prop] = value
    owner.keyframe_insert(f'["{prop}"]', frame=frame, group=group)


def reset_pose(rig, names=None):
    for pb in rig.pose.bones if names is None else (rig.pose.bones[n] for n in names):
        pb.matrix_basis.identity()


def keep_rotation_continuous(rig, names, previous):
    """Call after posing each frame: avoids Euler flips and quaternion sign jumps.

    ``previous`` is a dict the caller keeps between frames.
    """
    for name in names:
        pb = rig.pose.bones[name]
        if pb.rotation_mode == "QUATERNION":
            q = pb.rotation_quaternion
            if name in previous and q.dot(previous[name]) < 0:
                pb.rotation_quaternion = -q
            previous[name] = pb.rotation_quaternion.copy()
        elif pb.rotation_mode != "AXIS_ANGLE":
            if name in previous:
                pb.rotation_euler.make_compatible(previous[name])
            previous[name] = pb.rotation_euler.copy()


# --- Pose assets without an asset-browser context --------------------------------

def apply_pose_asset(rig, action, blend=1.0, frame=1.0):
    """Apply a pose-asset action with Blender's own API (works headless).

    Bone selection limits which bones are posed, so all bones are deselected first.
    """
    for pb in rig.pose.bones:
        pb.select = False
    if blend >= 1.0:
        rig.pose.apply_pose_from_action(action, evaluation_time=frame)
    else:
        rig.pose.blend_pose_from_action(action, blend_factor=blend, evaluation_time=frame)
    bpy.context.view_layer.update()


def pose_from_action(rig, action, frame=1.0):
    """Read bone transform values from an action, e.g. to layer poses additively.

    Returns ({(bone, path, index): value}, skipped_paths). Bones missing from the rig
    and non-transform channels are skipped and reported, never guessed.
    """
    values, skipped = {}, []
    for fc in action_fcurves(action):
        path = fc.data_path
        if not path.startswith('pose.bones["') or '"]' not in path:
            skipped.append(path)
            continue
        bone, _, prop = path[len('pose.bones["'):].partition('"].')
        if bone not in rig.pose.bones or prop not in (
                "location", "rotation_euler", "rotation_quaternion", "scale"):
            skipped.append(path)
            continue
        values[(bone, prop, fc.array_index)] = fc.evaluate(frame)
    return values, skipped


def apply_pose(rig, values, amount=1.0, additive=False):
    """Blend from rest toward ``values`` by ``amount``.

    ``additive=True`` adds the pose's offset from rest to the current pose instead, so
    a mouth shape and an eyelid shape can be layered. Quaternions use slerp.
    """
    quats = {}
    for (bone, prop, index), value in values.items():
        if prop == "rotation_quaternion":
            quats.setdefault(bone, [1.0, 0.0, 0.0, 0.0])[index] = value
            continue
        rest = REST_VALUE[prop]
        channel = getattr(rig.pose.bones[bone], prop)
        base = channel[index] if additive else rest
        if prop == "scale" and additive:
            channel[index] = base * (1.0 + (value - 1.0) * amount)
        else:
            channel[index] = base + (value - rest) * amount
    for bone, q in quats.items():
        pb = rig.pose.bones[bone]
        delta = Quaternion().slerp(Quaternion(q).normalized(), amount)
        pb.rotation_quaternion = pb.rotation_quaternion @ delta if additive else delta
    bpy.context.view_layer.update()


def fit_pole_angle(rig, bone_name, constraint="IK", steps=72):
    """Choose the IK pole angle that leaves the rest pose unchanged; returns degrees.

    Call with the IK target and pole controls at rest. The chain's rest-pose world
    matrices are the reference; candidates are tested every 360/steps degrees.
    """
    ik = rig.pose.bones[bone_name].constraints[constraint]
    chain, pb = [], rig.pose.bones[bone_name]
    for _ in range(ik.chain_count or 1):
        chain.append(pb.name)
        pb = pb.parent
        if pb is None:
            break
    ik.mute = True
    bpy.context.view_layer.update()
    rest = {n: rig.pose.bones[n].matrix.copy() for n in chain}
    ik.mute = False
    best = (math.inf, 0.0)
    for i in range(steps):
        ik.pole_angle = math.radians(-180 + i * 360 / steps)
        bpy.context.view_layer.update()
        err = sum((rig.pose.bones[n].matrix.to_quaternion().rotation_difference(rest[n].to_quaternion()).angle)
                  for n in chain)
        best = min(best, (err, ik.pole_angle))
    ik.pole_angle = best[1]
    bpy.context.view_layer.update()
    return math.degrees(best[1])


def parent_rigid(obj, rig, bone_name):
    """Parent a mesh part to one bone without moving it (rigid armour, no weights)."""
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent, obj.parent_type, obj.parent_bone = rig, "BONE", bone_name
    obj.matrix_parent_inverse.identity()
    bpy.context.view_layer.update()
    obj.matrix_world = world


def key_mouth_cues(cues, shapes, fps, *, start_frame=1, min_frames=2, hold_rest="X"):
    """Key lip-sync cues (Rhubarb-style ``[{"start": s, "end": s, "value": "A"}]``).

    ``shapes`` maps a cue value to ``{(owner, data_path): value}``, where owner is a
    shape-key block, pose bone or object and data_path a property such as "value" or
    '["jawOpen"]'. Every channel used by any shape is keyed at every cue (absent
    channels go to 0), so shapes never accumulate. Cues shorter than ``min_frames``
    are merged into the next one to avoid flapping. Returns the keyed frames.
    """
    channels = sorted({ch for shape in shapes.values() for ch in shape}, key=lambda c: (str(c[0]), c[1]))
    keyed, pending = [], None
    for cue in cues:
        frame = start_frame + round(cue["start"] * fps)
        length = round((cue["end"] - cue["start"]) * fps)
        if keyed and frame <= keyed[-1]:
            continue
        if length < min_frames and cue is not cues[-1]:
            pending = pending or frame
            continue
        frame, pending = (pending or frame), None
        shape = shapes.get(cue["value"], shapes.get(hold_rest, {}))
        for owner, path in channels:
            value = shape.get((owner, path), 0.0)
            if path.startswith('["'):
                owner[path[2:-2]] = value
            else:
                setattr(owner, path, value)
            owner.keyframe_insert(path, frame=frame)
        keyed.append(frame)
    return keyed


# --- Evaluated sampling -----------------------------------------------------------

def evaluate(scene, frame, subframe=0.0):
    scene.frame_set(int(frame), subframe=subframe)
    return bpy.context.evaluated_depsgraph_get()


def bone_matrix_world(rig, name, depsgraph):
    evaluated = rig.evaluated_get(depsgraph)
    return evaluated.matrix_world @ evaluated.pose.bones[name].matrix


def bone_point_world(rig, name, depsgraph, point="head"):
    """World position of a bone's head, tail, or a bone-local offset (x, y, z)."""
    pb = rig.evaluated_get(depsgraph).pose.bones[name]
    world = rig.evaluated_get(depsgraph).matrix_world
    if point == "head":
        return world @ pb.head
    if point == "tail":
        return world @ pb.tail
    return world @ pb.matrix @ Vector(point)


def mesh_points_world(obj, depsgraph):
    """Evaluated vertex positions (after armature/shape keys/modifiers)."""
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return [evaluated.matrix_world @ v.co for v in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()


def lowest_z(objects, depsgraph):
    return min(p.z for obj in objects for p in mesh_points_world(obj, depsgraph))


def camera_bounds(scene, camera, objects, depsgraph):
    """Normalised (min_x, min_y, max_x, max_y) of evaluated geometry in the camera frame.

    0..1 is inside the image; also returns whether any vertex was behind the camera.
    """
    lo, hi, behind = Vector((math.inf, math.inf)), Vector((-math.inf, -math.inf)), False
    for obj in objects:
        for p in mesh_points_world(obj, depsgraph):
            v = world_to_camera_view(scene, camera, p)
            behind |= v.z <= 0
            lo.x, lo.y = min(lo.x, v.x), min(lo.y, v.y)
            hi.x, hi.y = max(hi.x, v.x), max(hi.y, v.y)
    return (lo.x, lo.y, hi.x, hi.y), behind


# --- Scene utilities --------------------------------------------------------------

def look_at(obj, target):
    """Aim a camera/light (-Z forward, Y up) at a world point."""
    direction = Vector(target) - obj.matrix_world.translation
    obj.rotation_mode = "XYZ"
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def set_markers(scene, beats, clear=True):
    """``beats`` maps label -> frame, e.g. {'ANTICIPATION': 1, 'CONTACT_L': 18}."""
    if clear:
        scene.timeline_markers.clear()
    for label, frame in beats.items():
        scene.timeline_markers.new(label, frame=int(frame))


def stamp_provenance(scene, motion_origin, description, **extra):
    """motion_origin: authored_keyframes | authored_procedural | imported_motion."""
    if motion_origin not in ("authored_keyframes", "authored_procedural", "imported_motion"):
        raise ValueError("unknown motion_origin")
    scene["motion_origin"] = motion_origin
    scene["motion_description"] = description
    for key, value in extra.items():
        scene[key] = value


def save_blend(path, compress=True):
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=compress)
