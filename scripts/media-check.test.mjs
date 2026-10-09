import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {checkExpectations, reportPath, summarize} from './media-check.mjs';

const probe = (overrides = {}) => ({
  format: {format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '5.041667'},
  streams: [
    {codec_type: 'video', codec_name: 'h264', width: 1280, height: 720, pix_fmt: 'yuv420p',
      avg_frame_rate: '24/1', nb_frames: '999', nb_read_frames: '121', duration: '5.041667', ...overrides},
    {codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, duration: '5.000000'},
  ],
});

test('summarize prefers counted frames and derives fps and pixels', () => {
  const s = summarize(probe());
  assert.equal(s.video.frames, 121);
  assert.equal(s.video.fps, 24);
  assert.equal(s.video.pixels, 921600);
  assert.equal(s.audio.sampleRate, 48000);
  assert.equal(summarize({streams: [], format: {}}).video, undefined);
});

test('checkExpectations reports each failed expectation', () => {
  const s = summarize(probe());
  assert.deepEqual(checkExpectations(s, {frames: 121, seconds: 5.041667, tolerance: 0.0005, size: '1280x720',
    fps: 24, minPixels: 407696, audio: true}), []);
  assert.deepEqual(checkExpectations(s, {frames: 120, seconds: 5, tolerance: 0.0005}), [
    'frames 121 != 120', 'video seconds 5.041667 != 5', 'container seconds 5.041667 != 5']);
  assert.deepEqual(checkExpectations(s, {audio: false}), ['unexpected audio stream']);
  const small = summarize(probe({width: 848, height: 480}));
  assert.deepEqual(checkExpectations(small, {minPixels: 407696}), ['pixels 407040 < 407696']);
  assert.deepEqual(checkExpectations(summarize({streams: [], format: {}}), {}), ['no video stream']);
});

test('reportPath names files relative to the report, never by local folder', () => {
  const film = path.join(os.tmpdir(), 'film');
  assert.equal(reportPath(path.join(film, 'final.mp4'), path.join(film, 'review', 'probe.json')), path.join('..', 'final.mp4'));
  assert.equal(reportPath(path.join(process.cwd(), 'a.mp4')), 'a.mp4');
  if (process.platform === 'win32') assert.equal(reportPath('Q:\\elsewhere\\take.mp4', 'C:\\film\\probe.json'), 'take.mp4');
});
