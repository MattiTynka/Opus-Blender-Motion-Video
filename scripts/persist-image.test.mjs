import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { persistImage } from './persist-image.mjs';

// Header fixtures test persistence/classification only, not successful decoding.
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);
async function setup(t) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'cinematic-image-'));
  t.after(async () => {
    assert.equal(dirname(resolve(outputRoot)), resolve(tmpdir()));
    assert.match(basename(outputRoot), /^cinematic-image-/);
    await rm(outputRoot, { recursive: true, force: true });
  });
  return outputRoot;
}
const input = (outputRoot, bytes, extra = {}) => ({ outputRoot, attemptId: 'image-01',
  b64Json: bytes.toString('base64'), ...extra });

for (const [mime, extension, bytes] of [
  ['image/png', 'png', png], ['image/jpeg', 'jpg', jpeg], ['image/webp', 'webp', webp],
]) {
  test('preserves original ' + mime + ' bytes and unvalidated state', async t => {
    const outputRoot = await setup(t);
    const result = await persistImage(input(outputRoot, bytes));
    assert.equal(result.detectedMime, mime);
    assert.ok(result.originalPath.endsWith('.' + extension));
    assert.deepEqual(await readFile(join(outputRoot, result.rawPath)), bytes);
    assert.deepEqual(await readFile(join(outputRoot, result.originalPath)), bytes);
    assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.state, 'stored_unvalidated');
    assert.equal(JSON.parse(await readFile(join(outputRoot, 'image-01/media.json'))).sha256, result.sha256);
  });
}
test('manifest paths are relative to the output root and never name local folders', async t => {
  const outputRoot = await setup(t);
  const result = await persistImage(input(outputRoot, png));
  assert.equal(result.rawPath, join('image-01', 'original.bin'));
  assert.equal(result.originalPath, join('image-01', 'original.png'));
  const saved = await readFile(join(outputRoot, 'image-01/media.json'), 'utf8');
  assert.ok(!saved.includes(basename(outputRoot)) && !JSON.stringify(result).includes(basename(outputRoot)));
});
test('JPEG returned when PNG was expected is retained and mismatch recorded', async t => {
  const outputRoot = await setup(t);
  const result = await persistImage(input(outputRoot, jpeg, { declaredMime: 'image/png' }));
  assert.equal(result.mimeMismatch, true);
  assert.equal(result.detectedMime, 'image/jpeg');
  assert.deepEqual(await readFile(join(outputRoot, result.originalPath)), jpeg);
});
test('strips a supported data URI without changing image bytes', async t => {
  const outputRoot = await setup(t);
  const result = await persistImage(input(outputRoot, jpeg, {
    b64Json: 'data:image/jpeg;base64,' + jpeg.toString('base64'),
  }));
  assert.equal(result.dataUriMime, 'image/jpeg');
  assert.equal(result.mimeMismatch, false);
  assert.deepEqual(await readFile(join(outputRoot, result.rawPath)), jpeg);
});
test('retains unrecognized bytes without claiming image validation', async t => {
  const outputRoot = await setup(t);
  const unknown = Buffer.from('unsupported-format-or-truncated-data');
  const result = await persistImage(input(outputRoot, unknown));
  assert.equal(result.recognizedHeader, false);
  assert.equal(result.detectedMime, 'application/octet-stream');
  assert.equal(result.originalPath, result.rawPath);
  assert.deepEqual(await readFile(join(outputRoot, result.rawPath)), unknown);
});
test('rejects invalid or noncanonical base64 before creating an attempt', async t => {
  const outputRoot = await setup(t);
  for (const b64Json of ['', '!!!!', 'abcd=', 'YQ==\n', 'YR==', 'data:text/html;base64,YQ==']) {
    await assert.rejects(persistImage(input(outputRoot, png, { b64Json })), /base64|data URI/);
  }
  assert.deepEqual(await readdir(outputRoot), []);
});
test('enforces decoded as well as encoded byte limits', async t => {
  const outputRoot = await setup(t);
  await assert.rejects(persistImage(input(outputRoot, Buffer.from('abcde'), { maxBytes: 4 })), /decoded byte limit/);
  await assert.rejects(persistImage(input(outputRoot, png, { maxBytes: 1 })), /encoded byte limit/);
  assert.deepEqual(await readdir(outputRoot), []);
});
test('accepts the exact byte limit', async t => {
  const outputRoot = await setup(t);
  const result = await persistImage(input(outputRoot, jpeg, { maxBytes: jpeg.length }));
  assert.equal(result.bytes, jpeg.length);
});
test('rejects unsafe attempt names and invalid options', async t => {
  const outputRoot = await setup(t);
  for (const attemptId of ['../escape', '..', 'a/b', 'a\\b', 'C:elsewhere', '']) {
    await assert.rejects(persistImage(input(outputRoot, png, { attemptId })), /safe unique attemptId/);
  }
  await assert.rejects(persistImage(input(outputRoot, png, { maxBytes: Infinity })), /maxBytes/);
  assert.deepEqual(await readdir(outputRoot), []);
});
test('an existing attempt is never overwritten', async t => {
  const outputRoot = await setup(t);
  const original = await persistImage(input(outputRoot, jpeg));
  await assert.rejects(persistImage(input(outputRoot, png)), { code: 'EEXIST' });
  assert.deepEqual(await readFile(join(outputRoot, original.rawPath)), jpeg);
});
test('concurrent claims cannot overwrite the winning attempt', async t => {
  const outputRoot = await setup(t);
  const results = await Promise.allSettled([
    persistImage(input(outputRoot, jpeg)), persistImage(input(outputRoot, png)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'EEXIST');
  const winner = results.find(result => result.status === 'fulfilled').value;
  const bytes = await readFile(join(outputRoot, winner.rawPath));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), winner.sha256);
});

test('malformed optional MIME metadata cannot discard paid image bytes', async t => {
  const outputRoot = await setup(t);
  const result = await persistImage(input(outputRoot, jpeg, { declaredMime: 'image/png\nuntrusted' }));
  assert.equal(result.declaredMimeRejected, true);
  assert.equal(result.declaredMime, null);
  assert.deepEqual(await readFile(join(outputRoot, result.rawPath)), jpeg);
  assert.ok(!JSON.stringify(result).includes('untrusted'));
});
