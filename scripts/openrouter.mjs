// OpenRouter Images/Videos client for film production.
// Discovery, budgeted exclusive attempts and recoverable video jobs.
// `submit` is a dry run unless --submit is given; `resume` never creates a job.
import {open, readFile, readdir, writeFile, mkdir, copyFile, stat} from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {lookup} from 'node:dns';
import https from 'node:https';
import {BlockList, isIP} from 'node:net';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {persistImage} from './persist-image.mjs';

export const API = 'https://openrouter.ai/api/v1';
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const JOB = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_JSON = 48 * 1024 * 1024;
const MAX_VIDEO = 512 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

// Signed links carry their access token in the query, fragment or user info; records and logs keep only origin and path.
export function scrubUrls(text) {
  return String(text).replace(/\b(https?:\/\/)[^\s"'<>\\/?#@]+@/gi, '$1')
    .replace(/\b(https?:\/\/[^\s"'<>\\?#]*)[?#][^\s"'<>\\]*/gi, '$1?[redacted]');
}

export function redact(value, key) {
  let text = scrubUrls(String(value ?? '').slice(0, 4000).replace(/data:[^\s"']+/g, '[media]'))
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/sk-or-[A-Za-z0-9_-]+/g, '[redacted]');
  if (key) text = text.split(key).join('[redacted]');
  return text;
}

// Provider error objects are saved with every string redacted, keeping their shape.
const redactDeep = (value, key) => JSON.parse(JSON.stringify(value ?? null, (k, v) => typeof v === 'string' ? redact(v, key) : v));

// Environment first, then the repo's .env.local (which wins over .env, as in common dotenv tooling), then .env.
function loadKey(env, repo) {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  for (const name of ['.env.local', '.env']) {
    const file = path.join(repo, name);
    if (!existsSync(file)) continue;
    try {
      const key = parseEnv(readFileSync(file, 'utf8')).OPENROUTER_API_KEY;
      if (key) return key;
    } catch { /* unreadable: try the next file */ }
  }
  return null;
}

async function bounded(response, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > limit) throw new Error(`Response exceeded ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function makeApi(deps, key) {
  return async function api(route, {body, timeoutMs = 60000, raw = false} = {}) {
    if (!/^[a-z][a-z0-9/_.?=&-]*$/i.test(route) || route.includes('..')) throw new Error('Unsafe API route');
    const headers = {'Content-Type': 'application/json'};
    if (key) headers.Authorization = `Bearer ${key}`;
    const response = await deps.fetch(`${API}/${route}`, {method: body ? 'POST' : 'GET', headers,
      body: body ? JSON.stringify(body) : undefined, redirect: raw ? 'manual' : 'error',
      signal: AbortSignal.timeout(timeoutMs)});
    if (raw) return response;
    const bytes = await bounded(response, MAX_JSON);
    let json = null;
    try { json = JSON.parse(bytes.toString('utf8')); } catch { /* non-JSON */ }
    if (!response.ok) {
      const error = new Error(`OpenRouter HTTP ${response.status}`);
      error.httpStatus = response.status;
      error.diagnostic = {status: response.status, code: json?.error?.code ?? null,
        message: redact(json?.error?.message ?? (json ? '' : 'non-JSON response'), key),
        upstream: redact(json?.error?.metadata?.raw ?? '', key) || null,
        retryAfter: response.headers?.get?.('retry-after') ?? null};
      throw error;
    }
    if (json === null) throw new Error('OpenRouter returned non-JSON success');
    return json;
  };
}

// --- Media references ------------------------------------------------------------

function imageMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function mediaSlots(node, trail = 'body', out = []) {
  if (Array.isArray(node)) node.forEach((item, i) => mediaSlots(item, `${trail}[${i}]`, out));
  else if (node && typeof node === 'object') {
    for (const kind of ['image_url', 'video_url', 'audio_url']) {
      if (node[kind] && typeof node[kind] === 'object' && 'url' in node[kind]) out.push({holder: node, kind, trail});
    }
    for (const [k, v] of Object.entries(node)) if (typeof v === 'object') mediaSlots(v, `${trail}.${k}`, out);
  }
  return out;
}

// A "public" reference must not reach loopback, private, link-local, shared, documentation, multicast or
// reserved ranges. IPv4-mapped IPv6 addresses are checked against the IPv4 list by BlockList itself.
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 96], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) NON_PUBLIC.addSubnet(net, prefix, 'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  return family !== 0 && !NON_PUBLIC.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

const nonPublic = what => Object.assign(new Error(`${what} is not a public address`), {code: 'ENONPUBLIC'});

// Runs as the socket's resolver, so the checked address is the one connected to (no DNS rebinding window).
function publicLookup(hostname, options, callback) {
  lookup(hostname, {...options, all: true}, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) return callback(nonPublic(hostname));
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

// HTTPS GET without redirects, bounded in size, refusing non-public hosts. IP literals skip the resolver,
// so they are checked here.
export function getPublic(url, limit) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) return Promise.reject(nonPublic(host));
  return new Promise((resolve, reject) => {
    const request = https.get(url, {lookup: publicLookup, signal: AbortSignal.timeout(30000)}, response => {
      if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); return reject(new Error(`HTTP ${response.statusCode}`)); }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > limit) request.destroy(new Error(`Response exceeded ${limit} bytes`));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function fetchPublic(deps, url, limit) {
  let last;
  for (let i = 0; i < 18; i++) {
    try {
      return await deps.getPublic(url, limit);
    } catch (error) {
      if (error.code === 'ENONPUBLIC') throw new Error(`${error.message}: references must be public HTTPS URLs; no paid request sent`);
      last = error; await deps.sleep(5000);
    }
  }
  throw new Error(`Public reference not reachable (${last?.message}); no paid request sent. ` +
    'On Windows, download it with Invoke-WebRequest and pass "probe_file".');
}

// Converts local: images to data URLs, verifies public references, strips our
// annotation fields (role, verify_local, probe_file) and returns input records.
export async function resolveMedia(body, baseDir, deps, {maxImageBytes = 20 * 1024 * 1024} = {}) {
  const inputs = [];
  for (const {holder, kind, trail} of mediaSlots(body)) {
    const {role = null, verify_local: verifyLocal, probe_file: probeFile} = holder;
    delete holder.role; delete holder.verify_local; delete holder.probe_file;
    const url = String(holder[kind].url);
    const record = {field: trail, kind, role};
    if (url.startsWith('local:')) {
      if (kind !== 'image_url') throw new Error(`${trail}: ${kind} needs an approved public HTTPS URL, not a local file`);
      const file = path.resolve(baseDir, url.slice(6));
      const bytes = await readFile(file);
      const mime = imageMime(bytes);
      if (!mime || bytes.length > maxImageBytes) throw new Error(`${trail}: ${file} is not a PNG/JPEG/WebP within ${maxImageBytes} bytes`);
      holder[kind].url = `data:${mime};base64,${bytes.toString('base64')}`;
      Object.assign(record, {source: path.relative(baseDir, file), mime, bytes: bytes.length, sha256: sha256(bytes)});
    } else if (url.startsWith('data:')) {
      Object.assign(record, {source: 'inline data URL', bytes: url.length});
    } else if (url.startsWith('https://')) {
      record.source = scrubUrls(url);
      if (verifyLocal) {
        const local = await readFile(path.resolve(baseDir, verifyLocal));
        let remote;
        if (probeFile) {
          const probePath = path.resolve(baseDir, probeFile);
          if (Date.now() - (await stat(probePath)).mtimeMs > 10 * 60 * 1000) throw new Error(`${trail}: probe_file is older than 10 minutes`);
          remote = await readFile(probePath);
        } else remote = await fetchPublic(deps, url, local.length + 1);
        if (sha256(remote) !== sha256(local)) throw new Error(`${trail}: public bytes do not match ${verifyLocal}`);
        Object.assign(record, {localFile: verifyLocal, bytes: local.length, sha256: sha256(local), publicHashVerified: true});
      } else record.publicHashVerified = false;
    } else throw new Error(`${trail}: use local:, data: or https:// URLs`);
    inputs.push(record);
  }
  return inputs;
}

// --- Capabilities and budget ------------------------------------------------------

export function capabilityProblems(kind, body, catalog) {
  const problems = [];
  if (kind === 'video') {
    const model = catalog?.data?.find(m => m.id === body.model);
    if (!model) return [`${body.model} is not in /videos/models`];
    for (const [field, list] of [['duration', 'supported_durations'], ['resolution', 'supported_resolutions'],
      ['aspect_ratio', 'supported_aspect_ratios'], ['size', 'supported_sizes']]) {
      if (body[field] != null && Array.isArray(model[list]) && !model[list].includes(body[field])) {
        problems.push(`${field}=${body[field]} not in ${list} ${JSON.stringify(model[list])}`);
      }
    }
    for (const frame of body.frame_images ?? []) {
      if (Array.isArray(model.supported_frame_images) && !model.supported_frame_images.includes(frame.frame_type)) {
        problems.push(`frame_type=${frame.frame_type} not in supported_frame_images ${JSON.stringify(model.supported_frame_images)}`);
      }
    }
    if (body.provider && Object.keys(body.provider).some(k => k !== 'options')) {
      problems.push('video provider object documents only "options"');
    }
    if (body.frame_images?.length && body.input_references?.length) {
      problems.push('frame_images and input_references together: frame_images take precedence, references would be ignored');
    }
  } else {
    let endpoints = catalog?.data?.endpoints ?? catalog?.endpoints ?? [];
    if (body.provider?.only) endpoints = endpoints.filter(e => body.provider.only.includes(e.provider_tag));
    if (!endpoints.length) return [`no endpoint for ${body.model}${body.provider?.only ? ' with provider.only' : ''}`];
    for (const field of ['quality', 'resolution', 'aspect_ratio']) {
      if (body[field] == null) continue;
      const ok = endpoints.some(e => {
        const spec = e.supported_parameters?.[field];
        if (spec === undefined) return Array.isArray(e.supported_parameters) ? e.supported_parameters.includes(field) : false;
        return !Array.isArray(spec?.values) || spec.values.includes(body[field]);
      });
      if (!ok) problems.push(`${field}=${body[field]} not supported by the selected endpoint(s)`);
    }
  }
  return problems;
}

export async function ledger(dirs) {
  let accounted = 0, actual = 0;
  const rows = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of (await readdir(dir)).filter(n => /^attempt-.*\.json$/.test(n) || /\.attempt\.json$/.test(n))) {
      const a = JSON.parse((await readFile(path.join(dir, name), 'utf8')).replace(/^﻿/, ''));
      const cost = a.actualUSD ?? a.reservedUSD ?? a.estimatedUSD;
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) throw new Error(`Unresolved cost in ${path.join(dir, name)}`);
      accounted += cost;
      actual += a.actualUSD ?? 0;
      rows.push({file: path.join(dir, name), id: a.id, kind: a.kind ?? a.stage, shot: a.shot ?? null, state: a.state,
        actualUSD: a.actualUSD ?? null, accountedUSD: cost});
    }
  }
  return {accountedUSD: +accounted.toFixed(7), actualUSD: +actual.toFixed(7), attempts: rows};
}

// --- Attempts -------------------------------------------------------------------

const attemptFile = (dir, id) => path.join(dir, `attempt-${id}.json`);

// Every string of a saved record or printed summary (notes, roles, labels, future fields) loses link tokens;
// only the provider request itself carries full links.
const recordJson = value => JSON.stringify(value, (k, v) => typeof v === 'string' ? scrubUrls(v) : v, 2);

async function claim(file, record) {
  const handle = await open(file, 'wx');
  try { await handle.writeFile(recordJson(record)); await handle.sync(); } finally { await handle.close(); }
}

function stateFor(status) {
  if (status === 'completed') return 'succeeded';
  if (['pending', 'in_progress', 'queued', 'processing'].includes(status)) return 'running';
  if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) return 'failed';
  return 'unknown';
}

async function downloadVideo(deps, api, a, dir, allowHosts) {
  let response = await api(`videos/${a.providerId}/content?index=0`, {raw: true, timeoutMs: 300000});
  if (response.status >= 300 && response.status < 400) {
    const target = new URL(response.headers.get('location'), API);
    if (target.protocol !== 'https:' || !allowHosts.includes(target.hostname)) {
      throw new Error(`Content redirected to ${target.hostname}; rerun resume with --allow-download-host ${target.hostname} if it is the documented storage host`);
    }
    response = await deps.fetch(target.href, {redirect: 'error', signal: AbortSignal.timeout(300000)});
  }
  if (response.status === 409) throw new Error('Content not ready (HTTP 409); run resume again later');
  if (!response.ok) throw new Error(`Content download HTTP ${response.status}`);
  const bytes = await bounded(response, MAX_VIDEO);
  const folder = path.join(dir, a.id);
  await mkdir(folder, {recursive: true});
  const original = path.join(folder, 'original.bin');
  await writeFile(original, bytes, {flag: 'wx'});
  const output = {original: path.relative(dir, original), bytes: bytes.length, sha256: sha256(bytes), state: 'stored_unvalidated'};
  if (bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    await copyFile(original, path.join(folder, 'original.mp4'), constants.COPYFILE_EXCL);
    output.file = path.relative(dir, path.join(folder, 'original.mp4'));
  } else output.warning = 'Not an ISO-BMFF/MP4 header; original preserved as .bin';
  return output;
}

async function poll(deps, api, a, save, dir, {waitMinutes, allowHosts}) {
  if (!JOB.test(a.providerId ?? '')) throw new Error('Attempt has no valid job id; reconcile on OpenRouter before any new submission');
  const deadline = deps.now() + waitMinutes * 60000;
  let delay = 10000;
  while (a.state === 'running' && deps.now() < deadline) {
    try {
      const r = await api(`videos/${a.providerId}`);
      Object.assign(a, {status: r.status, state: stateFor(r.status), lastPoll: new Date(deps.now()).toISOString(),
        generationId: r.generation_id ?? a.generationId ?? null, returnedModel: r.model ?? a.returnedModel ?? null,
        usage: r.usage ?? a.usage ?? null, providerError: redactDeep(r.error)});
      if (typeof r.usage?.cost === 'number') a.actualUSD = r.usage.cost;
      else if (a.state === 'failed' && a.actualUSD == null) {
        a.actualUSD = 0;
        a.costBasis = `job ${r.status}; failed video jobs are documented as unbilled - confirm in account activity`;
      }
      a.polls = (a.polls ?? 0) + 1;
      await save();
      deps.log(JSON.stringify({state: a.state, status: a.status, actualUSD: a.actualUSD ?? null}));
    } catch (error) {
      a.lastPollError = error.diagnostic ?? redact(error.message);
      await save();
    }
    if (a.state === 'running') { await deps.sleep(delay); delay = Math.min(30000, delay * 1.5); }
  }
  if (a.state === 'succeeded' && !a.output) {
    a.output = await downloadVideo(deps, api, a, dir, allowHosts);
    await save();
  }
  return a;
}

// --- Commands --------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const o = {command, dirs: [], ledgerDirs: [], allowHosts: [], waitMinutes: 20, submit: false, wait: true, checkCaps: true};
  const valued = {'--kind': 'kind', '--model': 'model', '--out': 'out', '--request': 'request', '--dir': 'dir',
    '--attempt': 'attempt', '--estimate-usd': 'estimateUSD', '--ceiling-usd': 'ceilingUSD', '--max-attempts': 'maxAttempts',
    '--wait-minutes': 'waitMinutes', '--repo': 'repo'};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--submit') { o.submit = true; continue; }
    if (flag === '--no-wait') { o.wait = false; continue; }
    if (flag === '--skip-capability-check') { o.checkCaps = false; continue; }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    i++;
    if (flag === '--ledger-dir') o.ledgerDirs.push(value);
    else if (flag === '--allow-download-host') o.allowHosts.push(value);
    else if (valued[flag]) o[valued[flag]] = ['estimateUSD', 'ceilingUSD', 'maxAttempts', 'waitMinutes'].includes(valued[flag]) ? Number(value) : value;
    else throw new Error(`Unknown flag ${flag}`);
  }
  if (o.dir) o.dirs.push(o.dir);
  return o;
}

async function submit(o, deps, api, key) {
  for (const [flag, value] of [['--request', o.request], ['--dir', o.dir], ['--attempt', o.attempt]]) if (!value) throw new Error(`${flag} is required`);
  if (!ID.test(o.attempt)) throw new Error('Attempt id must be 1-80 letters, digits, _ or -');
  if (!(o.estimateUSD >= 0) || !(o.ceilingUSD > 0)) throw new Error('--estimate-usd and --ceiling-usd are required (USD)');
  const request = JSON.parse((await readFile(o.request, 'utf8')).replace(/^﻿/, ''));
  const kind = request.kind;
  if (!['image', 'video'].includes(kind) || !request.body?.model || !request.body?.prompt) throw new Error('Request needs kind (image|video) and body.model/body.prompt');
  const body = structuredClone(request.body);
  const inputs = await resolveMedia(body, path.dirname(path.resolve(o.request)), deps);
  const book = await ledger([o.dir, ...o.ledgerDirs]);
  const sameShot = book.attempts.filter(a => a.kind === kind && a.shot === (request.shot ?? null)).length;
  const problems = [];
  if (book.accountedUSD + o.estimateUSD > o.ceilingUSD) problems.push(`budget: accounted ${book.accountedUSD} + estimate ${o.estimateUSD} > ceiling ${o.ceilingUSD} USD`);
  if (o.maxAttempts != null && sameShot >= o.maxAttempts) problems.push(`attempt limit ${o.maxAttempts} reached for ${kind}/${request.shot ?? 'unlabelled'}`);
  if (o.checkCaps) {
    const route = kind === 'video' ? 'videos/models' : `images/models/${body.model}/endpoints`;
    problems.push(...capabilityProblems(kind, body, await api(route)));
  }
  let credits = null;
  try { const c = await api('credits'); credits = c.data.total_credits - c.data.total_usage; } catch { /* key may lack access */ }
  if (credits != null && credits < o.estimateUSD) problems.push(`account credit ${credits} < estimate ${o.estimateUSD}`);
  // The provider gets the full body; the saved and printed copy drops media payloads and link tokens.
  const parameters = JSON.parse(JSON.stringify(body, (k, v) => typeof v !== 'string' ? v : v.startsWith('data:') ? '[media]' : scrubUrls(v)));
  const summary = {attempt: o.attempt, kind, model: body.model, shot: request.shot ?? null, inputs, priorAccountedUSD: book.accountedUSD,
    estimateUSD: o.estimateUSD, ceilingUSD: o.ceilingUSD, creditsRemaining: credits, problems};
  if (problems.length || !o.submit) {
    deps.log(recordJson({dryRun: !o.submit, ...summary, parameters}));
    if (problems.length) throw new Error('Not submitted: ' + problems.join('; '));
    return {dryRun: true};
  }
  await mkdir(o.dir, {recursive: true});
  const file = attemptFile(o.dir, o.attempt);
  const a = {id: o.attempt, kind, shot: request.shot ?? null, created: new Date(deps.now()).toISOString(), state: 'submitting',
    model: body.model, parameters, inputs, estimatedUSD: o.estimateUSD, actualUSD: null, ceilingUSD: o.ceilingUSD,
    priorAccountedUSD: book.accountedUSD, notes: request.notes ?? null};
  await claim(file, a);
  const save = () => writeFile(file, recordJson(a));
  let response;
  try {
    response = await api(kind === 'video' ? 'videos' : 'images', {body, timeoutMs: kind === 'video' ? 120000 : 300000});
  } catch (error) {
    a.state = error.httpStatus ? 'failed' : 'unknown';
    a.diagnostic = error.diagnostic ?? {message: redact(error.message, key)};
    if (error.httpStatus) {
      // OpenRouter documents failed generations as unbilled; the estimate stays reserved otherwise.
      a.actualUSD = 0;
      a.costBasis = `HTTP ${error.httpStatus} rejection; documented as unbilled - confirm in account activity`;
    } else a.warning = 'Submission outcome unknown: check OpenRouter activity before any new paid attempt';
    await save();
    throw new Error(`${a.state}: ${JSON.stringify(a.diagnostic)}`);
  }
  if (typeof response.usage?.cost === 'number') a.actualUSD = response.usage.cost;
  a.usage = response.usage ?? null;
  if (kind === 'image') {
    a.state = 'provider_succeeded';
    a.providerId = response.id ?? null;
    await save();
    const images = response.data ?? [];
    a.outputs = [];
    for (const [i, item] of images.entries()) {
      if (typeof item.b64_json !== 'string') { a.outputs.push({index: i, warning: 'no b64_json', keys: Object.keys(item)}); continue; }
      a.outputs.push(await persistImage({b64Json: item.b64_json, outputRoot: o.dir,
        attemptId: images.length > 1 ? `${o.attempt}-${i + 1}` : o.attempt, declaredMime: item.media_type ?? null}));
    }
    a.state = a.outputs.some(x => x.sha256) ? 'succeeded' : 'provider_succeeded';
    await save();
    deps.log(JSON.stringify({state: a.state, actualUSD: a.actualUSD, outputs: a.outputs.map(x => x.originalPath ?? x.warning)}));
    return a;
  }
  a.providerId = response.id;
  a.status = response.status ?? null;
  a.generationId = response.generation_id ?? null;
  a.state = JOB.test(a.providerId ?? '') ? 'running' : 'unknown';
  await save();
  deps.log(JSON.stringify({state: a.state, jobId: a.providerId}));
  if (a.state === 'running' && o.wait) await poll(deps, api, a, save, o.dir, o);
  return a;
}

export async function main(argv, deps = {}) {
  deps = {fetch: globalThis.fetch, getPublic, sleep: ms => new Promise(r => setTimeout(r, ms)), now: Date.now,
    env: process.env, log: console.log, ...deps};
  const o = parseArgs(argv);
  const key = loadKey(deps.env, o.repo ?? process.cwd());
  const api = makeApi(deps, key);
  if (o.command === 'catalog') {
    if (!['image', 'video'].includes(o.kind)) throw new Error('--kind image|video');
    const route = o.kind === 'video' ? 'videos/models' : (o.model ? `images/models/${o.model}/endpoints` : 'images/models');
    let result = await makeApi(deps, null)(route); // public catalogs: never send the key
    if (o.kind === 'video' && o.model) result = result.data?.find(m => m.id === o.model) ?? null;
    const text = JSON.stringify({checkedAt: new Date(deps.now()).toISOString(), route, result}, null, 2);
    if (o.out) await writeFile(o.out, text);
    deps.log(o.out ? `saved ${o.out}` : text);
    return result;
  }
  if (o.command === 'credits') {
    if (!key) throw new Error('OPENROUTER_API_KEY missing');
    let c;
    try { c = (await api('credits')).data; } catch (error) {
      throw new Error(`${error.message}: /credits requires a management key; check the balance on openrouter.ai instead`);
    }
    deps.log(JSON.stringify({totalCredits: c.total_credits, totalUsage: c.total_usage, remaining: c.total_credits - c.total_usage}));
    return c;
  }
  if (o.command === 'ledger') {
    const book = await ledger([...o.dirs, ...o.ledgerDirs]);
    deps.log(JSON.stringify(book, null, 2));
    return book;
  }
  if (!key) throw new Error('OPENROUTER_API_KEY missing from the environment, repo .env.local and .env');
  if (o.command === 'submit') return submit(o, deps, api, key);
  if (o.command === 'resume') {
    if (!o.dir || !ID.test(o.attempt ?? '')) throw new Error('--dir and a valid --attempt are required');
    const file = attemptFile(o.dir, o.attempt);
    const a = JSON.parse(await readFile(file, 'utf8'));
    if (a.kind !== 'video') throw new Error('Only video attempts can be resumed; image calls are synchronous');
    if (a.state === 'unknown' && JOB.test(a.providerId ?? '')) a.state = 'running';
    const save = () => writeFile(file, recordJson(a));
    if (!['running', 'succeeded'].includes(a.state)) throw new Error(`Attempt is ${a.state}; nothing to resume`);
    await poll(deps, api, a, save, o.dir, o);
    return a;
  }
  throw new Error('Commands: catalog, credits, ledger, submit, resume');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result => {
    if (result?.state === 'running') { console.error('Job still running: run resume later; do not resubmit.'); process.exitCode = 5; }
    else if (['failed', 'unknown', 'provider_succeeded'].includes(result?.state)) process.exitCode = 2;
  }).catch(error => { console.error(redact(error.message)); process.exitCode = 1; });
}
