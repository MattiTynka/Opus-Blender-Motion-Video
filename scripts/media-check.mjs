// Probe and fully decode a video/image with FFprobe/FFmpeg; optionally assert
// expectations and write a contact sheet. Local only; secrets are removed from
// the media tools' environment.
import {spawnSync} from 'node:child_process';
import {existsSync, writeFileSync, statSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scrubEnv} from './run-blender.mjs';

export function findTool(name, env = process.env) {
  const override = env[`${name.toUpperCase()}_PATH`];
  if (override && existsSync(override)) return override;
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const located = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], {encoding: 'utf8', windowsHide: true});
  if (located.status === 0 && located.stdout.trim()) return located.stdout.split(/\r?\n/)[0].trim();
  // WinGet installs link FFmpeg here; child processes may not inherit that PATH entry.
  const winget = env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft/WinGet/Links', exe);
  if (winget && existsSync(winget)) return winget;
  throw new Error(`${name} not found; set ${name.toUpperCase()}_PATH`);
}

function run(exe, args, timeout = 300000) {
  const r = spawnSync(exe, args, {env: scrubEnv(process.env), encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 64 * 1024 * 1024});
  return {status: r.status, stdout: r.stdout ?? '', stderr: (r.stderr ?? '').trim()};
}

export function summarize(probe) {
  const video = probe.streams.find(s => s.codec_type === 'video');
  const audio = probe.streams.find(s => s.codec_type === 'audio');
  const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    container: probe.format?.format_name, containerSeconds: Number(probe.format?.duration ?? NaN),
    video: video && {codec: video.codec_name, width: video.width, height: video.height, pixels: video.width * video.height,
      pixFmt: video.pix_fmt, fps: den ? num / den : null, frames: Number(video.nb_read_frames ?? video.nb_frames ?? NaN),
      seconds: Number(video.duration ?? NaN)},
    audio: audio && {codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels,
      seconds: Number(audio.duration ?? NaN)},
  };
}

export function checkExpectations(summary, expect) {
  const failures = [];
  const v = summary.video;
  if (!v) return ['no video stream'];
  if (expect.frames != null && v.frames !== expect.frames) failures.push(`frames ${v.frames} != ${expect.frames}`);
  if (expect.seconds != null) {
    for (const [label, value] of [['video', v.seconds], ['container', summary.containerSeconds]]) {
      if (!(Math.abs(value - expect.seconds) <= expect.tolerance)) failures.push(`${label} seconds ${value} != ${expect.seconds}`);
    }
  }
  if (expect.size && `${v.width}x${v.height}` !== expect.size) failures.push(`size ${v.width}x${v.height} != ${expect.size}`);
  if (expect.minPixels != null && v.pixels < expect.minPixels) failures.push(`pixels ${v.pixels} < ${expect.minPixels}`);
  if (expect.fps != null && Math.abs(v.fps - expect.fps) > 1e-3) failures.push(`fps ${v.fps} != ${expect.fps}`);
  if (expect.audio === true && !summary.audio) failures.push('audio stream missing');
  if (expect.audio === false && summary.audio) failures.push('unexpected audio stream');
  return failures;
}

function parseArgs(argv) {
  const o = {expect: {tolerance: 0.0005}, decode: true};
  const take = i => { if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-decode') { o.decode = false; continue; }
    if (a === '--expect-audio') { o.expect.audio = true; continue; }
    if (a === '--expect-silent') { o.expect.audio = false; continue; }
    const value = take(i); i++;
    if (a === '--input') o.input = value;
    else if (a === '--output') o.output = value;
    else if (a === '--contact-sheet') o.sheet = value;
    else if (a === '--sheet-grid') o.grid = value;
    else if (a === '--expect-frames') o.expect.frames = Number(value);
    else if (a === '--expect-seconds') o.expect.seconds = Number(value);
    else if (a === '--seconds-tolerance') o.expect.tolerance = Number(value);
    else if (a === '--expect-size') o.expect.size = value;
    else if (a === '--expect-fps') o.expect.fps = Number(value);
    else if (a === '--min-pixels') o.expect.minPixels = Number(value);
    else throw new Error(`Unknown flag ${a}`);
  }
  if (!o.input) throw new Error('--input is required');
  return o;
}

// Reports name files relative to the report's folder (or the working folder when only printed); a file
// on another drive by name only. Never local folder names.
export function reportPath(target, reportFile) {
  const base = reportFile ? path.dirname(path.resolve(reportFile)) : process.cwd();
  const r = path.relative(base, path.resolve(target));
  return path.isAbsolute(r) ? path.basename(target) : r;
}

export function checkMedia(o) {
  const ffprobe = findTool('ffprobe');
  const probe = run(ffprobe, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', o.input]);
  if (probe.status !== 0) throw new Error(`ffprobe failed: ${probe.stderr.slice(-800)}`);
  const summary = summarize(JSON.parse(probe.stdout));
  const bytes = readFileSync(o.input);
  const report = {file: reportPath(o.input, o.output), bytes: statSync(o.input).size,
    sha256: createHash('sha256').update(bytes).digest('hex'), ...summary};
  if (o.decode || o.sheet) {
    const ffmpeg = findTool('ffmpeg');
    if (o.decode) {
      const decoded = run(ffmpeg, ['-v', 'error', '-i', o.input, '-f', 'null', '-']);
      report.fullDecode = {passed: decoded.status === 0 && !decoded.stderr, stderr: decoded.stderr.slice(-800)};
    }
    if (o.sheet && summary.video) {
      const [cols, rows] = (o.grid ?? '5x6').split('x').map(Number);
      const seconds = summary.video.seconds || summary.containerSeconds;
      const rate = (cols * rows) / seconds;
      const made = run(ffmpeg, ['-v', 'error', '-y', '-i', o.input, '-vf',
        `fps=${rate.toFixed(6)},scale=384:-2,tile=${cols}x${rows}`, '-frames:v', '1', o.sheet]);
      report.contactSheet = made.status === 0 ? reportPath(o.sheet, o.output) : {error: made.stderr.slice(-800)};
    }
  }
  report.failures = checkExpectations(summary, o.expect);
  if (report.fullDecode && !report.fullDecode.passed) report.failures.push('full decode failed');
  report.note = 'Probe/decode establish file properties only, not motion quality or audio sync.';
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = checkMedia(options);
    if (options.output) writeFileSync(options.output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.failures.length ? 3 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
