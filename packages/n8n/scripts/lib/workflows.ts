import * as fs from 'fs';
import * as path from 'path';
import slugify from 'slugify';

// get output path for workflow based on folder path
export function getOutputPath(workflow: Record<string, unknown>, folderPath: string | null, baseDir: string): string {
  const name = workflow.name as string;
  const filename = slugify(name, { lower: true, strict: true, replacement: '-' }) + '.json';

  // if folder path exists, save in that subfolder
  if (folderPath) {
    return path.join(baseDir, 'workflows', folderPath, filename);
  }

  // otherwise save directly in workflows/
  return path.join(baseDir, 'workflows', filename);
}

// save workflow to file with optional n8n id for delete tracking
export function saveWorkflow(workflow: Record<string, unknown>, outputPath: string, workflowId?: string): void {
  const dir = path.dirname(outputPath);

  // ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // add _n8nId for delete tracking (stripped on import by n8n)
  const workflowToSave = workflowId
    ? { _n8nId: workflowId, ...workflow }
    : workflow;

  // write pretty-printed json
  fs.writeFileSync(outputPath, JSON.stringify(workflowToSave, null, 2) + '\n', 'utf-8');
}

// recursively search for file in directory
export function findFileRecursive(dir: string, filename: string): string | null {
  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }

    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, filename);
      if (found) return found;
    }
  }

  return null;
}

// recursively search for workflow file by _n8nId
function findWorkflowById(dir: string, workflowId: string): string | null {
  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isFile() && entry.name.endsWith('.json')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const workflow = JSON.parse(content);
        if (workflow._n8nId === workflowId) {
          return fullPath;
        }
      } catch {
        // skip invalid json files
      }
    }

    if (entry.isDirectory()) {
      const found = findWorkflowById(fullPath, workflowId);
      if (found) return found;
    }
  }

  return null;
}

// find and delete workflow file by name or id
export function findAndDeleteWorkflow(workflowNameOrId: string, baseDir: string): string | null {
  const workflowsDir = path.join(baseDir, 'workflows');

  // first try to find by _n8nId (for delete events that only have id)
  let filePath = findWorkflowById(workflowsDir, workflowNameOrId);

  // if not found by id, try by name
  if (!filePath) {
    const filename = slugify(workflowNameOrId, { lower: true, strict: true, replacement: '-' }) + '.json';
    filePath = findFileRecursive(workflowsDir, filename);
  }

  if (filePath) {
    fs.unlinkSync(filePath);
    return filePath;
  }

  return null;
}
