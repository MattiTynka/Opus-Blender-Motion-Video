"""Measure authored motion in a saved .blend against a JSON check spec.

blender --background --factory-startup --disable-autoexec --python motion_qa.py -- \
    --blend shot.blend --spec qa-spec.json --output motion-qa.json [--fail-on-tolerance]

Spec (all sections optional; units are scene units, angles degrees, frames inclusive):
{
  "frames": [1, 150], "substeps": 1,
  "floor":   {"z": 0.0, "objects": ["GEO-body"], "prefix": "GEO-", "tolerance": 0.005},
  "contacts": [{"label": "left sole", "rig": "RIG", "bone": "foot.L", "point": "head",
                "intervals": [[1, 29], [73, 150]], "axes": "xyz", "tolerance": 0.003}],
  "lengths": [{"rig": "RIG", "bones": ["DEF-thigh.L", "DEF-shin.L"], "tolerance": 0.001}],
  "pops":    [{"rig": "RIG", "bones": ["torso"], "max_deg_per_frame": 25}],
  "skating": [{"label": "left toe", "rig": "RIG", "bone": "toe.L", "point": "tail", "floor_z": 0.0,
               "height": 0.05, "max_slide_per_frame": 0.01}],
  "jerk":    [{"rig": "RIG", "bone": "torso", "point": "head", "max": 400}],
  "framing": {"camera": "Camera", "objects": [], "prefix": "GEO-", "margin": 0.02}
}
"point" is "head", "tail" or a bone-local [x, y, z]. A contact can use "object" and
"vertex" (index) instead of rig/bone. "skating" needs no declared intervals: it sums
horizontal travel of a point while it is within "height" of the floor (a common
research heuristic uses 5 cm height / 2.5 cm slide for a ~1 m hip; scale both to the
character). "jerk" is the third derivative of a point's path (units/s^3) on whole
frames and exposes jitter. Missing tolerances produce measurements with
passed = null: choose tolerances from scene scale and visibility, not a default.
"""
import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import animkit as ak  # noqa: E402


def report_path(target, report):
    """Path relative to the report's folder (a file on another drive by name only), never local folders."""
    try:
        return os.path.relpath(Path(target).resolve(), Path(report).resolve().parent)
    except ValueError:
        return Path(target).name


def pick_objects(section):
    names = set(section.get("objects", []))
    prefix = section.get("prefix")
    found = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_render and (
        o.name in names or (prefix and o.name.startswith(prefix)))]
    missing = sorted(names - {o.name for o in found})
    if missing:
        raise SystemExit(f"Objects not found or not renderable meshes: {missing}")
    if not found:
        raise SystemExit("A floor/framing section selected no objects")
    return found


def verdict(value, tolerance):
    return None if tolerance is None else value <= tolerance


def contact_point(spec, depsgraph):
    if "object" in spec:
        obj = bpy.data.objects[spec["object"]]
        mesh = obj.evaluated_get(depsgraph).to_mesh()
        try:
            return obj.evaluated_get(depsgraph).matrix_world @ mesh.vertices[spec["vertex"]].co
        finally:
            obj.evaluated_get(depsgraph).to_mesh_clear()
    rig = bpy.data.objects[spec["rig"]]
    return ak.bone_point_world(rig, spec["bone"], depsgraph, spec.get("point", "head"))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--blend", required=True, type=Path)
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--fail-on-tolerance", action="store_true")
    args = parser.parse_args(argv)
    spec = json.loads(args.spec.read_text(encoding="utf-8-sig"))
    bpy.ops.wm.open_mainfile(filepath=str(args.blend.resolve()), load_ui=False, use_scripts=False)
    scene = bpy.context.scene
    first, last = spec.get("frames", [scene.frame_start, scene.frame_end])
    substeps = max(1, int(spec.get("substeps", 1)))
    samples = [(f, s / substeps) for f in range(first, last + 1) for s in range(substeps)
               if f < last or s == 0]

    floor = spec.get("floor")
    floor_objects = pick_objects(floor) if floor else []
    framing = spec.get("framing")
    framing_objects = pick_objects(framing) if framing else []
    camera = bpy.data.objects[framing["camera"]] if framing and framing.get("camera") else scene.camera
    if framing and camera is None:
        raise SystemExit("Framing check needs a camera")

    contact_rows = {i: [] for i in range(len(spec.get("contacts", [])))}
    length_rest = {}
    for item in spec.get("lengths", []):
        rig = bpy.data.objects[item["rig"]]
        for bone in item["bones"]:
            length_rest[(item["rig"], bone)] = rig.data.bones[bone].length * rig.matrix_world.to_scale().x
    length_err = {key: (0.0, None) for key in length_rest}
    pop_prev, pop_max = {}, {}
    skate_paths = {i: [] for i in range(len(spec.get("skating", [])))}
    jerk_paths = {i: [] for i in range(len(spec.get("jerk", [])))}
    floor_min, floor_frame, floor_bad = math.inf, None, []
    frame_worst, frame_bad = (math.inf, None), []
    behind_frames = []

    for frame, sub in samples:
        dg = ak.evaluate(scene, frame, sub)
        t = frame + sub
        if floor:
            z = ak.lowest_z(floor_objects, dg)
            if z < floor_min:
                floor_min, floor_frame = z, t
            tol = floor.get("tolerance")
            if tol is not None and z < floor["z"] - tol:
                floor_bad.append(t)
        for i, item in enumerate(spec.get("contacts", [])):
            if any(a <= t <= b for a, b in item["intervals"]):
                contact_rows[i].append((t, contact_point(item, dg).copy()))
        for (rig_name, bone), rest in length_rest.items():
            rig = bpy.data.objects[rig_name]
            err = abs((ak.bone_point_world(rig, bone, dg, "tail") - ak.bone_point_world(rig, bone, dg, "head")).length - rest)
            if err > length_err[(rig_name, bone)][0]:
                length_err[(rig_name, bone)] = (err, t)
        if sub == 0:
            for i, item in enumerate(spec.get("skating", [])):
                skate_paths[i].append((frame, contact_point(item, dg).copy()))
            for i, item in enumerate(spec.get("jerk", [])):
                jerk_paths[i].append((frame, contact_point(item, dg).copy()))
            for item in spec.get("pops", []):
                rig = bpy.data.objects[item["rig"]]
                for bone in item["bones"]:
                    q = ak.bone_matrix_world(rig, bone, dg).to_quaternion()
                    key = (item["rig"], bone)
                    if key in pop_prev:
                        angle = pop_prev[key].rotation_difference(q).angle
                        deg = math.degrees(min(angle, 2 * math.pi - angle))  # q and -q are the same rotation
                        if deg > pop_max.get(key, (0, None))[0]:
                            pop_max[key] = (deg, frame)
                    pop_prev[key] = q
            if framing:
                (x0, y0, x1, y1), behind = ak.camera_bounds(scene, camera, framing_objects, dg)
                margin = min(x0, y0, 1 - x1, 1 - y1)
                if margin < frame_worst[0]:
                    frame_worst = (margin, frame)
                if behind:
                    behind_frames.append(frame)
                if margin < framing.get("margin", 0.0):
                    frame_bad.append(frame)

    results = []
    if floor:
        penetration = max(0.0, floor["z"] - floor_min)
        results.append({"check": "floor", "lowest_z": floor_min, "frame": floor_frame,
                        "max_penetration": penetration, "violations": floor_bad[:50],
                        "passed": None if floor.get("tolerance") is None else not floor_bad})
    for i, item in enumerate(spec.get("contacts", [])):
        axes = ["xyz".index(a) for a in item.get("axes", "xyz")]
        worst = (0.0, None)
        for a, b in item["intervals"]:
            rows = [(t, p) for t, p in contact_rows[i] if a <= t <= b]
            if not rows:
                continue
            anchor = rows[0][1]
            for t, p in rows:
                d = math.sqrt(sum((p[k] - anchor[k]) ** 2 for k in axes))
                if d > worst[0]:
                    worst = (d, t)
        results.append({"check": "contact", "label": item.get("label", item.get("bone")),
                        "max_drift": worst[0], "frame": worst[1], "axes": item.get("axes", "xyz"),
                        "passed": verdict(worst[0], item.get("tolerance"))})
    for item in spec.get("lengths", []):
        for bone in item["bones"]:
            err, t = length_err[(item["rig"], bone)]
            results.append({"check": "length", "bone": bone, "max_error": err, "frame": t,
                             "passed": verdict(err, item.get("tolerance"))})
    for item in spec.get("pops", []):
        for bone in item["bones"]:
            deg, frame = pop_max.get((item["rig"], bone), (0.0, None))
            results.append({"check": "rotation_step", "bone": bone, "max_deg_per_frame": deg,
                            "frame": frame, "passed": verdict(deg, item.get("max_deg_per_frame"))})
    for i, item in enumerate(spec.get("skating", [])):
        floor_z, height = item.get("floor_z", 0.0), item.get("height", 0.05)
        path = skate_paths[i]
        worst, total, bad = (0.0, None), 0.0, []
        for (f0, p0), (f1, p1) in zip(path, path[1:]):
            if p0.z - floor_z <= height and p1.z - floor_z <= height:
                slide = math.hypot(p1.x - p0.x, p1.y - p0.y)
                total += slide
                if slide > worst[0]:
                    worst = (slide, f1)
                if item.get("max_slide_per_frame") is not None and slide > item["max_slide_per_frame"]:
                    bad.append(f1)
        results.append({"check": "skating", "label": item.get("label", item.get("bone")),
                        "max_slide_per_frame": worst[0], "frame": worst[1], "total_slide_near_floor": total,
                        "violations": bad[:50],
                        "passed": None if item.get("max_slide_per_frame") is None else not bad})
    fps = scene.render.fps / scene.render.fps_base
    for i, item in enumerate(spec.get("jerk", [])):
        pts = [p for _, p in jerk_paths[i]]
        worst = (0.0, None)
        for k in range(3, len(pts)):
            j = (pts[k] - 3 * pts[k - 1] + 3 * pts[k - 2] - pts[k - 3]).length * fps ** 3
            if j > worst[0]:
                worst = (j, jerk_paths[i][k][0])
        results.append({"check": "jerk", "label": item.get("label", item.get("bone")), "max_jerk": worst[0],
                        "frame": worst[1], "passed": verdict(worst[0], item.get("max"))})
    if framing:
        results.append({"check": "framing", "camera": camera.name, "min_margin": frame_worst[0],
                        "frame": frame_worst[1], "violations": frame_bad[:50], "behind_camera": behind_frames[:50],
                        "passed": not frame_bad and not behind_frames})

    failed = [r for r in results if r["passed"] is False]
    report = {"blend": report_path(args.blend, args.output), "blender": bpy.app.version_string,
              "frames": [first, last], "substeps": substeps, "results": results,
              "failed": len(failed), "unjudged": sum(r["passed"] is None for r in results),
              "note": "Numbers measure geometry only; they do not prove weight, rhythm or appeal."}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({"failed": len(failed), "checks": len(results), "output": str(args.output)}))
    if failed and args.fail_on_tolerance:
        sys.exit(3)


if __name__ == "__main__":
    main()
