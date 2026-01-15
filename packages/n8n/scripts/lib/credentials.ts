import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as yaml from 'yaml';
import { log, getBaseDir } from './utils';
import { CredentialSchema, ManifestCredential } from './types';

// read n8n API key from shared file
export function getN8nApiKey(): string | null {
  const baseDir = getBaseDir();
  const keyPath = path.join(baseDir, 'credentials', '.n8n-api-key');
  log('info', `looking for API key at: ${keyPath}`);
  try {
    if (fs.existsSync(keyPath)) {
      const key = fs.readFileSync(keyPath, 'utf-8').trim();
      log('info', `found API key: ${key.substring(0, 15)}...`);
      return key;
    } else {
      log('warn', `API key file not found at ${keyPath}`);
    }
  } catch (error) {
    log('warn', 'failed to read n8n API key:', error);
  }
  return null;
}

// fetch credential schema from n8n API using http module
export function fetchCredentialSchema(type: string): Promise<string[]> {
  return new Promise((resolve) => {
    // inside docker, always use service name 'n8n', ignore N8N_HOST env
    const n8nHost = 'n8n';
    const n8nPort = '5678';

    const apiKey = getN8nApiKey();
    if (!apiKey) {
      log('warn', `no API key available, cannot fetch schema for ${type}`);
      resolve([]);
      return;
    }

    const reqPath = `/api/v1/credentials/schema/${type}`;
    log('info', `fetching schema from http://${n8nHost}:${n8nPort}${reqPath}`);

    const options = {
      hostname: n8nHost,
      port: parseInt(n8nPort, 10),
      path: reqPath,
      method: 'GET',
      headers: {
        'X-N8N-API-KEY': apiKey
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        log('info', `schema response: status=${res.statusCode}, body=${data.substring(0, 100)}`);
        if (res.statusCode !== 200) {
          log('warn', `failed to fetch schema for ${type}: ${res.statusCode}`);
          resolve([]);
          return;
        }
        try {
          const schema = JSON.parse(data) as CredentialSchema;
          const fields = schema.properties ? Object.keys(schema.properties) : [];
          log('info', `parsed schema for ${type}: ${fields.join(', ')}`);
          resolve(fields);
        } catch (e) {
          log('warn', `failed to parse schema for ${type}: ${e}`);
          resolve([]);
        }
      });
    });

    req.on('error', (err) => {
      log('warn', `http error fetching schema for ${type}: ${err.message}`);
      resolve([]);
    });

    req.end();
  });
}

// generate env var name from credential name and field
export function toEnvVarName(credentialName: string, fieldName: string): string {
  const prefix = credentialName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const suffix = fieldName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${prefix}_${suffix}`;
}

// read manifest.yml
export function readManifest(baseDir: string): Record<string, unknown> {
  const manifestPath = path.join(baseDir, 'credentials', 'manifest.yml');
  if (!fs.existsSync(manifestPath)) {
    return { credentials: {} };
  }
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return yaml.parse(content) || { credentials: {} };
}

// write manifest.yml
export function writeManifest(baseDir: string, manifest: Record<string, unknown>): void {
  const manifestPath = path.join(baseDir, 'credentials', 'manifest.yml');
  const dir = path.dirname(manifestPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(manifestPath, yaml.stringify(manifest), 'utf-8');
}

// update credential in manifest
export async function updateCredentialInManifest(
  baseDir: string,
  id: string,
  name: string,
  type: string
): Promise<void> {
  const manifestPath = path.join(baseDir, 'credentials', 'manifest.yml');
  log('info', `manifest path: ${manifestPath}`);

  const manifest = readManifest(baseDir);
  log('info', `current manifest:`, manifest);

  // convert array format to object format if needed
  let credentials: Record<string, ManifestCredential> = {};
  if (Array.isArray(manifest.credentials)) {
    // keep existing array entries but also maintain our object format
    credentials = (manifest._autoCredentials || {}) as Record<string, ManifestCredential>;
  } else {
    credentials = (manifest.credentials || {}) as Record<string, ManifestCredential>;
  }

  // fetch schema to get field names
  const fieldNames = await fetchCredentialSchema(type);
  log('info', `schema fields for ${type}:`, fieldNames);

  // get existing entry if any
  const existing = credentials[id];
  const existingData = existing?.data || {};

  // build data object - keep existing values, add new keys with placeholders
  const data: Record<string, string> = {};
  for (const fieldName of fieldNames) {
    if (existingData[fieldName]) {
      // keep existing value (user may have set custom env var)
      data[fieldName] = existingData[fieldName];
    } else {
      // new field - add placeholder
      const envVarName = toEnvVarName(name, fieldName);
      data[fieldName] = `\${${envVarName}}`;
    }
  }

  // update or create credential entry
  credentials[id] = {
    name,
    type,
    data
  };

  // store in separate key to not conflict with manual entries
  manifest._autoCredentials = credentials;
  log('info', `writing manifest:`, manifest);
  writeManifest(baseDir, manifest);
  log('info', `manifest written`);
}

// delete credential from manifest
export function deleteCredentialFromManifest(baseDir: string, id: string): boolean {
  const manifest = readManifest(baseDir);
  const credentials = (manifest.credentials || {}) as Record<string, ManifestCredential>;

  if (credentials[id]) {
    delete credentials[id];
    manifest.credentials = credentials;
    writeManifest(baseDir, manifest);
    return true;
  }
  return false;
}
