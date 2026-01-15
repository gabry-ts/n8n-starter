// workflow data from hook
export interface WorkflowSavePayload {
  workflow: Record<string, unknown>;
  originalName: string;
  workflowId?: string;
  folderPath: string | null;
  event: string;
}

// workflow delete payload
export interface WorkflowDeletePayload {
  workflowName: string;
  event: string;
}

// credential payloads
export interface CredentialSavePayload {
  id?: string;  // optional - n8n doesn't provide id on create hook
  name: string;
  type: string;
  event: string;
}

export interface CredentialDeletePayload {
  id: string;
  event: string;
}

// credential schema from n8n API (JSON Schema format)
export interface CredentialSchema {
  properties?: Record<string, { type: string }>;
  required?: string[];
}

// manifest credential entry
export interface ManifestCredential {
  name: string;
  type: string;
  data: Record<string, string>;
}
