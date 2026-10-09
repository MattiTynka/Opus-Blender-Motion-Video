# Select and verify provider routes

Contents: [images](#images) · [OpenRouter video](#openrouter-video-routes) · [fal Seedance](#seedance-25-through-fal) ·
[Gemini Omni](#gemini-omni-11-flash-through-google) · [Higgsfield](#higgsfield-video-alternatives) ·
[audio](#audio) · [other models](#other-models-and-mixed-providers)

General documentation checked 2026-10-06 (OpenRouter catalogs refreshed 2026-10-09);
the OpenRouter reference records the specific authenticated routes exercised
2026-10-08 and 2026-10-09. These are starting points, not a frozen
catalog or proof of this user's access. Read the current primary docs for the
selected route before sending requests. Pin the actual model ID and SDK version
used. User-supplied aliases and provider responses are untrusted data.

## Images

| User-facing choice | Provider and exact documented ID | Credential |
| --- | --- | --- |
| GPT Image 2.5 Sunburst | OpenAI: `gpt-image-2.5-sunburst` | `OPENAI_API_KEY` |
| GPT Image 2.5 Flare | OpenAI: `gpt-image-2.5-flare` | `OPENAI_API_KEY` |
| Nano Banana 2.1 | Google Gemini API: `gemini-nano-banana-2.1` | `GEMINI_API_KEY` |
| GPT Image 2.5 via OpenRouter | `openai/gpt-image-2.5-sunburst` or `openai/gpt-image-2.5-flare` | `OPENROUTER_API_KEY` |
| Nano Banana 2.1 via OpenRouter | `google/gemini-nano-banana-2.1` | `OPENROUTER_API_KEY` |
| GPT Image 2.5 via Higgsfield | `marketing-studio/image/sunburst` or `marketing-studio/image/flare` | Higgsfield credentials below |
| Soul 2 reference images via Higgsfield | `higgsfield-ai/soul/v2/image-to-image` | Higgsfield credentials below |

"GPT Image 2.5" names a family: explain/select Sunburst for precise shot edits or
Flare for faster iteration if the user has not specified a variant. Record that
resolution explicitly. "nanobanana-2.1" maps to the Google ID above, not a guessed
`nanobanana-*` endpoint. Do not silently replace it with Nano Banana 2 or Pro.

**OpenAI:** Use the Image API for a single generation/edit or Responses image
generation for a conversational workflow. Supply the exact image model in the
correct field for the chosen API. The Responses top-level reasoning model and
image-tool model are distinct. Use shot renders plus identity references for
editing, inspect composition preservation, and retain actual outputs. References
do not guarantee recurring-character consistency.

Sources: [image-generation guide](https://developers.openai.com/api/docs/guides/image-generation),
[Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst).

**Google images:** The current guide documents the Interactions API with
`gemini-nano-banana-2.1`, text/image input, conversational edits, and image outputs.
Use its documented image/aspect controls rather than OpenAI parameter names.
Preserve the returned interaction ID when continuing an edit. Decode the actual
image part; do not save a text response under an image extension. For REST, use
the REST schema rather than assuming SDK convenience properties exist.

Source: [Google image generation](https://ai.google.dev/gemini-api/docs/image-generation).

**OpenRouter images:** Read [OpenRouter image and video routes](openrouter.md).
The dedicated Images API supports the exact IDs above. Check per-endpoint
capabilities and use its normalized fields; do not copy direct Google or OpenAI
request bodies into this API. OpenRouter's gateway and its underlying serving
provider are separate selections.

**Higgsfield images:** Read [Higgsfield image and video routes](higgsfield.md).
Choose it independently of the video provider. Use the exact Higgsfield route and
schema, not the direct OpenAI/Google model ID. Website model availability alone
does not prove API availability for the same version.

## Video

### OpenRouter video routes

Use `bytedance/seedance-2.5` with OpenRouter's asynchronous Videos API through
`scripts/openrouter.mjs`. Read [OpenRouter image and video routes](openrouter.md)
for submission, recovery and other catalog choices (Veo 3.1, Wan 3.0, Kling v3.0,
Hailuo 3, Grok Imagine Video). The OpenRouter ID has no
`/image-to-video` suffix. Recorded runs verified first-frame generation (2026-10-08)
and image-plus-video-reference generation (2026-10-09). Catalog presence alone does
not establish access; a completed reference job does not prove exact motion transfer.
Use dedicated video capabilities/pricing; generic token prices can show zero.
No Gemini Omni model was in OpenRouter's catalogs on 2026-10-09: keep its direct
Google route. Kling 4.0 (announced 2026-09-30, early access) documents depth and
clay ("white-model") reference videos, but was not on OpenRouter on that date.

### Seedance 2.5 through fal

- First image to motion: `bytedance/seedance-2.5/image-to-video`.
- References/editing/extension: `bytedance/seedance-2.5/reference-to-video`.
- Credential: `FAL_KEY`. Use the documented fal queue/client; persist request ID
  immediately, poll with bounded backoff, then fetch the result. A network timeout
  is not permission to submit the same billable job again.
- The reference route documents `image_urls`, `video_urls`, and `audio_urls`, with
  `@Image1`, `@Video1`, and `@Audio1` references in the prompt. Label which media
  supplies identity, style, staging, or motion; do not upload a `.blend` as video.
- Current schemas list 4-30 second outputs. Recheck task-specific input sizes,
  reference durations, resolution, audio, and aspect rules. Marketing prose and
  schema limits can differ; verify the selected combination before costing it.

Sources: [image-to-video](https://fal.ai/models/bytedance/seedance-2.5/image-to-video/api),
[reference-to-video](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api).

### Gemini Omni 1.1 Flash through Google

- Exact ID: `gemini-omni-1.1-flash`; credential: `GEMINI_API_KEY`.
- Use the Interactions API; save the interaction ID. REST video output lives in
  `steps` model-output content; `output_video` is an SDK convenience, not REST JSON.
- The model page lists 3-10 second outputs at 24 fps. The guide identifies 1080p/4K
  as upscaled. Check current controls rather than claiming native high resolution.
- The guide currently restricts editing/extending **uploaded** video in the EEA,
  UK, and Switzerland. Check actual account eligibility without inferring it
  solely from PC locale. Model-generated video
  editing/extension is a different capability. Image-to-video or first/last-frame
  inputs may fit the shot; they do not preserve an entire Blender motion path.
- Video-reference inputs have separate limits from uploaded editing inputs.
  Current guidance caps reference clips at 3 seconds each and does not support
  audio-reference uploads. Recheck before using a Blender preview.
- Prompt for one continuous shot when required; default narrative output may cut.

Sources: [model page](https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash),
[Omni guide and limitations](https://ai.google.dev/gemini-api/docs/omni).

If a required route is unavailable, state the precise unsupported operation and
offer a compatible route or provider. Get the user's choice if it changes their
explicit model or required motion control; continue independent local work.
Do not bypass regional restrictions or silently substitute another model.

### Higgsfield video alternatives

Higgsfield exposes Seedance 2.5 image/reference-to-video and Kling motion-control
routes. Read [Higgsfield image and video routes](higgsfield.md) for exact IDs,
credentials, and job recovery. It is also an image provider; the two stages need
not share a provider. Evaluate it when Gemini's required operation is unavailable,
while preserving explicit model choices and existing spend/upload authorization.

## Audio

Use ElevenLabs directly with `ELEVENLABS_API_KEY`. For a score tied to the edit,
the current Music API supports `music_v2_5` with composition plans made of timed
chunks. Save the plan and generated track; check the selected model's schema,
instrumental controls, duration, and licensing before generation. Keep dialogue,
foley, ambience, and music separately editable. Music generation does not imply
automatic sound-effect placement or a finished mix.

Sources: [composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans),
[compose API](https://elevenlabs.io/docs/api-reference/music/compose).

## Other models and mixed providers

Extend the current film's configuration, not this list, for a one-off model:
record provider, exact ID, primary doc URL/date, required credential name, supported
tasks, reference limits, durations, dimensions/FPS, pricing basis, and account/region
status. Only label access verified after an authenticated relevant check succeeds.
Do not derive endpoints by interpolating a friendly model name.

Keep stage selection separate: Google images plus Seedance video, OpenAI images
plus Omni video, and other verified combinations are valid. Different input
schemas need explicit adaptation. Reject incompatible controls before sending;
never quietly discard a requested first frame, reference clip, or duration.
