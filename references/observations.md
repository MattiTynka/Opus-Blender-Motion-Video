# Field notes

Dated facts from real productions with this skill (Windows 11, Blender 5.2.1 LTS,
Node 24, FFmpeg 6.1, OpenRouter; October 2026). They are leads for planning, not
guarantees: recheck when the environment, account or catalog changes. Append new
entries; do not rewrite history.

Contents: [environment](#environment) · [Blender runs](#blender-runs) · [OpenRouter runs](#openrouter-runs)

## Environment

- Blender was not on PATH; the runner found it under `Program Files/Blender Foundation/`.
  When several versions are installed, confirm the one picked with `blender_probe.py`.
- FFmpeg/FFprobe installed with WinGet are linked in `%LOCALAPPDATA%/Microsoft/WinGet/Links/`;
  child processes did not always find them on PATH (`media-check.mjs` looks there).
- `tasklist` prints memory with a locale digit separator in the OEM code page; parse
  digits only (the runner does).
- A Blender MCP add-on did not connect on 2026-10-06; headless work did not need it.
  GPU rendering was not validated.

## Blender runs

- 2026-10-08 procedural robot: EEVEE 640 x 360 and 1280 x 720 recordings and Cycles
  960 x 540 stills with 3 threads, one process; peak working set about 0.69 GiB.
- 2026-10-09 triple backflip on Blender Studio's Snow character (CloudRig):
  Workbench 1280 x 960, 2 threads, peak 0.58 GiB. Physics-based kinematics
  (14-segment mass model, g = 9.81) verified by reopening the saved file; facial
  expressions came from the rig's own pose-asset actions.
- 2026-10-09 skill checks: Rigify human metarig generated headless (706 bones incl.
  face) in under 3 s; `ARMATURE_AUTO` weights left 0 unweighted vertices on a test
  mesh; `inspect_rig.py` mapped the Snow CloudRig (1494 bones, 690 controls,
  26 pose assets, 1114 drivers, none needing Python) in 2.5 s.
- Start/end-only framing checks missed standing headroom loss once; checking the
  tallest/widest pose fixed it before any paid call.
- 2026-10-09 runner hardening: host runs with the environment allowlist passed
  (`blender_probe.py` EEVEE frame in 8.6 s; `inspect_rig.py`; `motion_qa.py` 0 of 10
  checks failed in 47 s on the backflip `.blend`), and reports named files relatively.
  Container mode is unit-tested only. Building `blender-headless:5.2.1` with Podman 5.8
  (WSL machine) filled drive C: (about 3-4 GB used), stopped with "server probably
  quit" and left the WSL distro failing with I/O errors until `wsl --shutdown`; the
  Podman machine disk does not shrink afterwards. Still unverified: Windows-path bind
  mounts, EEVEE/Workbench on Mesa in the container, writes by uid 1000 to mounted folders.
- 2026-10-09: rootless Podman 5.8 on WSL listed no cgroup controllers (`[]`, cgroup v2,
  cgroupfs), so container limits could not be enforced; the machine's rootful
  connection `podman-machine-default-root` listed `cpu`, `memory` and `pids`. The
  runner refused a stopped engine, the rootless one, then the missing image, as
  designed. The machine's 15.5 GB disk held a 3.8 GB systemd journal (one chatty
  database container; journald caps at 4 GB on its 1 TB virtual filesystem): cap it
  (`SystemMaxUse=200M`). The disk file shrinks only when compacted (`diskpart`, as
  administrator, with WSL shut down).

## OpenRouter runs

- 2026-10-08: Nano Banana 2.1 (Google AI Studio backend) returned a 1376 x 768 JPEG
  for a 1K 16:9 request; a PNG-only saver lost the first paid output.
  Seedance 2.5 first-frame, 5 s 720p with audio, returned 1284 x 716, 121 frames at
  24 fps, 5.056 s container. Two images and one video cost about USD 1.24.
- 2026-10-09: Seedance 2.5 image + full video reference (`input_references`, no
  `frame_images`) completed: native 1280 x 720, 121 frames at 24 fps; delivery was
  trimmed to exactly 120 frames / 5.000 s. A 768 x 432 reference was rejected
  (`InvalidParameter`, minimum 407696 pixels); 960 x 540, 150 frames at 30 fps passed.
- 2026-10-09: one reference job failed with a copyright-related restriction; a
  substantially redesigned, user-approved original robot then succeeded.
  Nano Banana redesigns hit quota (HTTP 429); GPT Image 2.5 Flare via the `openai`
  backend (`quality: medium`) succeeded. Sampled frames showed the dance; continuous
  playback and audio were not reviewed, so exact choreography transfer remains unproven.
- Node `fetch` returned `ENOTFOUND` for a fresh trycloudflare hostname while
  `Invoke-WebRequest` could fetch it; hashing a PowerShell-downloaded probe file
  worked around it.
- 2026-10-09 steampunk backflip: Seedance 2.5 reference mode with GPT Image 2.5 Flare
  anime stills (faces visible) and an untinted stand-in render was accepted for
  USD 1.3969; the stand-in's dark skin and black hair leaked into her mid-air, and
  she did four rotations, not three.
- 2026-10-09, photoreal redo of that shot: the request with face-visible stills was
  refused at submission (HTTP 400 `InputImageSensitiveContentDetected.PrivacyInformation`,
  USD 0, flagged `content[1-4,7,8]`); the two face-down stills passed. The faceless
  request (two costume crops, an arena plate, the two face-down stills and a
  720 x 1280, 30 fps reference with a retinted stand-in) cost USD 1.38816: 720 x 1280,
  121 frames at 24 fps, 5.042 s, AAC 32 kHz stereo. Three rotations and the landing
  matched the reference; the rise was about 0.5 s late, the rebound hop and camera
  tilt were missing, the crowd reacted weakly, and the audio was near silent from
  2.4 to 4.2 s. About 5 L* darker than the stills; accepted after one fixed grade
  toward the master still.
- 2026-10-09: Claude Code's permission check blocked the agent from opening the
  public tunnel for the motion reference, so the user ran the submission script.
  Give the user the command with an absolute script path: a relative
  `pwsh -File` path failed from another working folder.
