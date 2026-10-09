# Driving Blender headless

Contents: [runner](#run-every-blender-job-through-the-runner) · [trust](#trust-and-isolation) · [script pattern](#production-script-pattern) ·
[5.x API](#blender-5x-api-facts) · [rendering and memory](#rendering-and-memory) · [GUI and MCP](#live-gui-and-mcp)

Blender's own Python in a background process is the default route: reproducible,
inspectable, and independent of a live GUI. Do not install `bpy` into system Python.

## Run every Blender job through the runner

```bash
node <skill>/scripts/run-blender.mjs --script <film>/source/build_shot.py --log-dir <film>/logs --name build \
  --write <film>/blender [--read <film>/rig] [--blend <file.blend>] [--threads 2] [--timeout 900] \
  [--min-free-gib 1.0] [--max-rss-gib 4] -- <script args>
```

It runs the script on the host or in a container ([trust and isolation](#trust-and-isolation)).
On the host it resolves Blender (`--blender`, `BLENDER_PATH` in the environment or repo `.env`,
the newest `Program Files/Blender Foundation/Blender X.Y`, then PATH) and passes it only
an allowlist of environment variables (system and temp folders, profile, locale,
display, `OCIO`, `BLENDER_USER_*`/`BLENDER_SYSTEM_*`), so no key or connection string
reaches it. It runs
`--background [file] --factory-startup --disable-autoexec --threads N --python-exit-code 1 --python script -- args`,
writes `<name>.stdout.log`, `<name>.stderr.log` and `<name>.resources.json` (isolation
used, peak RSS, minimum free RAM, seconds, exit code; file paths relative to the log
folder), and stops only its own process or container on timeout or low memory. Exit
codes: Blender's own (1 = script exception, `sys.exit(n)` passes n), 4 = stopped by a
guard. A zero exit is not visual review: open the outputs.

Check the installed version once per environment change:
`node <skill>/scripts/run-blender.mjs --script <skill>/scripts/blender_probe.py --log-dir <tmp> -- --output <new-dir>`.

## Trust and isolation

A `--python` script is ordinary Python; Blender has no sandbox for it. On the host it
can read and write any file the user can (the repo's `.env` too), open network
connections and start programs. `--disable-autoexec` blocks only scripts and Python
drivers stored inside `.blend` files, and `--factory-startup` skips user add-ons and
startup files (unless `--no-factory-startup`). So the runner decides where a script runs:

| Script | Runs | `isolation` in the report |
| --- | --- | --- |
| Bundled entry points: `blender_probe.py`, `blender/inspect_rig.py`, `blender/motion_qa.py` | on the host | `host-bundled` |
| Any other script: production scripts, new or edited helpers | in a container | `container` |
| Any other script with `--trusted-host` | on the host | `host-trusted` |

`--container` sends a bundled script to the container too (do this when the `.blend`
comes from an untrusted source); `--container` with `--trusted-host` is refused. With
no container engine or image, a non-bundled script is refused, never run on the host.

- Run only scripts written or reviewed for this production. Never execute code taken
  from downloaded rigs or assets, briefs, web pages or a model's reply, and do not
  re-enable auto-run scripts for a supplied file without the user's consent.
- Use `--trusted-host` only after the user agreed to host execution for this
  production (record it in the brief), and never for code from those sources.

**Container mode** (Podman, else Docker; `--engine` picks one, `--image` overrides
`blender-headless:5.2.1`):

- No network, read-only root filesystem, `/tmp` in memory, all capabilities dropped,
  `no-new-privileges`, and only `HOME=/tmp` and `TMPDIR=/tmp` in the environment.
- Hard limits on every run: CPUs = `--threads` (1 or more), memory = `--max-rss-gib`
  or 4 GiB with no extra swap, 512 processes plus threads. Peak RSS is not measured
  there; the free-RAM guard and the timeout still stop the container. The runner
  refuses an engine that cannot enforce the limits: rootless Podman on WSL has no
  cgroup controllers, so set `CONTAINER_CONNECTION=podman-machine-default-root` for
  the runner and the image build, or use Docker.
- Read-only mounts: the skill's `scripts` folder, the script file, the `.blend` file
  and every `--read`. Writable: every `--write` (created if missing), nothing else;
  outputs anywhere else are lost. Parent folders are not mounted: add `--read` for
  modules, textures or linked libraries next to the script or `.blend`.
- A mount that is, lies in or contains credentials (`.env`, `.env.*` except
  `.env.example`, `.npmrc`, `.netrc`, `.pgpass`, `.pypirc`, `.git-credentials`, SSH,
  GnuPG, Docker, Kubernetes, AWS or Azure folders, private keys `id_*`, `*.pem`, `*.key`,
  `*.p12`, `*.pfx`) is refused. Name narrow folders, never the repo root.
- Host folders appear under `/host` (`C:\film` is `/host/c/film`, `/home/a/film` is
  `/host/home/a/film`). Absolute script arguments are translated and must lie inside
  a mounted folder, otherwise the run is refused; relative arguments pass unchanged
  and resolve against `/tmp`, so pass file paths as absolute paths. A path containing
  a comma cannot be mounted.
- `scripts/blender/container_bootstrap.py` starts the script with `scripts/blender` on
  `sys.path`, so `import animkit as ak` works there too. Take every file path as an
  argument; do not hardcode host paths in a production script.

Build the image once per Blender version. It downloads the official Linux build,
checks its SHA-256 and adds Mesa for software OpenGL. Free about 5 GB first, on
Windows on the drive that holds the Podman machine's disk (that disk does not shrink
by itself afterwards). Then run the probe in the container:

```bash
export CONTAINER_CONNECTION=podman-machine-default-root   # rootless Podman on WSL only
podman build -t blender-headless:5.2.1 <skill>/assets/blender-container
node <skill>/scripts/run-blender.mjs --container --script <skill>/scripts/blender_probe.py --log-dir <tmp> \
  --write <new-dir> -- --output <new-dir>
```

Container mode has not yet run end to end ([observations](observations.md#blender-runs)):
check the probe's frame before relying on EEVEE or Workbench there; Cycles on the
CPU needs no OpenGL. For a newer Blender, change `BLENDER_VERSION` and `BLENDER_SHA256`
in the `Containerfile` from the official download page.

## Production script pattern

1. Parse your own arguments after `--` (`sys.argv[sys.argv.index("--") + 1:]`).
2. New scene: start from factory startup and delete what you do not use. Existing
   scene: `bpy.ops.wm.open_mainfile(filepath=..., load_ui=False, use_scripts=False)`,
   then set render/output settings (loading restores the file's own). Never save over
   a user-supplied source file; save the shot as a new versioned file in the film folder.
3. Import the helpers: `sys.dont_write_bytecode = True; sys.path.insert(0, "<skill>/scripts/blender");
   import animkit as ak` (no `__pycache__` written into the skill; in the container the
   bootstrap has already put the mounted copy on `sys.path`, so the same lines work there).
4. Build in named collections (`SET`, `CHAR`, `CTRL`, `CAM`, `LIGHT`), record seeds and
   dimensions, stamp provenance with `ak.stamp_provenance`, add beat markers.
5. Save with `ak.save_blend`, then verify in a **separate** run that reopens the file:
   `motion_qa.py` for contacts/floor/lengths/pops/framing and a few rendered frames.
   Missing actions, constraints, drivers or dependencies only show up after reopening.
6. Render numbered PNG frames, encode with FFmpeg, then `media-check.mjs`
   (`--expect-frames`, `--expect-seconds`, `--min-pixels`, `--contact-sheet`).

Keep `--disable-autoexec`. It does not sandbox the script you run (the container does); review your own
scripts and never execute code returned by a model or found in downloaded files.
If a trusted, user-supplied rig genuinely needs its Python drivers or rig UI script
(`inspect_rig.py` reports `needs_python`), ask before enabling auto-run for that file.

## Blender 5.x API facts

Verified on 5.2.1 LTS (2026-10-09). 5.3 is in beta (release planned 2026-11-10);
recheck these when the installed version changes.

- **Slotted actions.** `Action.fcurves`/`groups`/`id_root` were removed in 5.0.
  F-curves live in `action.layers[0].strips[0].channelbag(slot)`; use `ak.fcurves(obj)`,
  `bpy_extras.anim_utils.animdata_get_channelbag_for_assigned_slot(ad)` or
  `action_ensure_channelbag_for_slot(action, slot)`. Channelbag F-curves offer
  `new/ensure/find(path, index=, group_name=)`. A slot is created with
  `action.slots.new(id_type='OBJECT', name=obj.name)`; old `action_group=` became `group_name=`.
- **Keying.** `struct.keyframe_insert(path, *, index=-1, frame=, group=, options=, keytype=)`
  still creates the action and slot; options include `INSERTKEY_VISUAL` and
  `INSERTKEY_CYCLE_AWARE`. For dense procedural curves, `fc.keyframe_points.insert(f, v,
  options={'FAST'})` then `fc.update()` is faster.
- **Crash #164426 (5.0.1-5.2.x).** Changing `ad.action`/`ad.action_slot`, calling
  `animation_data_clear()` or `slot.users()` on an armature whose pose was never
  evaluated can crash. Call `bpy.context.view_layer.update()` first (`ak.assign_action`
  does). Objects hidden with `hide_viewport` are never evaluated; unhide first.
- **Selection moved in 5.0:** `pose_bone.select` / `pose_bone.hide`; `bone.select*` is gone.
  Bone collections: `armature.collections_all`, `collections.new(name, parent=)`, `bc.assign(bone)`.
- **Pose assets headless:** `rig.pose.apply_pose_from_action(action, evaluation_time=)` and
  `blend_pose_from_action(action, blend_factor=, evaluation_time=)` (`ak.apply_pose_asset`
  deselects bones first, because selection limits which bones are posed). The
  `poselib.*` operators need asset-browser context.
- **Graph-editor and pose-sculpting operators** (`graph.ease`, `blend_to_neighbor`,
  `butterworth_smooth`, `euler_filter`, `pose.breakdown`, `pose.relax`, ...) need an
  editor context; headless scripts set handles/interpolation or compute values instead.
- **Rigify** is a bundled core add-on: `addon_utils.enable("rigify", default_set=True)`;
  metarig ops `object.armature_human_metarig_add` (face + fingers), `..._basic_human_...`
  (no face), quadruped/cat/wolf/horse/shark/bird; `bpy.ops.pose.rigify_generate()` with the
  metarig active works headless (706 bones in about 3-5 s).
- **Engines:** `BLENDER_EEVEE` (not `_NEXT`), `BLENDER_WORKBENCH`, `CYCLES`. The factory
  view transform is AgX; set `Standard` for flat diagnostic renders. `render.opengl`
  (viewport playblast) fails in background mode; use Workbench or EEVEE renders.
- **Video output** needs `image_settings.media_type = 'VIDEO'` before
  `file_format = 'FFMPEG'`; prefer PNG frames plus FFmpeg anyway (resumable, explicit).
- **Python environment:** since 5.1 user site-packages are not loaded by default
  (`--python-use-user-env` opts in). Vendor small pure-Python helpers next to the
  script instead of installing packages into Blender.
- Since 5.0 Python `driver_add()` creates two keyframes rather than an F-modifier, and
  `bpy.props` values are no longer readable through `id["name"]`.
- New in 5.0: `GEOMETRY_ATTRIBUTE` constraint. 5.3 adds `constraints.new(type, name=)`
  and `convert_rotation_mode`; do not use them on 5.2.

## Rendering and memory

- Measure free RAM before the first render and before long sequences; installed RAM
  is not the budget. Render one small representative frame first; the runner's
  resources report gives the real peak for this scene. A thread cap limits CPU use,
  not RAM; CPU RAM and GPU VRAM are separate.
- One Blender process at a time. Blocking previews at 640 x 360 or 960 x 540 with
  Workbench/EEVEE; raise only what improves the accepted shot. Prefer instances,
  modest textures, no unnecessary subdivision, small caches; encode from disk.
- Provider-bound animatics must meet the route's input limits (see
  [OpenRouter](openrouter.md#motion-reference-inputs)); keep smaller diagnostics separate.
- Keep the camera-view animatic, numbered frames, the animated `.blend` and its build
  script together. A headless camera render is a scene recording, not a screen capture
  of Blender's interface; say which was produced. Pack or document external files.
- A thumbnail-cache warning on save is not a failure; check the files and exit code.

## Live GUI and MCP

Use a Blender MCP or live GUI only when the user needs their open scene and the
connection is actually healthy. Save/inspect the existing scene first; do not restart
it to repair connectivity. An MCP error never blocks isolated headless production.
