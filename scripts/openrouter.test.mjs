import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {main, ledger, capabilityProblems, redact, scrubUrls, isPublicAddress, getPublic} from './openrouter.mjs';

const KEY = 'sk-or-v1-TESTSECRET';
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24, 1)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(32, 2)]);
const VIDEO_MODEL = {id: 'bytedance/seedance-2.5', supported_durations: [5, 10], supported_resolutions: ['720p'],
  supported_aspect_ratios: ['16:9'], supported_frame_images: ['first_frame', 'last_frame']};

async function project() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'openrouter-test-'));
  await writeFile(path.join(dir, 'still.png'), PNG);
  await writeFile(path.join(dir, 'motion.mp4'), MP4);
  return dir;
}

function fake(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({url, method: init.method ?? 'GET', auth: init.headers?.Authorization, body: init.body});
    const handler = routes[`${init.method ?? 'GET'} ${url.replace('https://openrouter.ai/api/v1/', '')}`] ?? routes[url];
    if (!handler) throw new Error(`unexpected ${init.method ?? 'GET'} ${url}`);
    const out = typeof handler === 'function' ? handler(init) : handler;
    if (out instanceof Error) throw out;
    if (Buffer.isBuffer(out)) return new Response(out, {status: 200});
    // {status, json} is an HTTP envelope; any other object is a 200 JSON body.
    if ('json' in out) return new Response(JSON.stringify(out.json), {status: out.status ?? 200});
    return new Response(JSON.stringify(out), {status: 200});
  };
  let clock = 1_700_000_000_000;
  return {calls, deps: {fetch, sleep: async () => {}, now: () => (clock += 1000), env: {OPENROUTER_API_KEY: KEY}, log: () => {}}};
}

async function request(dir, kind, body, extra = {}) {
  const file = path.join(dir, `${kind}-request.json`);
  await writeFile(file, JSON.stringify({kind, shot: 's01', body, ...extra}));
  return file;
}

const videoBody = {model: 'bytedance/seedance-2.5', prompt: 'One continuous shot.', duration: 5, resolution: '720p',
  aspect_ratio: '16:9', input_references: [{type: 'image_url', image_url: {url: 'local:still.png'}, role: 'identity'}]};
const catalogRoutes = {'GET videos/models': {data: [VIDEO_MODEL]}, 'GET credits': {data: {total_credits: 10, total_usage: 1}}};

test('dry run validates without POST or attempt records', async () => {
  const dir = await project();
  const {calls, deps} = fake(catalogRoutes);
  const req = await request(dir, 'video', videoBody);
  const result = await main(['submit', '--request', req, '--dir', path.join(dir, 'provider'), '--attempt', 'v01',
    '--estimate-usd', '1.3', '--ceiling-usd', '3', '--repo', dir], deps);
  assert.equal(result.dryRun, true);
  assert.ok(calls.every(c => c.method === 'GET'));
  assert.equal(existsSync(path.join(dir, 'provider')), false);
});

test('key comes from the environment, then .env.local, then .env', async () => {
  const dir = await project();
  await writeFile(path.join(dir, '.env'), 'OPENROUTER_API_KEY=sk-or-v1-FROMDOTENV\n');
  await writeFile(path.join(dir, '.env.local'), 'OPENROUTER_API_KEY=sk-or-v1-FROMLOCAL\n');
  const {calls, deps} = fake(catalogRoutes);
  await main(['credits', '--repo', dir], deps);
  await main(['credits', '--repo', dir], {...deps, env: {}});
  await writeFile(path.join(dir, '.env.local'), 'OPENROUTER_API_KEY=\n');
  await main(['credits', '--repo', dir], {...deps, env: {}});
  assert.deepEqual(calls.map(c => c.auth), [`Bearer ${KEY}`, 'Bearer sk-or-v1-FROMLOCAL', 'Bearer sk-or-v1-FROMDOTENV']);
});

test('budget and capability problems refuse before any POST', async () => {
  const dir = await project();
  const provider = path.join(dir, 'provider');
  await (await import('node:fs/promises')).mkdir(provider);
  await writeFile(path.join(provider, 'attempt-old.json'), JSON.stringify({id: 'old', kind: 'video', actualUSD: 2.5}));
  const {calls, deps} = fake(catalogRoutes);
  const req = await request(dir, 'video', {...videoBody, duration: 7});
  await assert.rejects(main(['submit', '--request', req, '--dir', provider, '--attempt', 'v02', '--estimate-usd', '1',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps), /budget.*duration=7/s);
  assert.ok(calls.every(c => c.method === 'GET'));
});

test('video job id is saved, polled, downloaded and never resubmitted', async () => {
  const dir = await project();
  const provider = path.join(dir, 'provider');
  let polls = 0;
  const {calls, deps} = fake({...catalogRoutes,
    'POST videos': {status: 202, json: {id: 'gen-vid-1-abcdefghijklmnopqrst', status: 'pending'}},
    'GET videos/gen-vid-1-abcdefghijklmnopqrst': () => ({id: 'x', status: ++polls < 2 ? 'in_progress' : 'completed', usage: {cost: 1.21}}),
    'GET videos/gen-vid-1-abcdefghijklmnopqrst/content?index=0': MP4});
  const req = await request(dir, 'video', videoBody);
  const a = await main(['submit', '--request', req, '--dir', provider, '--attempt', 'v03', '--estimate-usd', '1.3',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps);
  assert.equal(a.state, 'succeeded');
  assert.equal(a.actualUSD, 1.21);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
  const sent = JSON.parse(calls.find(c => c.method === 'POST').body);
  assert.match(sent.input_references[0].image_url.url, /^data:image\/png;base64,/);
  assert.equal(sent.input_references[0].role, undefined);
  const saved = JSON.parse(await readFile(path.join(provider, 'attempt-v03.json'), 'utf8'));
  assert.equal(saved.providerId, 'gen-vid-1-abcdefghijklmnopqrst');
  assert.equal(saved.inputs[0].role, 'identity');
  assert.ok(!JSON.stringify(saved).includes('base64,'));
  assert.deepEqual(await readFile(path.join(provider, 'v03', 'original.mp4')), MP4);
  // A second submit with the same attempt id cannot create another paid job.
  await assert.rejects(main(['submit', '--request', req, '--dir', provider, '--attempt', 'v03', '--estimate-usd', '0.1',
    '--ceiling-usd', '9', '--submit', '--repo', dir], deps), /EEXIST/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('ambiguous network failure is unknown, stays reserved and cannot resume without a job id', async () => {
  const dir = await project();
  const provider = path.join(dir, 'provider');
  const {calls, deps} = fake({...catalogRoutes, 'POST videos': new TypeError('fetch failed')});
  const req = await request(dir, 'video', videoBody);
  await assert.rejects(main(['submit', '--request', req, '--dir', provider, '--attempt', 'v04', '--estimate-usd', '1.3',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps), /unknown/);
  const book = await ledger([provider]);
  assert.equal(book.accountedUSD, 1.3);
  await assert.rejects(main(['resume', '--dir', provider, '--attempt', 'v04', '--repo', dir], deps), /unknown; nothing to resume/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 1);
});

test('HTTP rejection is failed, zero-cost and redacted', async () => {
  const dir = await project();
  const provider = path.join(dir, 'provider');
  const {deps} = fake({...catalogRoutes, 'POST videos': {status: 400, json: {error: {code: 400,
    message: `bad input data:image/png;base64,AAAA Bearer ${KEY}`, metadata: {raw: 'pixel count must be at least 407696'}}}}});
  const req = await request(dir, 'video', videoBody);
  await assert.rejects(main(['submit', '--request', req, '--dir', provider, '--attempt', 'v05', '--estimate-usd', '1.3',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps), /failed/);
  const saved = await readFile(path.join(provider, 'attempt-v05.json'), 'utf8');
  assert.ok(!saved.includes(KEY) && !saved.includes('AAAA'));
  assert.match(saved, /407696/);
  assert.equal(JSON.parse(saved).actualUSD, 0);
});

test('local video and mismatched public references are rejected before POST', async () => {
  const dir = await project();
  const {calls, deps} = fake(catalogRoutes);
  deps.getPublic = async url => (url === 'https://media.example/motion.mp4' ? Buffer.from('different') : null);
  const local = await request(dir, 'video', {...videoBody, input_references: [{type: 'video_url', video_url: {url: 'local:motion.mp4'}}]});
  await assert.rejects(main(['submit', '--request', local, '--dir', dir, '--attempt', 'v06', '--estimate-usd', '1',
    '--ceiling-usd', '3', '--repo', dir], deps), /public HTTPS URL/);
  const remote = await request(dir, 'video', {...videoBody, input_references: [{type: 'video_url',
    video_url: {url: 'https://media.example/motion.mp4'}, verify_local: 'motion.mp4'}]});
  await assert.rejects(main(['submit', '--request', remote, '--dir', dir, '--attempt', 'v07', '--estimate-usd', '1',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps), /do not match/);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('public references refuse private, local and reserved addresses before any request', async () => {
  for (const ip of ['93.184.215.14', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(ip), true, ip);
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '::', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const url of ['https://127.0.0.1/m.mp4', 'https://2130706433/m.mp4', 'https://[::1]/m.mp4', 'https://localhost:9/m.mp4']) {
    await assert.rejects(getPublic(url, 10), {code: 'ENONPUBLIC'}, url);
  }
  const dir = await project();
  const {calls, deps} = fake(catalogRoutes);
  let sleeps = 0;
  deps.sleep = async () => { sleeps++; };
  const req = await request(dir, 'video', {...videoBody, input_references: [{type: 'video_url',
    video_url: {url: 'https://192.168.1.20/motion.mp4'}, verify_local: 'motion.mp4'}]});
  await assert.rejects(main(['submit', '--request', req, '--dir', dir, '--attempt', 'v08', '--estimate-usd', '1',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps), /192\.168\.1\.20 is not a public address/);
  assert.equal(sleeps, 0);
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});

test('signed links and provider errors are scrubbed from records and logs, not from the request', async () => {
  assert.equal(scrubUrls('a https://u:pw@cdn.example/m.mp4?X-Amz-Signature=S#t b https://x.example/p'),
    'a https://cdn.example/m.mp4?[redacted] b https://x.example/p');
  const dir = await project();
  const provider = path.join(dir, 'provider');
  const signed = 'https://cdn.example/motion.mp4?X-Amz-Signature=SIGSECRET';
  const job = 'gen-vid-2-abcdefghijklmnopqrst';
  const {calls, deps} = fake({...catalogRoutes,
    'POST videos': {status: 202, json: {id: job, status: 'pending'}},
    [`GET videos/${job}`]: {id: job, status: 'failed', error: {message: `cannot fetch ${signed}`, detail: {url: signed}}}});
  const logs = [];
  deps.log = line => logs.push(line);
  const req = await request(dir, 'video', {...videoBody, input_references: [{type: 'video_url', video_url: {url: signed},
    role: `motion from ${signed}`}]}, {shot: `s01 ${signed}`, notes: `hosted at ${signed} until tomorrow`});
  const args = ['submit', '--request', req, '--dir', provider, '--attempt', 'v09', '--estimate-usd', '1.3', '--ceiling-usd', '3', '--repo', dir];
  await main(args, deps);
  const a = await main([...args, '--submit'], deps);
  assert.equal(a.state, 'failed');
  const saved = await readFile(path.join(provider, 'attempt-v09.json'), 'utf8');
  assert.ok(!saved.includes('SIGSECRET') && !logs.join('\n').includes('SIGSECRET'));
  assert.match(saved, /cdn\.example\/motion\.mp4\?\[redacted\]/);
  assert.equal(JSON.parse(calls.find(c => c.method === 'POST').body).input_references[0].video_url.url, signed);
});

test('image attempt persists returned bytes by magic number', async () => {
  const dir = await project();
  const provider = path.join(dir, 'provider');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const {deps} = fake({'GET images/models/openai/gpt-image-2.5-flare/endpoints': {data: {endpoints: [
    {provider_tag: 'openai', supported_parameters: {quality: {values: ['low', 'medium', 'high']}}}]}},
  'GET credits': {status: 401, json: {error: {message: 'Management key required'}}},
  'POST images': {json: {id: 'img-1', data: [{b64_json: jpeg.toString('base64'), media_type: 'image/png'}], usage: {cost: 0.04}}}});
  const req = await request(dir, 'image', {model: 'openai/gpt-image-2.5-flare', prompt: 'Finish the frame.', quality: 'medium',
    provider: {only: ['openai'], allow_fallbacks: false}, input_references: [{type: 'image_url', image_url: {url: 'local:still.png'}}]});
  const a = await main(['submit', '--request', req, '--dir', provider, '--attempt', 'i01', '--estimate-usd', '0.16',
    '--ceiling-usd', '3', '--submit', '--repo', dir], deps);
  assert.equal(a.state, 'succeeded');
  assert.equal(a.outputs[0].detectedMime, 'image/jpeg');
  assert.equal(a.outputs[0].mimeMismatch, true);
  assert.ok((await readdir(path.join(provider, 'i01'))).includes('original.jpg'));
});

test('capability checks cover frame types, mixed modes and video provider fields', () => {
  const problems = capabilityProblems('video', {model: VIDEO_MODEL.id, frame_images: [{frame_type: 'middle'}],
    input_references: [{}], provider: {only: ['x']}}, {data: [VIDEO_MODEL]});
  assert.equal(problems.length, 3);
  assert.equal(redact(`key ${KEY} data:video/mp4;base64,ZZ`, KEY), 'key [redacted] [media]');
});
