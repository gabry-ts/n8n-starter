#!/usr/bin/env ts-node

// bootstrap credentials and owner account
// runs inside n8n-init container which has n8n installed

import * as fs from 'fs';
import * as crypto from 'crypto';
import { Client } from 'pg';
import * as bcrypt from 'bcrypt';
import * as yaml from 'js-yaml';

// types
interface Manifest {
  credentials?: CredentialDefinition[];
  _autoCredentials?: Record<string, AutoCredential>;
}

interface CredentialDefinition {
  name: string;
  type: string;
  env_mapping?: Record<string, string>;
}

interface AutoCredential {
  name: string;
  type: string;
  data?: Record<string, string>;
}

interface ResolvedValue {
  value: unknown;
  missing: string[];
}

interface CipherInstance {
  encrypt(data: Record<string, unknown>): string;
  setKey?(key: string): void;
}

// import n8n's cipher from global install
const N8N_MODULES_PATH = '/usr/local/lib/node_modules/n8n/node_modules';
let Cipher: new (options?: { encryptionKey: string }) => CipherInstance;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const n8nCore = require(`${N8N_MODULES_PATH}/n8n-core`);
  Cipher = n8nCore.Cipher;
} catch (e) {
  console.error('could not load n8n Cipher module:', (e as Error).message);
  process.exit(1);
}

// resolve ${ENV_VAR} placeholders in a string
function resolveEnvPlaceholder(value: unknown): ResolvedValue {
  if (typeof value !== 'string') return { value, missing: [] };

  const match = value.match(/^\$\{([^}]+)\}$/);
  if (!match) return { value, missing: [] };

  const envVar = match[1];
  const resolved = process.env[envVar];

  if (resolved === undefined || resolved === '') {
    return { value: null, missing: [envVar] };
  }

  // type conversion
  if (resolved === 'true') return { value: true, missing: [] };
  if (resolved === 'false') return { value: false, missing: [] };
  if (!isNaN(Number(resolved)) && resolved.trim() !== '') return { value: Number(resolved), missing: [] };
  return { value: resolved, missing: [] };
}

// generate uuid v4
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// setup owner account if env vars are provided
async function setupOwnerAccount(client: Client): Promise<string | null> {
  const email = process.env.N8N_OWNER_EMAIL;
  const password = process.env.N8N_OWNER_PASSWORD;

  if (!email || !password) {
    console.log('owner account setup skipped (N8N_OWNER_EMAIL or N8N_OWNER_PASSWORD not set)');
    return null;
  }

  console.log(`setting up owner account: ${email}`);

  // check if user already exists
  const existing = await client.query('SELECT id FROM "user" WHERE email = $1', [email]);

  if (existing.rows.length > 0) {
    console.log('  owner account already exists');
    return existing.rows[0].id;
  }

  // hash password with bcrypt (n8n uses 10 rounds)
  const hashedPassword = await bcrypt.hash(password, 10);
  const userId = uuid();
  const now = new Date().toISOString();

  // create user
  await client.query(
    `INSERT INTO "user" (id, email, "firstName", "lastName", password, "roleSlug", "personalizationAnswers", "createdAt", "updatedAt", disabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [userId, email, 'Admin', 'User', hashedPassword, 'global:owner', null, now, now, false]
  );

  console.log('  created owner user');

  // create personal project for the user
  const projectId = uuid();
  await client.query(
    `INSERT INTO project (id, name, type, "createdAt", "updatedAt", "creatorId")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [projectId, 'Admin User', 'personal', now, now, userId]
  );

  console.log('  created personal project');

  // link user to project
  await client.query(
    `INSERT INTO project_relation ("projectId", "userId", role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5)`,
    [projectId, userId, 'project:personalOwner', now, now]
  );

  console.log('  linked user to project');

  // mark instance as set up (skip setup wizard)
  await client.query(
    `INSERT INTO settings (key, value, "loadOnStartup")
     VALUES ('userManagement.isInstanceOwnerSetUp', '"true"', true)
     ON CONFLICT (key) DO UPDATE SET value = '"true"'`
  );

  console.log('  marked instance as set up');

  // create API key for watch-server
  const apiKeyId = 'watch-srv-key';
  const existingKey = await client.query('SELECT "apiKey" FROM user_api_keys WHERE id = $1', [apiKeyId]);

  if (existingKey.rows.length === 0) {
    const apiKey = 'n8n_api_' + crypto.randomBytes(16).toString('hex');
    const keyNow = new Date().toISOString();

    await client.query(
      `INSERT INTO user_api_keys (id, "userId", label, "apiKey", "createdAt", "updatedAt", scopes, audience)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [apiKeyId, userId, 'watch-server', apiKey, keyNow, keyNow, '["credentials:read"]', 'public-api']
    );
    console.log('  created watch-server API key');

    // write to shared file
    fs.writeFileSync('/credentials/.n8n-api-key', apiKey);
  } else {
    console.log('  watch-server API key already exists');
    fs.writeFileSync('/credentials/.n8n-api-key', existingKey.rows[0].apiKey);
  }

  return userId;
}

async function main(): Promise<void> {
  console.log('=== bootstrap: starting ===');

  // connect to database first
  const client = new Client({
    host: process.env.DB_POSTGRESDB_HOST,
    port: parseInt(process.env.DB_POSTGRESDB_PORT || '5432'),
    database: process.env.DB_POSTGRESDB_DATABASE,
    user: process.env.DB_POSTGRESDB_USER,
    password: process.env.DB_POSTGRESDB_PASSWORD,
  });

  await client.connect();

  // step 1: setup owner account
  console.log('--- owner account ---');
  await setupOwnerAccount(client);

  // step 2: bootstrap credentials
  console.log('--- credentials ---');

  const manifestPath = '/credentials/manifest.yml';

  if (!fs.existsSync(manifestPath)) {
    console.log('no manifest.yml found, skipping credentials bootstrap');
    await client.end();
    return;
  }

  const content = fs.readFileSync(manifestPath, 'utf-8');
  const manifest = (yaml.load(content) as Manifest) || {};

  // check encryption key
  const encryptionKey = process.env.N8N_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error('N8N_ENCRYPTION_KEY required for credential encryption');
    await client.end();
    process.exit(1);
  }

  // create cipher instance
  let cipher: CipherInstance;
  try {
    cipher = new Cipher({ encryptionKey });
  } catch {
    // try without options
    cipher = new (Cipher as unknown as new () => CipherInstance)();
    if (cipher.setKey) {
      cipher.setKey(encryptionKey);
    }
  }

  // get first project to share credentials with (usually personal project)
  const projectResult = await client.query('SELECT id FROM project LIMIT 1');
  const projectId = projectResult.rows.length > 0 ? projectResult.rows[0].id : null;

  if (!projectId) {
    console.log('no project found, credentials will not be shared');
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // helper to create/update credential
  async function processCredential(name: string, type: string, data: Record<string, unknown>): Promise<boolean> {
    // encrypt data using n8n's cipher
    let encryptedData: string;
    try {
      encryptedData = cipher.encrypt(data);
    } catch (e) {
      console.log(`    error encrypting: ${(e as Error).message}`);
      return false;
    }

    // check if credential exists
    const existing = await client.query(
      'SELECT id FROM credentials_entity WHERE name = $1 AND type = $2',
      [name, type]
    );

    const now = new Date().toISOString();

    if (existing.rows.length > 0) {
      // update existing
      await client.query(
        'UPDATE credentials_entity SET data = $1, "updatedAt" = $2 WHERE id = $3',
        [encryptedData, now, existing.rows[0].id]
      );
      console.log(`    updated: ${name}`);
      updated++;
    } else {
      // create new
      const id = uuid();
      await client.query(
        `INSERT INTO credentials_entity (id, name, type, data, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, name, type, encryptedData, now, now]
      );

      // share with project if available
      if (projectId) {
        await client.query(
          `INSERT INTO shared_credentials ("credentialsId", "projectId", role, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT ("credentialsId", "projectId") DO NOTHING`,
          [id, projectId, 'credential:owner', now, now]
        );
      }

      console.log(`    created: ${name}`);
      created++;
    }
    return true;
  }

  // process credentials array (env_mapping format)
  const credentialsArray = manifest.credentials || [];
  if (credentialsArray.length > 0) {
    console.log(`found ${credentialsArray.length} credential(s) in credentials array`);
  }

  for (const cred of credentialsArray) {
    console.log(`  processing: ${cred.name} (${cred.type})`);

    // build data from env vars
    const data: Record<string, unknown> = {};
    const missingVars: string[] = [];

    for (const [field, envVar] of Object.entries(cred.env_mapping || {})) {
      const value = process.env[envVar];
      if (value === undefined || value === '') {
        missingVars.push(envVar);
      } else {
        // type conversion
        if (value === 'true') data[field] = true;
        else if (value === 'false') data[field] = false;
        else if (!isNaN(Number(value)) && value.trim() !== '') data[field] = Number(value);
        else data[field] = value;
      }
    }

    if (missingVars.length > 0) {
      console.log(`    skipped: missing env vars: ${missingVars.join(', ')}`);
      skipped++;
      continue;
    }

    await processCredential(cred.name, cred.type, data);
  }

  // process _autoCredentials (data with ${ENV_VAR} placeholders)
  const autoCredentials = manifest._autoCredentials || {};
  const autoCredCount = Object.keys(autoCredentials).length;
  if (autoCredCount > 0) {
    console.log(`found ${autoCredCount} credential(s) in _autoCredentials`);
  }

  for (const [, cred] of Object.entries(autoCredentials)) {
    console.log(`  processing: ${cred.name} (${cred.type})`);

    // resolve env placeholders in data - skip fields without env vars
    const data: Record<string, unknown> = {};
    const missingVars: string[] = [];

    for (const [field, value] of Object.entries(cred.data || {})) {
      const resolved = resolveEnvPlaceholder(value);
      if (resolved.missing.length > 0) {
        missingVars.push(...resolved.missing);
        // skip this field, don't fail the whole credential
      } else if (resolved.value !== null) {
        data[field] = resolved.value;
      }
    }

    if (missingVars.length > 0) {
      console.log(`    note: skipping optional fields: ${missingVars.join(', ')}`);
    }

    // only skip if no data at all
    if (Object.keys(data).length === 0) {
      console.log(`    skipped: no env vars resolved`);
      skipped++;
      continue;
    }

    await processCredential(cred.name, cred.type, data);
  }

  console.log('--- credentials summary ---');
  console.log(`created: ${created}, updated: ${updated}, skipped: ${skipped}`);

  await client.end();
  console.log('=== bootstrap: complete ===');
}

main().catch(err => {
  console.error('bootstrap-credentials failed:', (err as Error).message);
  process.exit(1);
});
