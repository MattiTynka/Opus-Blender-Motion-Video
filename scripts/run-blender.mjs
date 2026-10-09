// Run one owned headless Blender process with a minimal environment, bounded threads,
// a timeout and a free-RAM guard. Logs and a resources report go to --log-dir.
// Only the bundled entry points run on the host. Any other script runs in a container with
// no network, a read-only root, hard CPU/memory/process limits, no credentials files and only
// the folders named with --write writable, unless the user explicitly allowed host execution
// (--trusted-host).
import {spawn, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, mkdirSync, createWriteStream, statSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';

// Blender and FFmpeg get only what they need to start; credentials, connection strings and
// every other variable stay out.
const ENV_KEEP = new RegExp('^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|' +
  'HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\\(X86\\)|COMMONPROGRAMFILES|' +
  'NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|LANG|LC_[A-Z]+|TZ|DISPLAY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR|OCIO|' +
  'BLENDER_(USER|SYSTEM)_[A-Z_]+)$', 'i');
const GiB = 1024 ** 3;
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP = path.join(SCRIPTS, 'blender', 'container_bootstrap.py');
// The only scripts trusted to run on the host: shipped and reviewed with the skill.
const BUNDLED = ['blender_probe.py', 'blender/inspect_rig.py', 'blender/motion_qa.py'].map(f => path.join(SCRIPTS, f));
export const DEFAULT_IMAGE = 'blender-headless:5.2.1';
// Container limits when no flag sets them: memory (without --max-rss-gib) and processes plus threads.
export const CONTAINER_MEMORY_GIB = 4;
export const CONTAINER_PIDS = 512;
// Files and folders that commonly hold credentials; a mount that is or contains one is refused.
const CREDENTIALS = /^(\.env(\..+)?|\.npmrc|\.netrc|\.pgpass|\.pypirc|\.git-credentials|\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.azure|id_(rsa|dsa|ecdsa|ed25519)|.+\.(pem|key|p12|pfx))$/i;
const isCredential = name => CREDENTIALS.test(name) && name.toLowerCase() !== '.env.example';

export function scrubEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => ENV_KEEP.test(key)));
}

const within = (child, parent) => {
  const r = path.relative(parent, child);
  return r === '' || (r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r));
};
export const isBundled = script => BUNDLED.some(file => path.relative(file, path.resolve(script)) === '');

export function isolationFor(o) {
  if (o.container && o.trustedHost) throw new Error('Choose --container or --trusted-host, not both');
  if (o.container) return 'container';
  if (isBundled(o.script)) return 'host-bundled';
  return o.trustedHost ? 'host-trusted' : 'container';
}

// Host folders appear under /host in the container: C:\film -> /host/c/film, /home/a/film -> /host/home/a/film.
export function toContainerPath(hostPath) {
  const abs = path.resolve(hostPath);
  if (process.platform !== 'win32') return path.posix.join('/host', abs);
  const drive = /^([A-Za-z]):\\?(.*)$/.exec(abs);
  if (!drive) throw new Error(`Cannot mount ${abs} in a container: only drive-letter paths are supported`);
  return path.posix.join('/host', drive[1].toLowerCase(), drive[2].replace(/\\/g, '/'));
}

// Credentials in the mount's own path (the mounted file or folder, or a folder it lies in) or anywhere inside it.
export function credentialFiles(hostPath) {
  const parts = path.resolve(hostPath).split(/[\\/]/);
  const named = parts.findIndex(isCredential);
  if (named !== -1) return [parts.slice(0, named + 1).join(path.sep)];
  if (!existsSync(hostPath) || !statSync(hostPath).isDirectory()) return [];
  return readdirSync(hostPath, {recursive: true, withFileTypes: true})
    .filter(entry => isCredential(entry.name)).map(entry => path.join(entry.parentPath, entry.name));
}

// Read-only: the skill's scripts, the script file, the .blend file and every --read; writable: every --write.
// Only the named paths are mounted, never their parent folders, and nothing that holds credentials.
export function containerMounts(o) {
  const key = p => (process.platform === 'win32' ? p.toLowerCase() : p);
  const mounts = new Map();
  for (const host of [SCRIPTS, ...o.read.map(p => path.resolve(p))]) mounts.set(key(host), {host, readOnly: true});
  for (const host of o.write.map(p => path.resolve(p))) mounts.set(key(host), {host, readOnly: false});
  for (const file of [o.script, ...(o.blend ? [o.blend] : [])].map(p => path.resolve(p))) {
    if (![...mounts.values()].some(m => within(file, m.host))) mounts.set(key(file), {host: file, readOnly: true});
  }
  return [...mounts.values()].map(m => {
    if (m.host.includes(',')) throw new Error(`Cannot mount a path containing a comma: ${m.host}`);
    const found = credentialFiles(m.host);
    if (found.length) {
      const label = f => (within(f, m.host) && path.relative(m.host, f)) || path.basename(f);
      throw new Error(`Refusing to mount ${m.host}: it is, lies in or holds credentials ` +
        `(${found.slice(0, 3).map(label).join(', ')}); move them out or name a narrower folder`);
    }
    return {...m, target: toContainerPath(m.host)};
  }).sort((a, b) => a.target.split('/').length - b.target.split('/').length);
}

// Absolute script arguments are translated to container paths and must lie inside a mount.
export function containerScriptArgs(args, mounts) {
  return args.map(arg => {
    if (!path.isAbsolute(arg)) return arg;
    if (!mounts.some(m => within(path.resolve(arg), m.host))) {
      throw new Error(`Script argument ${arg} is outside the container's folders: add --read or --write`);
    }
    return toContainerPath(arg);
  });
}

export function containerCommand(o, name) {
  if (!(o.threads >= 1)) throw new Error('Container runs need --threads 1 or more: it is also the CPU limit');
  const mounts = containerMounts(o);
  const blender = blenderArgs(o, {at: toContainerPath, python: toContainerPath(BOOTSTRAP),
    args: [toContainerPath(o.script), ...containerScriptArgs(o.scriptArgs, mounts)]});
  const limits = {cpus: o.threads, memory: `${Math.ceil((o.maxRssGiB || CONTAINER_MEMORY_GIB) * 1024)}m`, pidsLimit: CONTAINER_PIDS};
  const args = ['run', '--rm', '--name', name, '--network', 'none', '--read-only', '--tmpfs', '/tmp',
    '--cap-drop', 'all', '--security-opt', 'no-new-privileges', '--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp',
    // Enforced by the kernel, whatever the script does: CPUs, memory with no extra swap, processes plus threads.
    '--cpus', String(limits.cpus), '--memory', limits.memory, '--memory-swap', limits.memory,
    '--pids-limit', String(limits.pidsLimit),
    ...mounts.flatMap(m => ['--mount', `type=bind,src=${m.host},dst=${m.target}${m.readOnly ? ',ro=true' : ''}`]),
    '--workdir', '/tmp', o.image ?? DEFAULT_IMAGE, 'blender', ...blender];
  return {args, mounts, limits};
}

// Rootless Podman without delegated cgroup controllers (as on WSL) cannot apply the limits, so check first.
export function engineEnforcesLimits(engine, run = spawnSync) {
  const docker = /docker/i.test(path.basename(engine));
  const format = docker ? '{{.MemoryLimit}} {{.CPUCfsQuota}} {{.PidsLimit}}' : '{{json .Host.CgroupControllers}}';
  const r = run(engine, ['info', '--format', format], {encoding: 'utf8', windowsHide: true});
  if (r.status !== 0) throw new Error(`"${engine} info" failed: start the engine (podman machine start) and retry`);
  if (docker) return r.stdout.trim() === 'true true true';
  try { return ['cpu', 'memory', 'pids'].every(c => JSON.parse(r.stdout).includes(c)); } catch { return false; }
}

export function findEngine(explicit) {
  for (const engine of explicit ? [explicit] : ['podman', 'docker']) {
    if (spawnSync(engine, ['--version'], {stdio: 'ignore', windowsHide: true}).status === 0) return engine;
  }
  throw new Error('No container engine found: install Podman or Docker and build the image ' +
    '(references/blender-headless.md), or ask the user to allow --trusted-host for this script');
}

export function findBlender({explicit, env = process.env, repo = process.cwd()} = {}) {
  const candidates = [explicit, env.BLENDER_PATH];
  const envFile = path.join(repo, '.env');
  if (existsSync(envFile)) {
    try { candidates.push(parseEnv(readFileSync(envFile, 'utf8')).BLENDER_PATH); } catch { /* unreadable .env: ignore */ }
  }
  if (process.platform === 'win32') {
    const root = path.join(env.ProgramFiles ?? 'C:/Program Files', 'Blender Foundation');
    if (existsSync(root)) {
      const versions = readdirSync(root).filter(d => /^Blender \d+\.\d+$/.test(d))
        .sort((a, b) => versionKey(b) - versionKey(a));
      candidates.push(...versions.map(d => path.join(root, d, 'blender.exe')));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  }
  for (const candidate of candidates) if (candidate && existsSync(candidate)) return candidate;
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['blender'], {encoding: 'utf8'});
  const found = onPath.status === 0 ? onPath.stdout.split(/\r?\n/)[0].trim() : '';
  if (found) return found;
  throw new Error('Blender not found: pass --blender or set BLENDER_PATH');
}

function versionKey(dir) {
  const [major, minor] = dir.replace('Blender ', '').split('.').map(Number);
  return major * 1000 + minor;
}

function rssBytes(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {encoding: 'utf8', windowsHide: true});
    // tasklist prints in the OEM code page; locale digit separators may decode as U+FFFD.
    const match = /"([^"]*\d[^"]*) K"\s*$/.exec(r.stdout?.trim() ?? '');
    return match ? Number(match[1].replace(/\D/g, '')) * 1024 : null;
  }
  if (process.platform === 'linux') {
    try { return Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024; } catch { return null; }
  }
  const r = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], {encoding: 'utf8'});
  return r.status === 0 ? Number(r.stdout.trim()) * 1024 : null;
}

export function parseArgs(argv) {
  const split = argv.indexOf('--');
  const own = split === -1 ? argv : argv.slice(0, split);
  const options = {threads: 2, timeout: 900, minFreeGiB: 1.0, maxRssGiB: 0, factory: true, container: false,
    trustedHost: false, read: [], write: [], scriptArgs: split === -1 ? [] : argv.slice(split + 1)};
  const flags = {'--script': 'script', '--blend': 'blend', '--blender': 'blender', '--log-dir': 'logDir',
    '--name': 'name', '--threads': 'threads', '--timeout': 'timeout', '--min-free-gib': 'minFreeGiB',
    '--max-rss-gib': 'maxRssGiB', '--repo': 'repo', '--image': 'image', '--engine': 'engine'};
  const switches = {'--no-factory-startup': ['factory', false], '--container': ['container', true],
    '--trusted-host': ['trustedHost', true]};
  for (let i = 0; i < own.length; i++) {
    if (switches[own[i]]) { const [key, value] = switches[own[i]]; options[key] = value; continue; }
    const key = flags[own[i]] ?? {'--read': 'read', '--write': 'write'}[own[i]];
    const value = own[i + 1];
    if (!key || value === undefined || value.startsWith('--')) throw new Error(`Bad or valueless flag: ${own[i]}`);
    if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = ['threads', 'timeout', 'minFreeGiB', 'maxRssGiB'].includes(key) ? Number(value) : value;
    i++;
  }
  if (!options.script) throw new Error('--script is required');
  for (const key of ['threads', 'timeout', 'minFreeGiB', 'maxRssGiB']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`Invalid --${key}`);
  }
  options.name ??= path.basename(options.script).replace(/\.py$/, '');
  options.logDir ??= path.join(path.dirname(path.resolve(options.script)), 'logs');
  return options;
}

export function blenderArgs(o, {at = p => path.resolve(p), python = at(o.script), args = o.scriptArgs} = {}) {
  return ['--background', ...(o.blend ? [at(o.blend)] : []), ...(o.factory ? ['--factory-startup'] : []),
    '--disable-autoexec', '--threads', String(o.threads), '--python-exit-code', '1', '--python', python, '--', ...args];
}

export async function runBlender(o) {
  const isolation = isolationFor(o);
  mkdirSync(o.logDir, {recursive: true});
  // Reports name files relative to the log folder (a file on another drive by name only), never local folders.
  const rel = p => { const r = path.relative(o.logDir, path.resolve(p)); return path.isAbsolute(r) ? path.basename(p) : r; };
  const out = path.join(o.logDir, `${o.name}.stdout.log`);
  const err = path.join(o.logDir, `${o.name}.stderr.log`);
  let command, args, env, engine = null, name = null, container = null, blender;
  if (isolation === 'container') {
    engine = findEngine(o.engine);
    if (!engineEnforcesLimits(engine)) {
      throw new Error(`${engine} cannot enforce CPU, memory and process limits here (no cgroup controllers; rootless ` +
        'Podman on WSL has none): use its rootful connection (CONTAINER_CONNECTION=podman-machine-default-root) ' +
        'or Docker (references/blender-headless.md)');
    }
    const image = o.image ?? DEFAULT_IMAGE;
    if (spawnSync(engine, ['image', 'inspect', image], {stdio: 'ignore', windowsHide: true}).status !== 0) {
      throw new Error(`Container image ${image} not found: build it with ` +
        `"${engine} build -t ${image} <skill>/assets/blender-container" (references/blender-headless.md)`);
    }
    for (const dir of o.write) mkdirSync(dir, {recursive: true});
    name = `blender-${process.pid}-${Date.now()}`;
    let mounts, limits;
    ({args, mounts, limits} = containerCommand(o, name));
    // The engine client keeps its own configuration; the container itself receives only HOME and TMPDIR.
    command = engine; env = process.env; blender = `${engine} ${image}`;
    container = {engine, image, network: 'none', rootFilesystem: 'read-only', limits,
      read: mounts.filter(m => m.readOnly).map(m => rel(m.host)), write: mounts.filter(m => !m.readOnly).map(m => rel(m.host))};
  } else {
    command = blender = findBlender({explicit: o.blender, repo: o.repo ?? process.cwd()});
    args = blenderArgs(o);
    env = scrubEnv(process.env);
  }
  const child = spawn(command, args, {env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  child.stdout.pipe(createWriteStream(out));
  child.stderr.pipe(createWriteStream(err));
  const started = Date.now();
  let peak = 0, minFree = os.freemem(), stopped = null;
  const stop = reason => {
    if (stopped) return;
    stopped = reason;
    if (name) spawnSync(engine, ['kill', name], {stdio: 'ignore', windowsHide: true});
    child.kill();
  };
  const timer = setInterval(() => {
    const free = os.freemem();
    minFree = Math.min(minFree, free);
    // In a container the memory limit is the engine's --memory; the client process's RSS says nothing.
    const rss = container ? null : rssBytes(child.pid);
    if (rss) peak = Math.max(peak, rss);
    if (free < o.minFreeGiB * GiB) stop(`free RAM below ${o.minFreeGiB} GiB`);
    else if (o.maxRssGiB && rss > o.maxRssGiB * GiB) stop(`Blender RSS above ${o.maxRssGiB} GiB`);
    else if (Date.now() - started > o.timeout * 1000) stop(`timeout after ${o.timeout} s`);
  }, 2000);
  const [code, signal] = await new Promise(resolve => child.on('close', (c, s) => resolve([c, s])));
  clearInterval(timer);
  const shown = blenderArgs(o, {at: rel, args: o.scriptArgs.map(a => (path.isAbsolute(a) ? rel(a) : a))});
  const report = {isolation, blender, args: shown, container, exitCode: code, signal, stoppedReason: stopped,
    seconds: (Date.now() - started) / 1000, peakRssGiB: container ? null : +(peak / GiB).toFixed(3),
    minFreeGiB: +(minFree / GiB).toFixed(3), totalRamGiB: +(os.totalmem() / GiB).toFixed(2),
    threads: o.threads, stdout: rel(out), stderr: rel(err)};
  writeFileSync(path.join(o.logDir, `${o.name}.resources.json`), JSON.stringify(report, null, 2));
  return report;
}

function tail(file, lines) {
  try { return readFileSync(file, 'utf8').trimEnd().split(/\r?\n/).slice(-lines).join('\n'); } catch { return ''; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runBlender(options);
    console.log(tail(path.resolve(options.logDir, report.stdout), 12));
    if (report.exitCode !== 0 || report.stoppedReason) console.error(tail(path.resolve(options.logDir, report.stderr), 20));
    console.log(JSON.stringify({isolation: report.isolation, exitCode: report.exitCode, stoppedReason: report.stoppedReason,
      seconds: report.seconds, peakRssGiB: report.peakRssGiB, minFreeGiB: report.minFreeGiB}));
    process.exitCode = report.stoppedReason ? 4 : (report.exitCode ?? 1);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
