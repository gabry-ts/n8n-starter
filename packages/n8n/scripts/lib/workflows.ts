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

// save workflow to file
export function saveWorkflow(workflow: Record<string, unknown>, outputPath: string): void {
  const dir = path.dirname(outputPath);

  // ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // write pretty-printed json
  fs.writeFileSync(outputPath, JSON.stringify(workflow, null, 2) + '\n', 'utf-8');
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

// find and delete workflow file by name
export function findAndDeleteWorkflow(workflowName: string, baseDir: string): string | null {
  const filename = slugify(workflowName, { lower: true, strict: true, replacement: '-' }) + '.json';
  const workflowsDir = path.join(baseDir, 'workflows');

  const filePath = findFileRecursive(workflowsDir, filename);

  if (filePath) {
    fs.unlinkSync(filePath);
    return filePath;
  }

  return null;
}
