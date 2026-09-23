export type ConnectionStatus =
  | "UNPAIRED"
  | "CLAIMING"
  | "PENDING_CONFIRMATION"
  | "CONFIGURATION_REQUIRED"
  | "CONNECTED"
  | "PAIRING_FAILED"
  | "REJECTED"
  | "PAUSED"
  | "REAUTH_REQUIRED"
  | "OFFLINE"
  | "REVOKED";

export type AuthenticationMode = "none" | "pairing" | "oauth";

export type ActraNoteType =
  | "daily_summary"
  | "recording"
  | "conversation"
  | "idea"
  | "task_collection"
  | "exercise";

export interface ActraPermissions {
  readAuthorizedNotes: boolean;
  readAttachments: boolean;
  writeAttachments: boolean;
  taskWriteback: boolean;
}

export interface FileMapping {
  actraId: string;
  vaultConnectionId: string;
  filePath: string;
  lastRevision: number;
  lastContentHash: string;
  lastSyncedAt: string;
}

export interface IndexedDocument {
  documentId: string;
  path: string;
  contentHash: string;
  modifiedAt: number;
}

export interface SyncCounters {
  pending: number;
  failed: number;
  conflicts: number;
  succeeded: number;
}

export interface ActraSettings {
  schemaVersion: 3;
  pluginInstanceId: string;
  vaultConnectionId: string;
  deviceName: string;
  apiBaseUrl: string;
  authMode: AuthenticationMode;
  oauthClientId: string;
  oauthScope: string;
  oauthAccessTokenExpiresAt: number;
  oauthRefreshTokenExpiresAt: number;
  tokenSecretId: string;
  refreshTokenSecretId: string;
  connectionStatus: ConnectionStatus;
  pairingId: string;
  writeRoot: string;
  readRoots: string[];
  attachmentRoot: string;
  pullOnObsidianOpen: boolean;
  automaticUploadEnabled: boolean;
  permissions: ActraPermissions;
  paused: boolean;
  lastSuccessfulSyncAt: string;
  lastIndexSyncAt: string;
  lastError: string;
  mappings: Record<string, FileMapping>;
  completedJobs: Record<string, string>;
  locallyRemoved: string[];
  indexedDocuments: Record<string, IndexedDocument>;
  pendingIndexCleanupRoots: string[];
  counters: SyncCounters;
  developerMode: boolean;
}

export interface PairingClaim {
  pairingId: string;
  status: "PENDING_CONFIRMATION" | "CONNECTED";
  vaultConnectionId?: string;
  accessToken?: string;
}

export interface PairingStatus {
  status: "PENDING_CONFIRMATION" | "CONNECTED" | "REJECTED" | "EXPIRED";
  vaultConnectionId?: string;
  accessToken?: string;
}

export interface ActraTask {
  id: string;
  text: string;
  completed?: boolean;
  dueDate?: string;
}

export interface SyncJobContent {
  title: string;
  date: string;
  project?: string;
  tags?: string[];
  summary?: string;
  transcript?: string;
  body?: string;
  audioUrl?: string;
  tasks?: ActraTask[];
  exerciseRows?: Array<Record<string, string | number>>;
}

export interface SyncJob {
  jobId: string;
  actraId: string;
  type: ActraNoteType;
  revision: number;
  updatedAt: string;
  targetPath?: string;
  content: SyncJobContent;
}

export interface PendingJobsPage {
  jobs: SyncJob[];
  nextCursor?: string;
}

export type SyncFailureCode =
  | "PERMISSION_DENIED"
  | "INVALID_TARGET"
  | "CONFLICT"
  | "LOCALLY_REMOVED"
  | "FAILED";

export interface SyncJobResult {
  jobId: string;
  actraId: string;
  status: "SUCCEEDED" | "DUPLICATE" | SyncFailureCode;
  path?: string;
  error?: string;
}

export interface IndexDocumentPayload {
  documentId: string;
  path: string;
  title: string;
  contentHash: string;
  createdAt: number;
  modifiedAt: number;
  tags: string[];
  properties: Record<string, unknown>;
  headings: string[];
  links: string[];
  content: string;
}

export interface UploadedDocument {
  path: string;
  documentId: string;
}
