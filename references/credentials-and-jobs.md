# Credentials, cost, and recoverable jobs

Applies to every provider. For OpenRouter, `scripts/openrouter.mjs` already enforces
these rules; for fal, Google, OpenAI, Higgsfield or ElevenLabs, follow them by hand
or mirror that client's structure.

## Credentials

- The credentials file is `<repo-root>/.env` regardless of the shot folder. The
  OpenRouter key may instead be in `<repo-root>/.env.local`: `openrouter.mjs` and
  `check-env.mjs` read `OPENROUTER_API_KEY` from the environment first, then a
  non-empty value in `.env.local`, then `.env`; other keys come only from `.env`.
  Keep `.env` and `.env.*` (except `.env.example`) out of version control. Never
  print or read either file into chat, create dummy keys, overwrite either from
  [the example](../assets/.env.example), or ask the user to paste a key. Merge
  missing names privately only if asked.
- Presence check (no network; key names and booleans only; exit 0 ready, 2 missing,
  1 invalid):
  `node <skill>/scripts/check-env.mjs --repo <repo-root> --providers openrouter,elevenlabs`.
  Providers: `openai`, `openrouter`, `google` (`GEMINI_API_KEY`, alias `GOOGLE_API_KEY`),
  `fal`, `elevenlabs`, `higgsfield` (separate ID+secret pair, else combined
  `HF_CREDENTIALS`/`HF_KEY`; see [Higgsfield](higgsfield.md)). Presence is not validity.
- Load keys only inside a dedicated generation process; keep them out of prompts,
  source, arguments, logs, manifests, media and any browser/Vite environment (no
  `VITE_`/`NEXT_PUBLIC_` prefixes). Blender and FFmpeg get only an allowlist of
  system variables (`run-blender.mjs` and `media-check.mjs` do this), so no key reaches
  them through the environment. A Blender script on the host can still read the
  credentials files; in the default container mode they are not mounted
  ([trust and isolation](blender-headless.md#trust-and-isolation)). Pin any provider SDK in an
  isolated helper environment instead of changing the project's dependencies.
- Missing credentials block only the dependent stage: finish planning and authorized
  local Blender work, then report the exact missing key name.

## Before a paid call

- Resolve the exact model and task schema from current provider docs; validate media
  magic bytes, dimensions, duration, size and reference counts locally.
- Record the user's ceiling (currency), allowed providers/uploads and attempt limit.
  Estimate from current pricing for the chosen resolution/duration and input type;
  unknown pricing is not zero; reserve in-flight estimates against the ceiling.
  Convert currencies with a recorded rate and fee allowance.
- A credential's existence is not authorization. Honor existing authorization
  without re-asking at every stage; ask once, with the estimate, when it is missing.

## Submission and interruption

- Write an attempt record with a stable local id, input hashes and roles, model,
  effective parameters (no secrets, signed URLs or media payloads), estimate and
  `submitting` state, created exclusively so two runners cannot claim it. Use provider
  idempotency only where documented.
- Persist the returned job id immediately. States: `submitting`, `running`,
  `succeeded`, `failed`, `unknown`. Poll with bounded backoff and a deadline.
- An ambiguous timeout is `unknown`: look the job up by id or in the provider's
  activity before anything else, and do not submit a billable duplicate while the
  outcome is unknown. Retry transient failures only within the attempt limit and
  ceiling; authentication, schema, safety and access errors need correction, not
  retries (see [failures](generation-failures.md)).
- Track provider outcome, media storage, media validation and artistic review
  separately. Persist bounded original bytes before any format conversion; a lost
  paid output still counts as a charged attempt. Download only from documented
  storage hosts and never forward API auth to other hosts.
- Resuming reconciles unfinished attempts and existing media first; it never
  regenerates completed shots. Revisions are new attempts; keep previous takes.
- If the next estimate exceeds the ceiling, finish independent local work and ask
  for the specific extra authorization.
