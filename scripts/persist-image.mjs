import { constants } from 'node:fs';
import { mkdir, open, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';

function identifyImage(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
      bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return { mime: 'application/octet-stream', extension: null };
}

// Caller supplies one completed image and a trusted local output root. No network,
// credential loading, image decoding, conversion, or provider retry happens here.
export async function persistImage({ b64Json, outputRoot, attemptId, declaredMime = null,
  maxBytes = 32 * 1024 * 1024 }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 256 * 1024 * 1024) {
    throw new Error('maxBytes must be a positive integer no greater than 256 MiB');
  }
  if (typeof outputRoot !== 'string' || !outputRoot.length ||
      typeof attemptId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(attemptId)) {
    throw new Error('A trusted outputRoot and a safe unique attemptId are required');
  }
  // A bad optional MIME hint must not discard an otherwise preservable image.
  const normalizedDeclaredMime = typeof declaredMime === 'string' && declaredMime.length <= 128 &&
    /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(declaredMime) ? declaredMime.toLowerCase() : null;
  const maxEncoded = 4 * Math.ceil(maxBytes / 3);
  if (typeof b64Json !== 'string' || b64Json.length > maxEncoded + 128) {
    throw new Error('Missing base64 image or encoded byte limit exceeded');
  }
  let encoded = b64Json;
  let dataUriMime = null;
  if (encoded.startsWith('data:')) {
    const prefix = /^data:(image\/[a-zA-Z0-9.+-]+);base64,/.exec(encoded.slice(0, 128));
    if (!prefix) throw new Error('Unsupported image data URI');
    dataUriMime = prefix[1].toLowerCase();
    encoded = encoded.slice(prefix[0].length);
  }
  if (!encoded.length || encoded.length > maxEncoded || encoded.length % 4 !== 0 ||
      !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Invalid canonical base64 image or encoded byte limit exceeded');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== encoded) {
    throw new Error('Invalid canonical base64 image or decoded byte limit exceeded');
  }

  const directory = resolve(outputRoot, attemptId);
  await mkdir(resolve(outputRoot), { recursive: true });
  // Exclusive directory creation prevents overwriting an earlier attempt or take.
  await mkdir(directory);
  const rawPath = join(directory, 'original.bin');
  const raw = await open(rawPath, 'wx');
  try {
    await raw.writeFile(bytes);
    await raw.sync();
  } finally {
    await raw.close();
  }

  // Persist first. A format surprise or downstream failure must not lose paid media.
  const detected = identifyImage(bytes);
  const originalPath = detected.extension
    ? join(directory, 'original.' + detected.extension) : rawPath;
  if (originalPath !== rawPath) await copyFile(rawPath, originalPath, constants.COPYFILE_EXCL);
  // Paths are relative to outputRoot, so neither media.json nor an attempt record embedding
  // this manifest names local folders.
  const manifest = {
    state: 'stored_unvalidated',
    attemptId,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    declaredMime: normalizedDeclaredMime,
    declaredMimeRejected: declaredMime !== null && normalizedDeclaredMime === null,
    dataUriMime,
    detectedMime: detected.mime,
    recognizedHeader: detected.extension !== null,
    mimeMismatch: [normalizedDeclaredMime, dataUriMime]
      .filter(Boolean).some(mime => mime !== detected.mime),
    rawPath: relative(resolve(outputRoot), rawPath),
    originalPath: relative(resolve(outputRoot), originalPath),
  };
  await writeFile(join(directory, 'media.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}
