import * as fs from 'fs';
import * as path from 'path';

// format log message
export function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (data !== undefined) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// get base directory (project root)
export function getBaseDir(): string {
  const scriptDir = __dirname;

  if (scriptDir.endsWith('lib')) {
    return path.resolve(scriptDir, '..');
  }

  return scriptDir;
}

// check if running in docker
export function isRunningInDocker(): boolean {
  return fs.existsSync('/.dockerenv');
}
