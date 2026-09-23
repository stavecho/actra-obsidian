import { requestUrl } from "obsidian";
import type {
  IndexDocumentPayload,
  PairingClaim,
  PairingStatus,
  PendingJobsPage,
  SyncFailureCode,
  SyncJob,
  UploadedDocument
} from "../types";
import { ActraError } from "../utils/errors";
import {
  convertStavechoPage,
  createStavechoUploadBody,
  hasStavechoScope,
  parseStavechoCursor,
  parseStavechoUploadResponse,
  stavechoApiBaseUrl,
  stavechoSourcesForScope
} from "./stavecho";

export interface PairingPayload {
  pairingCode: string;
  pluginInstanceId: string;
  vaultName: string;
  platform: string;
  pluginVersion: string;
  requestedScopes: string[];
}

export interface ActraClient {
  claimPairing(payload: PairingPayload): Promise<PairingClaim>;
  getPairingStatus(pairingId: string): Promise<PairingStatus>;
  revokeConnection(connectionId: string): Promise<void>;
  sessionOpen(connectionId: string): Promise<void>;
  getPendingJobs(cursor?: string): Promise<PendingJobsPage>;
  acknowledgeJob(jobId: string, path: string, contentHash: string): Promise<void>;
  failJob(jobId: string, code: SyncFailureCode, message: string, path?: string): Promise<void>;
  batchUpsertDocuments(documents: IndexDocumentPayload[]): Promise<UploadedDocument[]>;
  removeIndexDocument(documentId: string): Promise<void>;
  revokeReadRoot(root: string): Promise<void>;
  reconcileIndex(documents: Array<Pick<IndexDocumentPayload, "documentId" | "path" | "contentHash">>): Promise<void>;
}

type TokenProvider = () => string | null | Promise<string | null>;
type ScopeProvider = () => string;

export class HttpActraClient implements ActraClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokenProvider: TokenProvider,
    private readonly scopeProvider: ScopeProvider = () => "dailylog note recording upload"
  ) {}

  private url(path: string): string {
    return `${stavechoApiBaseUrl(this.baseUrl)}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    authenticated = true
  ): Promise<T> {
    const token = authenticated ? await this.tokenProvider() : null;
    if (authenticated && !token) throw new ActraError("连接凭据不存在，请重新授权。", "REAUTH_REQUIRED");
    try {
      const response = await requestUrl({
        url: this.url(path),
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        throw: false
      });
      if (response.status === 401) {
        throw new ActraError("ACTRA 凭据已失效，请重新授权。", "REAUTH_REQUIRED");
      }
      if (response.status === 403) {
        throw new ActraError("当前 ACTRA 授权范围不允许此操作。", "REQUEST_REJECTED");
      }
      if (response.status < 200 || response.status >= 300) {
        throw new ActraError(
          `ACTRA 服务返回 ${response.status}。`,
          response.status >= 500 ? "SERVER_ERROR" : "REQUEST_REJECTED",
          response.status >= 500
        );
      }
      return response.json as T;
    } catch (error) {
      if (error instanceof ActraError) throw error;
      throw new ActraError("无法连接 ACTRA 服务。", "NETWORK_ERROR", true);
    }
  }

  claimPairing(payload: PairingPayload): Promise<PairingClaim> {
    return this.request("POST", "/v1/obsidian/pairings/claim", payload, false);
  }

  getPairingStatus(pairingId: string): Promise<PairingStatus> {
    return this.request("GET", `/v1/obsidian/pairings/${encodeURIComponent(pairingId)}/status`, undefined, false);
  }

  revokeConnection(connectionId: string): Promise<void> {
    return this.request("POST", `/v1/obsidian/connections/${encodeURIComponent(connectionId)}/revoke`);
  }

  sessionOpen(connectionId: string): Promise<void> {
    return this.request("POST", `/v1/obsidian/connections/${encodeURIComponent(connectionId)}/session-open`);
  }

  getPendingJobs(cursor?: string): Promise<PendingJobsPage> {
    const sources = stavechoSourcesForScope(this.scopeProvider());
    if (sources.length === 0) return Promise.resolve({ jobs: [] });
    const { source, page } = parseStavechoCursor(cursor, sources);
    return this.request<unknown>("GET", `/v1/client/${source}?page=${page}&page_size=100`)
      .then((response) => convertStavechoPage(source, page, response, sources));
  }

  acknowledgeJob(_jobId: string, _path: string, _contentHash: string): Promise<void> {
    // The Stavecho client API is a read-only paginated feed and has no receipt endpoint.
    // Local mappings and source update_time provide idempotency across pulls.
    return Promise.resolve();
  }

  failJob(_jobId: string, _code: SyncFailureCode, _message: string, _path?: string): Promise<void> {
    return Promise.resolve();
  }

  async batchUpsertDocuments(documents: IndexDocumentPayload[]): Promise<UploadedDocument[]> {
    if (!hasStavechoScope(this.scopeProvider(), "upload")) {
      throw new ActraError("当前 ACTRA 授权未包含 upload 权限，请重新登录授权。", "REQUEST_REJECTED");
    }
    const uploaded: UploadedDocument[] = [];
    for (const document of documents) {
      const token = await this.tokenProvider();
      if (!token) throw new ActraError("连接凭据不存在，请重新授权。", "REAUTH_REQUIRED");
      const multipart = createStavechoUploadBody(document);
      try {
        const response = await requestUrl({
          url: this.url("/v1/client/upload"),
          method: "POST",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "Content-Type": multipart.contentType
          },
          body: multipart.body,
          throw: false
        });
        if (response.status === 401) {
          throw new ActraError("ACTRA 凭据已失效，请重新授权。", "REAUTH_REQUIRED");
        }
        if (response.status === 403) {
          throw new ActraError("当前 ACTRA 授权未包含 upload 权限。", "REQUEST_REJECTED");
        }
        if (response.status < 200 || response.status >= 300) {
          throw new ActraError(
            `ACTRA 上传返回 ${response.status}。`,
            response.status >= 500 ? "SERVER_ERROR" : "REQUEST_REJECTED",
            response.status >= 500
          );
        }
        const result = parseStavechoUploadResponse(response.json);
        uploaded.push({ path: document.path, documentId: result.dataId });
      } catch (error) {
        if (error instanceof ActraError) throw error;
        throw new ActraError("无法上传 Obsidian 笔记至 ACTRA。", "NETWORK_ERROR", true);
      }
    }
    return uploaded;
  }

  removeIndexDocument(_documentId: string): Promise<void> {
    // The current Stavecho API has no remote deletion endpoint.
    return Promise.resolve();
  }

  revokeReadRoot(_root: string): Promise<void> {
    return Promise.resolve();
  }

  reconcileIndex(_documents: Array<Pick<IndexDocumentPayload, "documentId" | "path" | "contentHash">>): Promise<void> {
    return Promise.resolve();
  }
}

export class MockActraClient implements ActraClient {
  private jobs: SyncJob[] = [];
  readonly uploadedDocuments = new Map<string, IndexDocumentPayload>();

  enqueue(jobs: SyncJob[]): void {
    this.jobs.push(...jobs);
  }

  claimPairing(): Promise<PairingClaim> {
    return Promise.resolve({
      pairingId: `pairing_demo_${Date.now()}`,
      status: "CONNECTED",
      vaultConnectionId: `vault_demo_${Date.now()}`,
      accessToken: `demo_${crypto.randomUUID()}`
    });
  }

  getPairingStatus(): Promise<PairingStatus> {
    return Promise.resolve({ status: "PENDING_CONFIRMATION" });
  }

  revokeConnection(): Promise<void> {
    return Promise.resolve();
  }

  sessionOpen(): Promise<void> {
    return Promise.resolve();
  }

  getPendingJobs(): Promise<PendingJobsPage> {
    return Promise.resolve({ jobs: [...this.jobs] });
  }

  acknowledgeJob(jobId: string): Promise<void> {
    this.jobs = this.jobs.filter((job) => job.jobId !== jobId);
    return Promise.resolve();
  }

  failJob(jobId: string): Promise<void> {
    this.jobs = this.jobs.filter((job) => job.jobId !== jobId);
    return Promise.resolve();
  }

  batchUpsertDocuments(documents: IndexDocumentPayload[]): Promise<UploadedDocument[]> {
    const uploaded: UploadedDocument[] = [];
    for (const document of documents) this.uploadedDocuments.set(document.documentId, document);
    for (const document of documents) uploaded.push({ path: document.path, documentId: document.documentId });
    return Promise.resolve(uploaded);
  }

  removeIndexDocument(documentId: string): Promise<void> {
    this.uploadedDocuments.delete(documentId);
    return Promise.resolve();
  }

  revokeReadRoot(root: string): Promise<void> {
    for (const [id, document] of this.uploadedDocuments) {
      if (document.path === root || document.path.startsWith(`${root}/`)) this.uploadedDocuments.delete(id);
    }
    return Promise.resolve();
  }

  reconcileIndex(): Promise<void> {
    return Promise.resolve();
  }
}
