import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {inspectCredentials} from './check-env.mjs';

function fixture(t, content) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cinematic-env-test-'));
  t.after(() => {
    const resolved = path.resolve(dir);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('cinematic-env-test-'));
    rmSync(resolved, {recursive: true});
  });
  if (content !== undefined) writeFileSync(path.join(dir, '.env'), content);
  return dir;
}

test('missing file and empty keys report missing without creating .env', t => {
  const dir = fixture(t);
  assert.deepEqual(inspectCredentials(dir, ['openai'], {}).checks[0], {
    provider: 'openai', acceptedKeys: ['OPENAI_API_KEY'], selectedKey: null, present: false,
  });
  assert.equal(inspectCredentials(dir, ['openai'], {}).envFileExists, false);
  writeFileSync(path.join(dir, '.env'), 'OPENAI_API_KEY="  "\n');
  assert.equal(inspectCredentials(dir, ['openai'], {}).ready, false);
});

test('dotenv parsing, provider selection, and redaction preserve file bytes', t => {
  const content = '# fixture\nOPENAI_API_KEY="canary-secret-a#quoted"\nGEMINI_API_KEY=canary-secret-b\n';
  const dir = fixture(t, content);
  const result = inspectCredentials(dir, ['openai', 'google'], {});
  assert.equal(result.ready, true);
  assert.equal(result.authenticated, false);
  assert.equal(JSON.stringify(result).includes('canary-secret'), false);
  assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), content);
  assert.equal(inspectCredentials(dir, ['fal'], {}).ready, false);
});

test('inherited precedence and explicit Google alias selection', t => {
  const dir = fixture(t, 'GEMINI_API_KEY=file-canary\nGOOGLE_API_KEY=alias-canary\n');
  assert.equal(inspectCredentials(dir, ['google'], {}).checks[0].selectedKey, 'GEMINI_API_KEY');
  assert.equal(inspectCredentials(dir, ['google'], {GEMINI_API_KEY: ''}).checks[0].selectedKey, 'GOOGLE_API_KEY');
  const inherited = {OPENAI_API_KEY: 'inherited-canary'};
  assert.equal(inspectCredentials(dir, ['openai'], inherited).ready, true);
  assert.deepEqual(inherited, {OPENAI_API_KEY: 'inherited-canary'});
});

test('unknown providers and unreadable env yield fixed errors', t => {
  const dir = fixture(t);
  assert.throws(() => inspectCredentials(dir, ['__proto__'], {}), /Select providers/);
  assert.throws(() => inspectCredentials(dir, [], {}), /Select providers/);
  mkdirSync(path.join(dir, '.env'));
  assert.throws(() => inspectCredentials(dir, ['google'], {}), /^Error: Cannot read or parse the repo .env; inspect it privately$/);
});

test('CLI exit codes distinguish ready, missing, and invalid without printing values', t => {
  const dir = fixture(t, 'GEMINI_API_KEY=cli-canary-secret\nHF_API_KEY_ID=cli-canary-id\nHF_API_KEY_SECRET=cli-canary-higgs-secret\nOPENROUTER_API_KEY=cli-canary-router-secret\n');
  const executable = fileURLToPath(new URL('./check-env.mjs', import.meta.url));
  const env = {...process.env};
  for (const key of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'FAL_KEY', 'ELEVENLABS_API_KEY', 'HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'HF_CREDENTIALS', 'HF_KEY']) delete env[key];
  const invoke = providers => spawnSync(process.execPath, [executable, '--repo', dir, '--providers', providers], {env, encoding: 'utf8', shell: false, windowsHide: true, timeout: 10000});
  const ready = invoke('google');
  assert.equal(ready.status, 0);
  assert.equal(JSON.parse(ready.stdout).ready, true);
  assert.equal((ready.stdout + ready.stderr).includes('cli-canary-secret'), false);
  assert.equal(invoke('fal').status, 2);
  assert.equal(invoke('not-a-provider').status, 1);
  const higgsReady = invoke('higgsfield');
  assert.equal(higgsReady.status, 0);
  assert.equal(JSON.parse(higgsReady.stdout).ready, true);
  assert.equal((higgsReady.stdout + higgsReady.stderr).includes('cli-canary'), false);
  const routerReady = invoke('openrouter');
  assert.equal(routerReady.status, 0);
  assert.equal(JSON.parse(routerReady.stdout).checks[0].selectedKey, 'OPENROUTER_API_KEY');
  assert.equal((routerReady.stdout + routerReady.stderr).includes('cli-canary'), false);
  writeFileSync(path.join(dir, '.env'), 'HF_API_KEY_ID=cli-canary-id\n');
  assert.equal(invoke('higgsfield').status, 2);
  assert.equal(invoke('openrouter').status, 2);
});

test('OpenRouter stays separate from direct provider keys and honors inherited precedence', t => {
  const content = 'OPENAI_API_KEY=direct-canary\nGEMINI_API_KEY=google-canary\n';
  const dir = fixture(t, content);
  assert.equal(inspectCredentials(dir, ['openrouter'], {}).ready, false);
  const routerContent = 'OPENROUTER_API_KEY="router-canary#quoted"\n';
  writeFileSync(path.join(dir, '.env'), routerContent);
  const report = inspectCredentials(dir, ['openrouter', 'openrouter'], {});
  assert.equal(report.ready, true);
  assert.equal(report.authenticated, false);
  assert.equal(report.checks.length, 1);
  assert.deepEqual(report.checks[0], {
    provider: 'openrouter', acceptedKeys: ['OPENROUTER_API_KEY'],
    selectedKey: 'OPENROUTER_API_KEY', present: true,
  });
  assert.equal(JSON.stringify(report).includes('canary'), false);
  assert.equal(inspectCredentials(dir, ['openai'], {}).ready, false);
  assert.equal(inspectCredentials(dir, ['google'], {}).ready, false);
  assert.equal(inspectCredentials(dir, ['openrouter', 'elevenlabs'], {}).ready, false);
  const inherited = {OPENROUTER_API_KEY: ''};
  assert.equal(inspectCredentials(dir, ['openrouter'], inherited).ready, false);
  assert.deepEqual(inherited, {OPENROUTER_API_KEY: ''});
  assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), routerContent);
});

test('OpenRouter key is also found in .env.local, which wins over .env; other keys are not', t => {
  const dir = fixture(t, 'OPENROUTER_API_KEY=\n');
  writeFileSync(path.join(dir, '.env.local'), 'OPENROUTER_API_KEY=local-canary\nOPENAI_API_KEY=local-direct-canary\n');
  const report = inspectCredentials(dir, ['openrouter'], {});
  assert.equal(report.ready, true);
  assert.equal(report.envLocalFileExists, true);
  assert.equal(JSON.stringify(report).includes('canary'), false);
  assert.equal(inspectCredentials(dir, ['openai'], {}).ready, false);
  assert.equal(inspectCredentials(dir, ['openrouter'], {OPENROUTER_API_KEY: ''}).ready, false);
  writeFileSync(path.join(dir, '.env'), 'OPENROUTER_API_KEY=env-canary\n');
  writeFileSync(path.join(dir, '.env.local'), 'OPENROUTER_API_KEY=\n');
  assert.equal(inspectCredentials(dir, ['openrouter'], {}).ready, true);
  rmSync(path.join(dir, '.env.local'));
  mkdirSync(path.join(dir, '.env.local'));
  assert.throws(() => inspectCredentials(dir, ['openrouter'], {}), /^Error: Cannot read or parse the repo .env.local; inspect it privately$/);
  assert.equal(inspectCredentials(dir, ['google'], {GEMINI_API_KEY: 'x'}).ready, true);
});

test('Higgsfield requires both separate credential parts and never emits either', t => {
  const dir = fixture(t, 'HF_API_KEY_ID=canary-id\n');
  assert.equal(inspectCredentials(dir, ['higgsfield'], {}).ready, false);
  writeFileSync(path.join(dir, '.env'), 'HF_API_KEY_SECRET=canary-secret\n');
  assert.equal(inspectCredentials(dir, ['higgsfield'], {}).ready, false);
  const result = inspectCredentials(dir, ['higgsfield'], {HF_API_KEY_ID: 'canary-id'});
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks[0].selectedKeys, ['HF_API_KEY_ID', 'HF_API_KEY_SECRET']);
  assert.equal(JSON.stringify(result).includes('canary'), false);
});

test('Higgsfield accepts complete combined aliases and rejects malformed credentials', t => {
  const dir = fixture(t);
  for (const key of ['HF_CREDENTIALS', 'HF_KEY']) {
    const good = inspectCredentials(dir, ['higgsfield'], {[key]: 'canary-id:canary-secret'});
    assert.equal(good.ready, true);
    assert.deepEqual(good.checks[0].selectedKeys, [key]);
    assert.equal(JSON.stringify(good).includes('canary'), false);
    for (const invalid of ['', 'id-only', ':secret', 'id:', 'id:secret:extra', 'id:sec ret', 'id:secret\n']) {
      assert.equal(inspectCredentials(dir, ['higgsfield'], {[key]: invalid}).ready, false);
    }
  }
});

test('Higgsfield selection honors complete pair then combined alias precedence', t => {
  const dir = fixture(t, 'HF_API_KEY_ID=pair-id\nHF_API_KEY_SECRET=pair-secret\nHF_CREDENTIALS=combined-id:combined-secret\nHF_KEY=alias-id:alias-secret\n');
  assert.deepEqual(inspectCredentials(dir, ['higgsfield'], {}).checks[0].selectedKeys, ['HF_API_KEY_ID', 'HF_API_KEY_SECRET']);
  const inherited = {HF_API_KEY_SECRET: '', HF_CREDENTIALS: ''};
  assert.deepEqual(inspectCredentials(dir, ['higgsfield'], inherited).checks[0].selectedKeys, ['HF_KEY']);
  assert.deepEqual(inspectCredentials(dir, ['higgsfield'], {HF_API_KEY_SECRET: ''}).checks[0].selectedKeys, ['HF_CREDENTIALS']);
  assert.deepEqual(inherited, {HF_API_KEY_SECRET: '', HF_CREDENTIALS: ''});
  assert.equal(inspectCredentials(dir, ['higgsfield', 'google'], {}).ready, false);
});
