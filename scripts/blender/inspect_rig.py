"""Map an unknown rig before animating it. Read-only; writes one JSON report.

blender --background --factory-startup --disable-autoexec --python inspect_rig.py -- \
    --blend character.blend --output rig-report.json [--rig RIG-Name]

Opens the file with embedded scripts disabled, so rig UI panels are not registered
and scripted (non-simple) drivers may not evaluate; both are reported.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

import bpy

SWITCH_WORDS = re.compile(r"ik|fk|stretch|follow|parent|pole|space|switch|snap|pin|lock", re.I)
ARKIT = {n.lower() for n in (
    "eyeBlinkLeft eyeLookDownLeft eyeLookInLeft eyeLookOutLeft eyeLookUpLeft eyeSquintLeft "
    "eyeWideLeft eyeBlinkRight eyeLookDownRight eyeLookInRight eyeLookOutRight eyeLookUpRight "
    "eyeSquintRight eyeWideRight jawForward jawLeft jawRight jawOpen mouthClose mouthFunnel "
    "mouthPucker mouthLeft mouthRight mouthSmileLeft mouthSmileRight mouthFrownLeft "
    "mouthFrownRight mouthDimpleLeft mouthDimpleRight mouthStretchLeft mouthStretchRight "
    "mouthRollLower mouthRollUpper mouthShrugLower mouthShrugUpper mouthPressLeft "
    "mouthPressRight mouthLowerDownLeft mouthLowerDownRight mouthUpperUpLeft mouthUpperUpRight "
    "browDownLeft browDownRight browInnerUp browOuterUpLeft browOuterUpRight cheekPuff "
    "cheekSquintLeft cheekSquintRight noseSneerLeft noseSneerRight tongueOut").split()}


def report_path(target, report):
    """Path relative to the report's folder (a file on another drive by name only), never local folders."""
    try:
        return os.path.relpath(Path(target).resolve(), Path(report).resolve().parent)
    except ValueError:
        return Path(target).name


def norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def ui_range(owner, key):
    try:
        data = owner.id_properties_ui(key).as_dict()
        return {k: data[k] for k in ("min", "max", "default") if k in data}
    except (TypeError, KeyError, AttributeError):
        return {}


def props(owner, only_switches=False):
    out = {}
    for key in owner.keys():
        if key.startswith("_") or (only_switches and not SWITCH_WORDS.search(key)):
            continue
        value = owner[key]
        if isinstance(value, (int, float, str, bool)):
            out[key] = {"value": value, **ui_range(owner, key)}
    return out


def family(rig):
    names = {b.name for b in rig.data.bones}
    keys = set(rig.keys()) | set(rig.data.keys())
    # CloudRig shares Rigify's ORG/MCH/DEF naming, so test it first.
    if any("cloudrig" in k.lower() for k in keys) or ("Properties" in names and any(
            k.startswith("ik_") for k in rig.pose.bones["Properties"].keys())):
        return "cloudrig"
    if "rig_id" in keys or ("torso" in names and any(n.startswith(("ORG-", "MCH-", "DEF-")) for n in names)):
        return "rigify"
    if "c_root.x" in names or "c_traj" in names:
        return "auto_rig_pro"
    if any(n.startswith("mixamorig") for n in names):
        return "mixamo"
    if any(n.startswith("J_Bip") for n in names):
        return "vrm"
    return "custom"


def deformed_meshes(rig):
    return [o for o in bpy.data.objects if o.type == "MESH" and any(
        m.type == "ARMATURE" and m.object == rig for m in o.modifiers)]


def mesh_report(obj, deform_names):
    groups = {g.index: g.name for g in obj.vertex_groups}
    unweighted = sum(1 for v in obj.data.vertices if not any(
        g.weight > 0 and groups.get(g.group) in deform_names for g in v.groups))
    keys = obj.data.shape_keys
    names = [k.name for k in keys.key_blocks] if keys else []
    driven = sorted({d.data_path for d in keys.animation_data.drivers}) if keys and keys.animation_data else []
    return {"name": obj.name, "vertices": len(obj.data.vertices), "hidden_render": obj.hide_render,
            "unweighted_vertices": unweighted, "modifiers": [m.type for m in obj.modifiers],
            "shape_keys": names[:300], "shape_key_count": len(names),
            "arkit_matches": sorted(n for n in names if norm(n) in ARKIT),
            "driven_shape_key_paths": driven[:100]}


def drivers(id_data):
    ad = getattr(id_data, "animation_data", None)
    rows = []
    for fc in ad.drivers if ad else []:
        d = fc.driver
        rows.append({"path": fc.data_path, "index": fc.array_index, "type": d.type,
                     "valid": bool(fc.is_valid and d.is_valid),
                     "needs_python": d.type == "SCRIPTED" and not d.is_simple_expression})
    return rows


def rig_report(rig):
    data = rig.data
    deform = {b.name for b in data.bones if b.use_deform}
    ik_targets = set()
    constraints = []
    for pb in rig.pose.bones:
        for c in pb.constraints:
            row = {"bone": pb.name, "type": c.type, "name": c.name, "mute": c.mute,
                   "influence": round(c.influence, 4)}
            if c.type == "IK":
                row.update(target=getattr(c.target, "name", None), subtarget=c.subtarget,
                           pole=c.pole_subtarget, chain_count=c.chain_count, use_stretch=c.use_stretch)
                ik_targets.update(x for x in (c.subtarget, c.pole_subtarget) if x)
            constraints.append(row)
    controls = []
    for pb in rig.pose.bones:
        bone = pb.bone
        if bone.use_deform or pb.name.startswith(("ORG-", "MCH-", "DEF-")):
            continue
        if pb.custom_shape is None and pb.name not in ik_targets:
            continue
        controls.append({"name": pb.name, "collections": [c.name for c in bone.collections],
                         "rotation_mode": pb.rotation_mode, "parent": bone.parent.name if bone.parent else None,
                         "lock_location": list(pb.lock_location), "lock_rotation": list(pb.lock_rotation),
                         "is_ik_target": pb.name in ik_targets, "switches": props(pb, True)})
    ad = rig.animation_data
    rig_drivers = drivers(rig) + drivers(data)
    return {
        "name": rig.name, "family_guess": family(rig), "bones": len(data.bones),
        "deform_bones": len(deform), "control_count": len(controls),
        "collections": [{"name": c.name, "visible": c.is_visible, "bones": len(c.bones),
                         "parent": c.parent.name if c.parent else None} for c in data.collections_all],
        "controls": controls,
        "property_bones": {pb.name: props(pb) for pb in rig.pose.bones
                           if len([k for k in pb.keys() if not k.startswith("_")]) >= 3},
        "object_properties": props(rig), "armature_properties": props(data),
        "ik_constraints": [c for c in constraints if c["type"] == "IK"],
        "constraint_types": sorted({c["type"] for c in constraints}),
        "constraint_count": len(constraints),
        "drivers": {"count": len(rig_drivers), "invalid": [d for d in rig_drivers if not d["valid"]][:50],
                    "needs_python": sum(d["needs_python"] for d in rig_drivers)},
        "assigned_action": ad.action.name if ad and ad.action else None,
        "assigned_slot": ad.action_slot.identifier if ad and ad.action_slot else None,
        "nla_tracks": [t.name for t in ad.nla_tracks] if ad else [],
        "meshes": [mesh_report(o, deform) for o in deformed_meshes(rig)],
    }


def action_report(action, rig_bones):
    paths = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                paths += [fc.data_path for fc in bag.fcurves]
    bones = {p.split('"')[1] for p in paths if p.startswith('pose.bones["')}
    start, end = action.frame_range
    return {"name": action.name, "is_asset": action.asset_data is not None,
            "slots": [s.identifier for s in action.slots], "frame_range": [start, end],
            "fcurves": len(paths), "bones": len(bones),
            "bones_found_in_rig": len(bones & rig_bones) if rig_bones else None}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--rig")
    args = parser.parse_args(argv)
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    rigs = [o for o in scene.objects if o.type == "ARMATURE"]
    if args.rig:
        rigs = [o for o in rigs if o.name == args.rig]
        if not rigs:
            raise SystemExit(f"No armature named {args.rig!r} in the active scene")
    rig_bones = {b.name for r in rigs for b in r.data.bones}
    report = {
        "blend": report_path(args.blend, args.output), "blender": bpy.app.version_string,
        "scene": {"name": scene.name, "fps": scene.render.fps / scene.render.fps_base,
                  "frame_range": [scene.frame_start, scene.frame_end],
                  "camera": scene.camera.name if scene.camera else None, "unit_scale": scene.unit_settings.scale_length},
        "texts": [t.name for t in bpy.data.texts],
        "autoexec_note": "Opened with scripts disabled: rig UI panels (e.g. rig_ui.py) are not registered; "
                         "drivers marked needs_python only evaluate with trusted auto-run enabled.",
        "rigs": [rig_report(r) for r in rigs],
        "actions": [action_report(a, rig_bones) for a in bpy.data.actions],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"rigs": [(r["name"], r["family_guess"], r["bones"], r["control_count"]) for r in report["rigs"]],
                      "actions": len(report["actions"]),
                      "pose_assets": sum(a["is_asset"] for a in report["actions"]),
                      "output": str(args.output)}))


if __name__ == "__main__":
    main()
