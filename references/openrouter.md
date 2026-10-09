# OpenRouter for images and video

Contents: [client](#use-the-bundled-client) · [models](#model-choices) ·
[images](#image-requests) · [video](#video-requests) · [motion references](#motion-reference-inputs) ·
[jobs](#jobs-recovery-and-cost) · [API facts](#api-facts)

One `OPENROUTER_API_KEY` covers both stages through the dedicated Images API
(`POST /images`) and the asynchronous Videos API (`POST /videos`). Do not use chat
completions for either. Direct OpenAI/Google/fal keys are separate and unnecessary
for stages routed only through OpenRouter. ElevenLabs keeps its own key.

## Use the bundled client

`scripts/openrouter.mjs` implements the request discipline below. Run it; do not
hand-write a new submitter for each production. Paths are relative to the skill
directory; pass `--repo <repo-root>` so it finds the key in the repo `.env.local` or
`.env` ([credentials](credentials-and-jobs.md#credentials)).

```bash
node <skill>/scripts/openrouter.mjs catalog --kind video --model bytedance/seedance-2.5 --out <film>/provider/caps-video.json
node <skill>/scripts/openrouter.mjs catalog --kind image --model openai/gpt-image-2.5-flare --out <film>/provider/caps-image.json
node <skill>/scripts/openrouter.mjs submit --request <film>/requests/s01-video.json --dir <film>/provider \
  --attempt s01-video-01 --estimate-usd 1.30 --ceiling-usd 3 --max-attempts 2 --repo <repo-root>       # dry run
node <skill>/scripts/openrouter.mjs submit ... --submit                                                   # paid call
node <skill>/scripts/openrouter.mjs resume --dir <film>/provider --attempt s01-video-01 --repo <repo-root>
node <skill>/scripts/openrouter.mjs ledger --dir <film>/provider
```

- `catalog` sends no key (public endpoints) and saves a dated capability snapshot.
- `submit` without `--submit` resolves media, checks the ceiling, attempt limit and
  live capabilities, prints the sanitized body and sends nothing. Show this to the
  user when authorization is still open.
- With `--submit` it claims `attempt-<id>.json` exclusively (an existing id can never
  submit again), sends one POST, records the job id at once, polls with backoff and
  downloads to `<dir>/<id>/original.bin` (+ `.mp4` when the header is MP4).
- Exit codes: 0 done, 1 refused/invalid, 2 failed/unknown/unpersisted output,
  5 video still running (run `resume`; never resubmit).
- HTTP rejections are recorded as `failed` with `actualUSD: 0` (OpenRouter documents
  failed generations as unbilled; confirm in account activity). Network-ambiguous
  POSTs become `unknown`; the estimate stays reserved in the ledger and no automatic
  retry happens.
- `--ledger-dir` adds earlier productions' provider folders to the budget.

Request file (`kind` is `image` or `video`; `body` is the OpenRouter body):

```json
{
  "kind": "video",
  "shot": "s01",
  "notes": "image = identity/environment; video = full choreography and camera",
  "body": {
    "model": "bytedance/seedance-2.5",
    "prompt": "One continuous five-second shot. IMAGE reference controls ... VIDEO reference controls ...",
    "duration": 5, "resolution": "720p", "aspect_ratio": "16:9", "generate_audio": true,
    "input_references": [
      {"type": "image_url", "image_url": {"url": "local:../artwork/design.jpg"}, "role": "identity and environment"},
      {"type": "video_url", "video_url": {"url": "https://<approved-host>/reference.mp4"},
       "role": "full motion", "verify_local": "../blender/motion-reference.mp4"}
    ]
  }
}
```

`local:` paths (relative to the request file) become validated data URLs for PNG,
JPEG and WebP images. Video and audio need an approved public HTTPS URL; with
`verify_local` the client downloads it and compares SHA-256 with the local file
before any paid call. `role`, `verify_local` and `probe_file` are stripped before
sending and kept in the attempt record. If Node cannot resolve a fresh tunnel
hostname (observed on Windows), download the URL with `Invoke-WebRequest -OutFile`
and pass that file as `"probe_file"` (must be under 10 minutes old).

## Model choices

Snapshot from the public catalogs on 2026-10-09. Refresh with `catalog` before
quoting capabilities or prices; catalog presence is not proof of account access.

| Image choice | Exact ID | Notes from the endpoint record |
| --- | --- | --- |
| Nano Banana 2.1 | `google/gemini-nano-banana-2.1` | `resolution` 1K/2K/4K, n=1, ≤14 references, backend `google-ai-studio` only |
| GPT Image 2.5 Sunburst / Flare | `openai/gpt-image-2.5-sunburst` / `-flare` | `quality` auto/low/medium/high/xhigh/max, n 1-10, ≤16 references; no `resolution` or `size` |
| FLUX 3 | `black-forest-labs/flux-3-image` | 768-4K tiers, ≤10 references (added 2026-10-01) |
| Seedream 5.0 Flash | `bytedance-seed/seedream-5-0-flash` | 1K/2K, ≤14 references, `seed` (added 2026-10-01) |

| Video choice | Exact ID | Consider for |
| --- | --- | --- |
| Seedance 2.5 | `bytedance/seedance-2.5` | Finished frame + Blender motion reference; 4-30 s; 480p/720p; first/last frame |
| Veo 3.1 / Fast / Lite | `google/veo-3.1`, `-fast`, `-lite` | Text/image to video; negative prompt via passthrough `negativePrompt` |
| Kling v3.0 Pro / Std | `kwaivgi/kling-v3.0-pro`, `-std` | First/last-frame workflows; passthrough `negative_prompt`, `cfg_scale` |
| Wan 3.0 / Prime | `alibaba/wan-3.0`, `alibaba/wan-3.0-prime` | Text/image/reference-guided shots |
| MiniMax Hailuo 3 Max | `minimax/hailuo-3-max` | Text/image to video |
| FLUX video edit | `black-forest-labs/flux-video-edit` | Video edit, priced per output second (added 2026-09-10; source-video field undocumented) |
| Grok Imagine Video 1.5 Lite | `x-ai/grok-imagine-video-1.5-lite` | Cheap first-frame drafts, 1-15 s (added 2026-10-06) |

`openai/sora-2-pro` was removed on 2026-09-24. No Gemini Omni model exists on
OpenRouter; keep its direct Google route ([providers](providers.md)). These are
options, not rankings; never synthesize an ID from a friendly name. Runway Aleph 2
(`runway/aleph-2`) gave bad results in testing (2026-10-09); do not propose it.

## Image requests

Check the selected model's `/images/models/{id}/endpoints`: capabilities are per
backend (`provider_tag`), and the model-level list is a union. Pin a backend with
`"provider": {"only": ["openai"], "allow_fallbacks": false}` when a field is backend
specific. Typical shot-finishing body:

```json
{"model": "google/gemini-nano-banana-2.1", "resolution": "2K", "aspect_ratio": "16:9", "n": 1,
 "prompt": "Finish the shot. Reference 1 fixes framing, pose and light direction; reference 2 fixes the character's identity. Preserve silhouette and scale.",
 "input_references": [{"type": "image_url", "image_url": {"url": "local:../blender/frames/0001.png"}, "role": "composition"},
                      {"type": "image_url", "image_url": {"url": "local:../design/hero.png"}, "role": "identity"}]}
```

For GPT Image 2.5 drop `resolution` and use `quality`. Other fields: `seed`, `size`,
`output_format` (png/jpeg/webp), `background`, `output_compression`. The response's
`data[].b64_json` is persisted by magic bytes through `persist-image.mjs`: providers
may return JPEG when PNG was implied (observed: Nano Banana 1K 16:9 returned a
1376 x 768 JPEG). Inspect the saved image before passing it downstream.

## Video requests

Check `GET /videos/models` for `supported_durations`, `supported_resolutions`,
`supported_aspect_ratios`, `supported_sizes`, `supported_frame_images`,
`generate_audio`, `seed`, `pricing_skus` and `allowed_passthrough_parameters`. Zero
token prices in the generic model list do not mean free video.

- First/last-frame mode: `frame_images: [{type: "image_url", image_url: {url}, frame_type: "first_frame" | "last_frame"}]`.
  Endpoints constrain endpoints only, not the path between them.
- Reference mode: `input_references` with `image_url`, `video_url` and (Seedance 2+)
  `audio_url` items. Do not combine with `frame_images`: frame inputs take precedence
  and the references would be ignored (the client refuses the mix).
- Provider-specific extras go in `provider.options.<backend>` and only for keys in
  `allowed_passthrough_parameters`; the video `provider` object documents only `options`.
- `previous_job_id` (format `gen-vid-<digits>-<20 alphanumerics>`) extends or edits a
  completed job on models that support continuation; verify support before relying on it.
- Set `generate_audio` deliberately; keep generated effects/dialogue separate from the
  local score where possible.

## Motion reference inputs

The image supplies identity, materials and environment; the complete Blender animatic
supplies choreography, timing and camera. Say so explicitly in the prompt, describe
the movement concretely, and tell the model to ignore the proxy look of the animatic.

Before uploading, run `media-check.mjs` on the animatic. Seedance 2.5 rejected a
768 x 432 clip with `InvalidParameter` (minimum 407696 pixels); the 960 x 540
recording passed. OpenRouter does not document reference-video limits; prefer one of
the model's `supported_sizes` at the output aspect (e.g. 1280 x 720) and keep the clip
inside the output duration. A local file, `.blend` or contact sheet is not an
uploaded reference; check the attempt record's `inputs`. Seedance refuses reference
images that show a photoreal face, generated faces included: see
[face-image refusals](generation-failures.md#face-image-refusals).

Temporary hosting needs the user's approval for that file. Serve only that file
(GET/HEAD and byte ranges), keep the server and tunnel alive until the job finishes,
verify the public hash, then stop only the processes you started. Never disable TLS.

The client's hash check (`verify_local`) downloads only from public addresses:
loopback, private, link-local, shared, documentation, multicast and reserved IPv4 and
IPv6 ranges are refused at connection time, so a host name cannot switch to an
internal address after the check, and redirects are not followed. Attempt records
and printed summaries keep links without their query string, fragment or user info,
where signed links carry their access token; the provider still receives the full
link. Saved provider errors are redacted the same way.

## Jobs, recovery and cost

Before paid work, record the ceiling, attempt limit, allowed uploads and models. The
client's ledger sums `actualUSD`, else `reservedUSD`, else `estimatedUSD` across
attempt records; unknown pricing is not zero. Estimate from `pricing_skus` or the
image endpoint's `pricing[]` for the selected resolution/duration and input type
(Seedance prices video-input requests on `video_tokens_with_video_input`).

Interrupted or timed-out runs: `resume` the existing attempt. It polls `GET /videos/{id}`
(`pending`, `in_progress`, `completed`, `failed`, `cancelled`, `expired`), then fetches
`/videos/{id}/content?index=0` with auth sent only to openrouter.ai (409 means not ready;
cross-host redirects need `--allow-download-host`). There is no cancel or job-list
endpoint. `/credits` now requires a management key; the client treats it as optional.
Video generation is incompatible with enforced ZDR; report that conflict rather than
changing the user's policy.

## API facts

Verified 2026-10-09 against https://openrouter.ai/openapi.json, the
[image guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation),
the [video guide](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
and the live catalogs. The 202 video response `id` may equal `generation_id`; store
both. Webhooks (`callback_url`, HMAC-signed) exist but local polling needs no public
server. Real production observations (costs, output sizes) are in
[observations](observations.md#openrouter-runs).
