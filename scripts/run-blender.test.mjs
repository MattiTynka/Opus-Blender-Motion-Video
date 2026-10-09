import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {blenderArgs, CONTAINER_MEMORY_GIB, CONTAINER_PIDS, containerCommand, engineEnforcesLimits, isolationFor, parseArgs,
  runBlender, scrubEnv, toContainerPath} from './run-blender.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));

function film(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cinematic-blender-test-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  mkdirSync(path.join(dir, 'source'));
  writeFileSync(path.join(dir, 'source', 'build.py'), 'print("build")\n');
  return dir;
}

test('scrubEnv keeps only an allowlist, so unknown secrets and connection strings never reach Blender', () => {
  const env = scrubEnv({
    OPENROUTER_API_KEY: 'x', DATABASE_URL: 'x', SECRET: 'x', AWS_ACCESS_KEY_ID: 'x', GITHUB_TOKEN: 'x', BLENDER_PATH: '/b',
    PATH: '/bin', TEMP: '/t', SystemRoot: 'C:/Windows', APPDATA: '/a', BLENDER_USER_CONFIG: '/c',
  });
  assert.deepEqual(Object.keys(env).sort(), ['APPDATA', 'BLENDER_USER_CONFIG', 'PATH', 'SystemRoot', 'TEMP']);
});

test('parseArgs applies defaults, splits script arguments and rejects bad flags', () => {
  const o = parseArgs(['--script', 'shots/build.py', '--threads', '4', '--read', 'rig', '--write', 'out', '--write', 'logs',
    '--trusted-host', '--', '--frames', '1-24']);
  assert.equal(o.name, 'build');
  assert.equal(o.threads, 4);
  assert.equal(o.timeout, 900);
  assert.equal(o.factory, true);
  assert.equal(o.trustedHost, true);
  assert.equal(o.container, false);
  assert.deepEqual([o.read, o.write], [['rig'], ['out', 'logs']]);
  assert.equal(o.logDir, path.join(path.resolve('shots'), 'logs'));
  assert.deepEqual(o.scriptArgs, ['--frames', '1-24']);
  assert.throws(() => parseArgs(['--blend', 'a.blend']), /--script is required/);
  assert.throws(() => parseArgs(['--script', 'a.py', '--name']), /valueless/);
  assert.throws(() => parseArgs(['--script', 'a.py', '--threads', 'many']), /Invalid --threads/);
});

test('blenderArgs runs headless, untrusted and failing loudly', () => {
  const args = blenderArgs(parseArgs(['--script', 'a.py', '--blend', 'shot.blend', '--', '--x', '1']));
  assert.deepEqual(args.slice(0, 3), ['--background', path.resolve('shot.blend'), '--factory-startup']);
  for (const flag of ['--disable-autoexec', '--python-exit-code']) assert.ok(args.includes(flag));
  assert.deepEqual(args.slice(-3), ['--', '--x', '1']);
  assert.equal(blenderArgs(parseArgs(['--script', 'a.py', '--no-factory-startup'])).includes('--factory-startup'), false);
});

test('only bundled entry points run on the host; other scripts need a container or explicit consent', t => {
  const dir = film(t);
  const own = path.join(dir, 'source', 'build.py');
  const mode = (...argv) => isolationFor(parseArgs(argv));
  assert.equal(mode('--script', path.join(SCRIPTS, 'blender', 'motion_qa.py')), 'host-bundled');
  assert.equal(mode('--script', path.join(SCRIPTS, 'blender_probe.py')), 'host-bundled');
  assert.equal(mode('--script', own), 'container');
  assert.equal(mode('--script', path.join(SCRIPTS, 'blender', 'new_generated.py')), 'container');
  assert.equal(mode('--script', path.join(dir, 'motion_qa.py')), 'container');
  assert.equal(mode('--script', own, '--trusted-host'), 'host-trusted');
  assert.equal(mode('--script', path.join(SCRIPTS, 'blender_probe.py'), '--container'), 'container');
  assert.throws(() => mode('--script', own, '--container', '--trusted-host'), /not both/);
});

test('container runs have no network, a read-only root, no capabilities and only the named writable folders', t => {
  const dir = film(t);
  const out = path.join(dir, 'blender');
  const rig = path.join(dir, 'rig');
  mkdirSync(rig);
  const o = parseArgs(['--script', path.join(dir, 'source', 'build.py'), '--read', rig, '--write', out, '--max-rss-gib', '1.5',
    '--', '--output', path.join(out, 'shot.blend'), '--frames', '1-24']);
  const {args, mounts} = containerCommand(o, 'blender-test');
  const flag = name => args[args.indexOf(name) + 1];
  assert.equal(flag('--network'), 'none');
  assert.ok(args.includes('--read-only') && flag('--cap-drop') === 'all' && flag('--security-opt') === 'no-new-privileges');
  assert.deepEqual(args.filter((a, i) => args[i - 1] === '--env'), ['HOME=/tmp', 'TMPDIR=/tmp']);
  const writable = mounts.filter(m => !m.readOnly).map(m => m.host);
  assert.deepEqual(writable, [out]);
  // The script is mounted as a file, never with the folder around it.
  for (const host of [SCRIPTS, path.join(dir, 'source', 'build.py'), rig]) {
    assert.ok(mounts.some(m => m.host === host && m.readOnly), host);
  }
  assert.ok(!mounts.some(m => [dir, path.join(dir, 'source'), path.dirname(SCRIPTS)].includes(m.host)));
  assert.ok(args.includes(`type=bind,src=${out},dst=${toContainerPath(out)}`));
  assert.deepEqual(args.slice(-5), [toContainerPath(path.join(dir, 'source', 'build.py')), '--output',
    toContainerPath(path.join(out, 'shot.blend')), '--frames', '1-24']);
  assert.throws(() => containerCommand(parseArgs(['--script', path.join(dir, 'source', 'build.py'), '--',
    path.join(os.homedir(), 'secret.txt')]), 'x'), /outside the container's folders/);
  assert.throws(() => containerCommand(parseArgs(['--script', path.join(dir, 'source', 'build.py'), '--write', path.join(dir, 'a,b')]), 'x'),
    /comma/);
});

test('container runs always get hard CPU, memory and process limits', t => {
  const dir = film(t);
  const script = path.join(dir, 'source', 'build.py');
  const flags = args => name => args[args.indexOf(name) + 1];
  const set = flags(containerCommand(parseArgs(['--script', script, '--threads', '3', '--max-rss-gib', '1.5']), 'x').args);
  assert.deepEqual(['--cpus', '--memory', '--memory-swap', '--pids-limit'].map(set), ['3', '1536m', '1536m', String(CONTAINER_PIDS)]);
  const defaults = flags(containerCommand(parseArgs(['--script', script]), 'x').args);
  assert.deepEqual(['--cpus', '--memory'].map(defaults), ['2', `${CONTAINER_MEMORY_GIB * 1024}m`]);
  assert.throws(() => containerCommand(parseArgs(['--script', script, '--threads', '0']), 'x'), /--threads 1 or more/);
});

test('folders holding credentials files are never mounted', t => {
  const dir = film(t);
  const script = path.join(dir, 'source', 'build.py');
  const rig = path.join(dir, 'rig');
  mkdirSync(path.join(rig, 'textures'), {recursive: true});
  writeFileSync(path.join(rig, '.env.example'), 'OPENROUTER_API_KEY=\n');
  assert.doesNotThrow(() => containerCommand(parseArgs(['--script', script, '--read', rig]), 'x'));
  for (const name of ['.env', '.env.local', 'id_ed25519', 'service.pem']) {
    writeFileSync(path.join(rig, 'textures', name), 'x');
    assert.throws(() => containerCommand(parseArgs(['--script', script, '--read', rig]), 'x'), /holds credentials/, name);
    assert.throws(() => containerCommand(parseArgs(['--script', script, '--write', rig]), 'x'), /holds credentials/, name);
    rmSync(path.join(rig, 'textures', name));
  }
  writeFileSync(path.join(dir, 'source', '.env'), 'OPENROUTER_API_KEY=x\n');
  assert.doesNotThrow(() => containerCommand(parseArgs(['--script', script]), 'x'), 'only the script file is mounted');
  assert.throws(() => containerCommand(parseArgs(['--script', script, '--read', dir]), 'x'), /holds credentials/);
});

test('credentials folders are refused when mounted directly or from inside, even with harmless contents', t => {
  const dir = film(t);
  const script = path.join(dir, 'source', 'build.py');
  for (const name of ['.aws', '.docker', '.kube', '.azure', '.gnupg', '.ssh']) {
    const folder = path.join(dir, 'home', name);
    mkdirSync(path.join(folder, 'cache'), {recursive: true});
    writeFileSync(path.join(folder, 'config'), 'x');
    for (const mount of [folder, path.join(folder, 'cache'), path.join(folder, 'config')]) {
      for (const flag of ['--read', '--write']) {
        assert.throws(() => containerCommand(parseArgs(['--script', script, flag, mount]), 'x'),
          new RegExp(`holds credentials \\(\\${name}\\)`), `${flag} ${mount}`);
      }
    }
    writeFileSync(path.join(folder, 'build.py'), 'print(1)\n');
    assert.throws(() => containerCommand(parseArgs(['--script', path.join(folder, 'build.py')]), 'x'), /holds credentials/);
  }
});

test('an engine that cannot enforce the limits is detected', () => {
  const engine = (name, stdout, status = 0) => engineEnforcesLimits(name, () => ({status, stdout}));
  assert.equal(engine('podman', '["cpuset","cpu","io","memory","hugetlb","pids","rdma"]\n'), true);
  assert.equal(engine('podman', '[]\n'), false);
  assert.throws(() => engine('podman', '', 125), /start the engine/);
  assert.equal(engine('C:\\Docker\\docker.exe', 'true true true\n'), true);
  assert.equal(engine('docker', 'true false true\n'), false);
});

test('host folders map under /host in the container', () => {
  if (process.platform === 'win32') assert.equal(toContainerPath('C:\\Film\\shot 1\\a.blend'), '/host/c/Film/shot 1/a.blend');
  else assert.equal(toContainerPath('/home/a/film'), '/host/home/a/film');
});

test('a generated script with no container engine is refused, never run on the host', async t => {
  const dir = film(t);
  await assert.rejects(runBlender(parseArgs(['--script', path.join(dir, 'source', 'build.py'), '--engine', 'no-such-engine-x1'])),
    /No container engine found/);
});

test('the resources report names files relative to the log folder and records the isolation used', async t => {
  const dir = film(t);
  const o = parseArgs(['--script', path.join(dir, 'source', 'build.py'), '--blender', process.execPath, '--trusted-host',
    '--log-dir', path.join(dir, 'logs'), '--', '--output', path.join(dir, 'blender', 'shot.blend')]);
  const report = await runBlender(o);
  const saved = readFileSync(path.join(dir, 'logs', 'build.resources.json'), 'utf8');
  assert.equal(report.isolation, 'host-trusted');
  assert.equal(report.stdout, 'build.stdout.log');
  assert.ok(report.args.includes(path.join('..', 'source', 'build.py')));
  assert.ok(report.args.includes(path.join('..', 'blender', 'shot.blend')));
  assert.ok(!saved.includes(path.basename(dir)));
});
