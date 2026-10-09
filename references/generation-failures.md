# Generation failures and refusals

Use for any image or video model. Separate a technical rejection, exhausted quota,
and a content-policy refusal: they require different corrections. A generic local
exception such as "job not completed" is not the provider's diagnosis.

## Capture the useful error

Before throwing on a non-2xx response, save bounded, redacted provider diagnostics:
HTTP status, error code/message, upstream message, request/job ID and `Retry-After`
when present. For asynchronous jobs, save the terminal response's `error` as well
as its status. Remove credentials, embedded media and signed URLs. Read the saved
diagnostic before another submission. If it is missing, retrieve the existing job
or request record; do not spend another generation merely to rediscover its error.

| Evidence | Technical response |
| --- | --- |
| Invalid parameter, unsupported format, dimensions or duration | Correct that field or media derivative using the selected route's constraints. Reuse existing renders when possible; validate the corrected bytes before submitting. |
| Media URL unreachable or mismatched | Fix transport and verify a public download matches the local asset hash. Do this before a paid request; a local file or responding home page is insufficient. |
| HTTP 429 with a temporary rate limit | Honor `Retry-After` and use bounded backoff within the existing attempt limit. |
| HTTP 429 explicitly reporting quota/billing exhaustion | Repeated short waits do not repair exhausted quota. Use a compatible fallback already within the production's model choices, or report the precise account issue. |
| Authentication, account-access or regional restriction | Diagnose credentials and eligibility; changing artwork does not fix it. Do not route around access restrictions. |
| Network timeout or transient server failure | Reconcile acceptance and poll the existing job first. An ambiguous POST must not trigger a duplicate billable submission. |
| Explicit copyright-related or other content-policy refusal | Follow the content revision procedure below; changing codecs or retrying identical inputs does not address the refusal. |
| Input image flagged as a possible real person (`InputImageSensitiveContentDetected.PrivacyInformation`) | Remove the images that show a face and carry the face in text: [face-image refusals](#face-image-refusals). Retrying the same images does not address it. |

For technical model fallback, refresh its schema and reconstruct the request.
Changing only the model ID can leave unsupported resolution, quality or reference
fields. Preserve the required reference roles and validate the new result before
passing it downstream. A fallback working for quota exhaustion does not justify
using another model to evade a content refusal.

## Revise refused content substantively

A provider's copyright-related message reports its restriction; it does not prove
which input triggered it or establish infringement. Do not invent that diagnosis.
Inspect the effective prompt and every submitted visual reference together.

When the brief permits an original design, create a materially different design
that still fulfills it: change the silhouette, proportions, head or face, armor
language, identifying features and setting as relevant. Describe the new design
positively. Renaming a recognizable design, removing a franchise name while
retaining its imagery, or adding "not copyrighted" does not constitute a redesign.

Use independently authored blocking for pose and composition when it fits the new
design. Remove the superseded identity reference from the effective request; it
must not continue steering the image through an old attachment. Inspect the new
artwork, update the effective prompt and input hashes, then make a new attempt
within the existing budget and attempt limit. Preserve usable choreography and
camera work; revise them only if the new design changes their fit or contacts.

For other policy refusals, revise the request to actually comply with the stated
restriction. Do not conceal prohibited content or change providers to reproduce
the refused content unchanged. If no compliant revision satisfies the brief, or
the revised attempt is refused again, stop blind retries, retain the exact reason
and report the remaining blocker. Never present a Blender preview or still as the
missing generated video.

## Face-image refusals

Seedance 2.5 reference mode on OpenRouter checks every input image for real people
before the job starts. On 2026-10-09 it refused photoreal stills of an original,
generated character at submission: HTTP 400
`InputImageSensitiveContentDetected.PrivacyInformation` ("may contain real person"),
no charge. The filter does not tell a generated face from a real one.

- Flagged: the casting sheet and every still that showed her face.
- Passed: stills with her face turned down, crops without a face, the Blender
  stand-in in the motion reference, and stylised anime faces in an earlier take.
- The error lists the flagged inputs as `content[i]`: 0 is the prompt, then the
  references in request order.

For photoreal people on Seedance, expect face images to be refused and build the
faceless set before the first submission. This request was accepted and followed
the motion reference:

1. Send no image that shows the face: costume crops from the sheet cut below the
   chin (front) and from behind (hair and back), an environment plate cut from a
   still with the character out of frame, and stills where the face is down or
   turned away, reusing the exact bytes that passed.
2. Describe the face with the identity text used for the stills, word for word, and
   add a consistency clause: the same face, skin, hair and outfit in every frame,
   upside down included, and the same grade, contrast, exposure, light and set.
3. Name every image's role in the prompt (costume front, costume back, environment,
   still at its time) and tell the model to ignore the studio backdrop of the crops.
4. Compare the face with the stills. In the accepted take it stayed the same
   throughout and was close to the stills but not identical (slightly rounder).
   Report that; if the face must match the stills exactly, say before paying that
   this route carries the face only through text.

This is for original fictional characters. It is not a way to send a real person's
likeness, which needs that person's consent and a route that permits it.
