"""Render Blender's factory scene in a new directory; no network or credentials."""

import argparse
import json
from pathlib import Path
import sys

import bpy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)

    scene = bpy.context.scene
    if scene.camera is None:
        raise RuntimeError("Run with --factory-startup; no active camera found")
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 320
    scene.render.resolution_y = 180
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output / "probe.png")
    scene.render.fps = 24
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / "probe.blend"))
    bpy.ops.render.render(write_still=True)
    if not (output / "probe.png").is_file():
        raise RuntimeError("Blender did not produce the requested PNG")

    report = {
        "blender_version": bpy.app.version_string,
        "background": bpy.app.background,
        "engine": scene.render.engine,
        "resolution": [320, 180],
        "image": "probe.png",
        "scene": "probe.blend",
        "status": "RENDERED_NOT_REVIEWED",
        "limits": "Single-frame EEVEE probe; no Cycles, GPU benchmark, animation, or provider test",
    }
    (output / "probe.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
