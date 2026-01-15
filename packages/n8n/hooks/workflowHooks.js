// n8n external hooks for workflow export
// sends workflow data directly to watch-server for saving

const http = require('http');

const WATCH_SERVER_HOST = process.env.WATCH_SERVER_HOST || 'n8n-watch-server';
const WATCH_SERVER_PORT = process.env.WATCH_SERVER_PORT || '3456';
const WATCH_SERVER_SECRET = process.env.WATCH_SERVER_SECRET || 'local-webhook-secret';

const VOLATILE_FIELDS = [
  'createdAt', 'updatedAt', 'versionId', 'statistics', 'staticData',
  'triggerCount', 'versionCounter', 'activeVersionId', 'activeVersion',
  'shared', 'homeProject', 'sharedWithProjects', 'parentFolder'
];

const workflowCache = new Map();

function cleanWorkflow(workflow) {
  const cleaned = { ...workflow };
  for (const field of VOLATILE_FIELDS) {
    delete cleaned[field];
  }
  if (cleaned.meta) {
    delete cleaned.meta.instanceId;
    if (Object.keys(cleaned.meta).length === 0) {
      delete cleaned.meta;
    }
  }
  delete cleaned.id;
  return cleaned;
}

function sendToServer(path, data) {
  try {
    const payload = JSON.stringify(data);
    const options = {
      hostname: WATCH_SERVER_HOST,
      port: parseInt(WATCH_SERVER_PORT, 10),
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-webhook-secret': WATCH_SERVER_SECRET
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      console.log('[hooks] watch-server response:', res.statusCode);
    });

    req.on('error', (err) => {
      console.error('[hooks] watch-server error:', err.message);
    });

    req.write(payload);
    req.end();
  } catch (err) {
    console.error('[hooks] sendToServer error:', err.message);
  }
}

function getFolderPath(workflow) {
  if (!workflow.parentFolder) return null;
  const parts = [];
  let folder = workflow.parentFolder;
  while (folder) {
    if (folder.name) parts.unshift(folder.name);
    folder = folder.parentFolder;
  }
  return parts.length > 0 ? parts.join('/') : null;
}

function cacheWorkflow(workflow) {
  if (workflow && workflow.id && workflow.name) {
    workflowCache.set(workflow.id, {
      name: workflow.name,
      nodes: workflow.nodes,
      connections: workflow.connections,
      settings: workflow.settings,
      pinData: workflow.pinData,
      active: workflow.active,
      isArchived: workflow.isArchived,
      parentFolder: workflow.parentFolder
    });
  }
}

function sendWorkflowToServer(workflow, event) {
  if (!workflow || !workflow.name) {
    console.log('[hooks] skipping', event, ': workflow has no name');
    return;
  }
  const folderPath = getFolderPath(workflow);
  const cleanedWorkflow = cleanWorkflow(workflow);
  console.log('[hooks] sending', event, ':', workflow.name, 'id=' + workflow.id, 'active=' + cleanedWorkflow.active);
  sendToServer('/webhook/workflow-save', {
    workflow: cleanedWorkflow,
    originalName: workflow.name,
    workflowId: workflow.id,
    folderPath: folderPath,
    event: event
  });
}

function sendDeleteToServer(workflowName, event) {
  if (!workflowName) {
    console.log('[hooks] skipping', event, ': no workflow name');
    return;
  }
  sendToServer('/webhook/workflow-delete', { workflowName: workflowName, event: event });
}

console.log('[hooks] workflowHooks.js loaded');

// note: archive/unarchive do not trigger hooks (n8n bug #21249)

module.exports = {
  credentials: {
    create: [
      async function (credentialData) {
        console.log('[hooks] credentials.create:', credentialData.name, 'type=' + credentialData.type);
        sendToServer('/webhook/credential-save', {
          id: credentialData.id,
          name: credentialData.name,
          type: credentialData.type,
          event: 'create'
        });
      }
    ],
    update: [
      async function (credentialData) {
        console.log('[hooks] credentials.update:', credentialData.name, 'type=' + credentialData.type);
        sendToServer('/webhook/credential-save', {
          id: credentialData.id,
          name: credentialData.name,
          type: credentialData.type,
          event: 'update'
        });
      }
    ],
    delete: [
      async function (credentialId) {
        console.log('[hooks] credentials.delete:', credentialId);
        sendToServer('/webhook/credential-delete', {
          id: credentialId,
          event: 'delete'
        });
      }
    ]
  },
  workflow: {
    update: [
      async function (workflowData) {
        console.log('[hooks] workflow.update:', workflowData && workflowData.name);
        if (workflowData) {
          cacheWorkflow(workflowData);
          sendWorkflowToServer(workflowData, 'update');
        }
      }
    ],
    activate: [
      async function (workflowData) {
        console.log('[hooks] workflow.activate:', workflowData && workflowData.name);
        if (workflowData) {
          cacheWorkflow(workflowData);
          sendWorkflowToServer(workflowData, 'activate');
        }
      }
    ],
    deactivate: [
      async function (workflowData) {
        console.log('[hooks] workflow.deactivate:', workflowData && workflowData.name);
        if (workflowData) {
          cacheWorkflow(workflowData);
          sendWorkflowToServer(workflowData, 'deactivate');
        }
      }
    ],
    afterDelete: [
      async function (workflowId) {
        console.log('[hooks] workflow.afterDelete:', workflowId);
        const cached = workflowCache.get(workflowId);
        if (cached) {
          sendDeleteToServer(cached.name, 'afterDelete');
          workflowCache.delete(workflowId);
        } else {
          sendDeleteToServer(workflowId, 'afterDelete');
        }
      }
    ]
  }
};
