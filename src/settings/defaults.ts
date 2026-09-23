import type { ActraSettings } from "../types";
import { STAVECHO_API_ORIGIN } from "../api/stavecho";

export const DEFAULT_SETTINGS: ActraSettings = {
  schemaVersion: 3,
  pluginInstanceId: "",
  vaultConnectionId: "",
  deviceName: "",
  apiBaseUrl: STAVECHO_API_ORIGIN,
  authMode: "none",
  oauthClientId: "",
  oauthScope: "",
  oauthAccessTokenExpiresAt: 0,
  oauthRefreshTokenExpiresAt: 0,
  tokenSecretId: "",
  refreshTokenSecretId: "",
  connectionStatus: "UNPAIRED",
  pairingId: "",
  writeRoot: "ACTRA",
  readRoots: [],
  attachmentRoot: "ACTRA/附件",
  pullOnObsidianOpen: true,
  automaticUploadEnabled: true,
  permissions: {
    readAuthorizedNotes: false,
    readAttachments: false,
    writeAttachments: false,
    taskWriteback: false
  },
  paused: false,
  lastSuccessfulSyncAt: "",
  lastIndexSyncAt: "",
  lastError: "",
  mappings: {},
  completedJobs: {},
  locallyRemoved: [],
  indexedDocuments: {},
  pendingIndexCleanupRoots: [],
  counters: { pending: 0, failed: 0, conflicts: 0, succeeded: 0 },
  developerMode: false
};

export function mergeSettings(data: unknown): ActraSettings {
  if (!data || typeof data !== "object") return structuredClone(DEFAULT_SETTINGS);
  const value = data as Partial<ActraSettings>;
  const permissions = value.permissions;
  const merged: ActraSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...value,
    schemaVersion: 3,
    authMode: value.authMode ?? (value.vaultConnectionId ? "pairing" : "none"),
    automaticUploadEnabled: value.automaticUploadEnabled ?? true,
    developerMode: false,
    permissions: {
      readAuthorizedNotes: permissions?.readAuthorizedNotes ?? false,
      readAttachments: permissions?.readAttachments ?? false,
      writeAttachments: permissions?.writeAttachments ?? false,
      taskWriteback: permissions?.taskWriteback ?? false
    },
    counters: { ...DEFAULT_SETTINGS.counters, ...value.counters },
    mappings: value.mappings ?? {},
    completedJobs: value.completedJobs ?? {},
    indexedDocuments: value.indexedDocuments ?? {},
    readRoots: Array.isArray(value.readRoots) ? value.readRoots : [],
    locallyRemoved: Array.isArray(value.locallyRemoved) ? value.locallyRemoved : [],
    pendingIndexCleanupRoots: Array.isArray(value.pendingIndexCleanupRoots)
      ? value.pendingIndexCleanupRoots
      : [],
    apiBaseUrl: typeof value.apiBaseUrl === "string" && value.apiBaseUrl.trim()
      ? value.apiBaseUrl.trim()
      : DEFAULT_SETTINGS.apiBaseUrl
  };
  return merged;
}
