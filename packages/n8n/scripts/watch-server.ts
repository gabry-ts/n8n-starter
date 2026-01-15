#!/usr/bin/env ts-node

import { Command } from 'commander';
import express, { Request, Response, NextFunction } from 'express';
import * as dotenv from 'dotenv';
import { log, getBaseDir } from './lib/utils';
import {
  WorkflowSavePayload,
  WorkflowDeletePayload,
  CredentialSavePayload,
  CredentialDeletePayload,
} from './lib/types';
import {
  getOutputPath,
  saveWorkflow,
  findAndDeleteWorkflow,
} from './lib/workflows';
import {
  updateCredentialInManifest,
  deleteCredentialFromManifest,
} from './lib/credentials';

// load environment variables
dotenv.config();

const program = new Command();

program
  .name('watch-server')
  .description('webhook server to auto-export workflows on save')
  .option('--port <port>', 'server port', process.env.WATCH_SERVER_PORT || '3456')
  .option('--secret <secret>', 'shared secret for authentication', process.env.WATCH_SERVER_SECRET)
  .parse(process.argv);

const options = program.opts();

// create express app
const app = express();
app.use(express.json({ limit: '10mb' }));

// authentication middleware
function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!options.secret) {
    next();
    return;
  }

  const providedSecret = req.headers['x-webhook-secret'] || req.query.secret;

  if (providedSecret !== options.secret) {
    log('warn', 'unauthorized request rejected');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  next();
}

// health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// endpoint: receive and save workflow directly
app.post('/webhook/workflow-save', authMiddleware, async (req: Request, res: Response) => {
  const payload = req.body as WorkflowSavePayload;

  log('info', 'received workflow save', {
    name: payload.originalName,
    folderPath: payload.folderPath || 'root',
    event: payload.event,
  });

  // validate payload
  if (!payload.workflow || !payload.originalName) {
    log('warn', 'invalid payload: missing workflow or originalName');
    res.status(400).json({ error: 'missing workflow data' });
    return;
  }

  try {
    const baseDir = getBaseDir();
    const outputPath = getOutputPath(payload.workflow, payload.folderPath, baseDir);

    saveWorkflow(payload.workflow, outputPath);

    log('info', `saved workflow: ${payload.originalName} -> ${outputPath}`);
    res.json({ status: 'ok', path: outputPath });
  } catch (error) {
    log('error', `failed to save workflow ${payload.originalName}:`, error);
    res.status(500).json({ error: 'failed to save workflow' });
  }
});

// endpoint: delete workflow file
app.post('/webhook/workflow-delete', authMiddleware, async (req: Request, res: Response) => {
  const payload = req.body as WorkflowDeletePayload;

  log('info', 'received workflow delete', {
    name: payload.workflowName,
    event: payload.event,
  });

  if (!payload.workflowName) {
    log('warn', 'invalid payload: missing workflowName');
    res.status(400).json({ error: 'missing workflowName' });
    return;
  }

  try {
    const baseDir = getBaseDir();
    const deletedPath = findAndDeleteWorkflow(payload.workflowName, baseDir);

    if (deletedPath) {
      log('info', `deleted workflow: ${payload.workflowName} (${deletedPath})`);
      res.json({ status: 'ok', path: deletedPath });
    } else {
      log('warn', `workflow file not found: ${payload.workflowName}`);
      res.json({ status: 'ok', message: 'file not found' });
    }
  } catch (error) {
    log('error', `failed to delete workflow ${payload.workflowName}:`, error);
    res.status(500).json({ error: 'failed to delete workflow' });
  }
});

// endpoint: receive and save credential to manifest
app.post('/webhook/credential-save', authMiddleware, async (req: Request, res: Response) => {
  const payload = req.body as CredentialSavePayload;

  log('info', 'received credential save', {
    id: payload.id,
    name: payload.name,
    type: payload.type,
    event: payload.event,
  });

  if (!payload.id || !payload.name || !payload.type) {
    log('warn', 'invalid payload: missing id, name, or type');
    res.status(400).json({ error: 'missing credential data' });
    return;
  }

  try {
    const baseDir = getBaseDir();
    await updateCredentialInManifest(baseDir, payload.id, payload.name, payload.type);
    log('info', `saved credential: ${payload.name} (${payload.id}) type=${payload.type}`);
    res.json({ status: 'ok', id: payload.id });
  } catch (error) {
    log('error', `failed to save credential ${payload.name}:`, error);
    res.status(500).json({ error: 'failed to save credential' });
  }
});

// endpoint: delete credential from manifest
app.post('/webhook/credential-delete', authMiddleware, async (req: Request, res: Response) => {
  const payload = req.body as CredentialDeletePayload;

  log('info', 'received credential delete', {
    id: payload.id,
    event: payload.event,
  });

  if (!payload.id) {
    log('warn', 'invalid payload: missing id');
    res.status(400).json({ error: 'missing credential id' });
    return;
  }

  try {
    const baseDir = getBaseDir();
    const deleted = deleteCredentialFromManifest(baseDir, payload.id);
    if (deleted) {
      log('info', `deleted credential: ${payload.id}`);
    } else {
      log('warn', `credential not found in manifest: ${payload.id}`);
    }
    res.json({ status: 'ok', deleted });
  } catch (error) {
    log('error', `failed to delete credential ${payload.id}:`, error);
    res.status(500).json({ error: 'failed to delete credential' });
  }
});

// graceful shutdown
let server: ReturnType<typeof app.listen>;

function shutdown(): void {
  log('info', 'shutting down watch server...');
  if (server) {
    server.close(() => {
      log('info', 'server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// start server
const port = parseInt(options.port, 10);
server = app.listen(port, () => {
  log('info', `watch server listening on port ${port}`);
  log('info', `endpoint: POST http://localhost:${port}/webhook/workflow-save`);
  if (options.secret) {
    log('info', 'authentication enabled');
  } else {
    log('warn', 'authentication disabled');
  }
});
