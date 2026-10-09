// Only reports credential presence. Does not authenticate, upload, or call providers.
import {existsSync, readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const providerKeys = Object.freeze({
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  fal: ['FAL_KEY'],
  elevenlabs: ['ELEVENLABS_API_KEY'],
  higgsfield: ['HF_API_KEY_ID', 'HF_API_KEY_SECRET', 'HF_CREDENTIALS', 'HF_KEY'],
});

export function inspectCredentials(repo, providers, inherited = process.env) {
  if (!providers.length || providers.some(provider => !Object.hasOwn(providerKeys, provider))) {
    throw new Error('Select providers from: openai, openrouter, google, fal, elevenlabs, higgsfield');
  }
  const envPath = path.resolve(repo, '.env');
  const envFileExists = existsSync(envPath);
  let fileValues = {};
  if (envFileExists) {
    try {
      fileValues = parseEnv(readFileSync(envPath, 'utf8'));
    } catch {
      throw new Error('Cannot read or parse the repo .env; inspect it privately');
    }
  }
  // OPENROUTER_API_KEY may also sit in .env.local, which wins over .env (openrouter.mjs reads it the same way).
  const localPath = path.resolve(repo, '.env.local');
  const envLocalFileExists = existsSync(localPath);
  if (envLocalFileExists && providers.includes('openrouter')) {
    let localValues;
    try {
      localValues = parseEnv(readFileSync(localPath, 'utf8'));
    } catch {
      throw new Error('Cannot read or parse the repo .env.local; inspect it privately');
    }
    if (localValues.OPENROUTER_API_KEY) fileValues.OPENROUTER_API_KEY = localValues.OPENROUTER_API_KEY;
  }
  const values = {...fileValues};
  for (const keys of Object.values(providerKeys)) {
    for (const key of keys) {
      if (Object.hasOwn(inherited, key) && inherited[key] !== undefined) values[key] = inherited[key];
    }
  }
  const checks = [...new Set(providers)].map(provider => {
    const acceptedKeys = providerKeys[provider];
    if (provider === 'higgsfield') {
      const validPart = value => typeof value === 'string' && value.length > 0 && !/[:\s]/.test(value);
      const separateKeys = ['HF_API_KEY_ID', 'HF_API_KEY_SECRET'];
      const combinedKey = ['HF_CREDENTIALS', 'HF_KEY'].find(key => {
        if (typeof values[key] !== 'string') return false;
        const parts = values[key].split(':');
        return parts.length === 2 && parts.every(validPart);
      });
      const selectedKeys = separateKeys.every(key => validPart(values[key]))
        ? separateKeys : combinedKey ? [combinedKey] : [];
      return {provider, acceptedKeys, selectedKeys, present: selectedKeys.length > 0};
    }
    const selectedKey = acceptedKeys.find(key => typeof values[key] === 'string' && values[key].trim()) ?? null;
    return {provider, acceptedKeys, selectedKey, present: selectedKey !== null};
  });
  return {envFileExists, envLocalFileExists, checks, ready: checks.every(check => check.present), authenticated: false};
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('node check-env.mjs --repo PATH --providers openai,openrouter,google,fal,elevenlabs,higgsfield');
    return;
  }
  let repo = process.cwd();
  let providers = [];
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Each flag requires a value');
    if (flag === '--repo') repo = value;
    else if (flag === '--providers') providers = value.split(',').map(provider => provider.trim());
    else throw new Error('Supported flags: --repo, --providers, --help');
  }
  const report = inspectCredentials(repo, providers);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // All emitted errors are fixed messages above, never raw file/parser exceptions.
    console.error(error.message);
    process.exitCode = 1;
  }
}
