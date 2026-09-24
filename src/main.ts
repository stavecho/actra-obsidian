import { Notice, Platform, Plugin, TFile, apiVersion } from "obsidian";
import type { ObsidianProtocolData } from "obsidian";
import { HttpActraClient, MockActraClient, type ActraClient } from "./api/client";
import { createDemoJobs } from "./api/demo";
import { normalizeStavechoBaseUrl } from "./api/stavecho";
import { chooseAvailableTestTarget } from "./api/test-generator";
import {
  HttpActraOAuthClient,
  OAUTH_CALLBACK_ACTION,
  OAUTH_CALLBACK_URI,
  OAUTH_REQUESTED_SCOPES,
  buildOAuthAuthorizationUrl,
  createOAuthState,
  expiresAt,
  isAccessTokenFresh,
  type OAuthTokenResponse
} from "./auth/oauth";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings/defaults";
import { ActraSettingTab } from "./settings/tab";
import { InboundSyncEngine } from "./sync/inbound/engine";
import { ACTRA_SYNC_TAG } from "./sync/markdown";
import { OutboundIndexer, automaticUploadDelay } from "./sync/outbound/indexer";
import type { ActraSettings, PairingClaim, PairingStatus, SyncJob } from "./types";
import { ActraError, safeUserError } from "./utils/errors";
import { createId } from "./utils/id";
import { assertWritePath, joinVaultPath, secureVaultPath } from "./utils/path";
import { ActraVaultService } from "./vault/service";

export default class ActraPlugin extends Plugin {
  settings: ActraSettings = structuredClone(DEFAULT_SETTINGS);
  private client!: ActraClient;
  private inboundEngine!: InboundSyncEngine;
  private outboundIndexer!: OutboundIndexer;
  private vaultService!: ActraVaultService;
  private statusBarEl!: HTMLElement;
  private settingTab: ActraSettingTab | null = null;
  private pairingCancelled = false;
  private oauthRefreshPromise: Promise<string | null> | null = null;
  private authGeneration = 0;
  private automaticUploadTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    if (!this.settings.pluginInstanceId) this.settings.pluginInstanceId = createId("plugin");
    if (!this.settings.deviceName) {
      this.settings.deviceName = `${Platform.isMobile ? "移动端" : "桌面端"} · ${this.app.vault.getName()}`;
    }
    if (
      (this.settings.connectionStatus === "CONNECTED" || this.settings.connectionStatus === "PAUSED")
      && !this.hasStoredCredentials()
      && !this.settings.developerMode
    ) {
      this.settings.connectionStatus = "REAUTH_REQUIRED";
    }
    await this.saveSettings();
    this.rebuildServices();
    this.registerObsidianProtocolHandler(OAUTH_CALLBACK_ACTION, (params) => void this.handleOAuthCallback(params));

    this.settingTab = new ActraSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addRibbonIcon("cloud-download", "ACTRA：立即拉取", () => void this.pullNow(true));
    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar();

    this.addCommand({
      id: "pull-now",
      name: "立即拉取待同步数据",
      callback: () => void this.pullNow(true)
    });
    this.addCommand({
      id: "update-authorized-index",
      name: "上传已授权目录的更新",
      callback: () => void this.indexNow()
    });

    this.registerVaultEvents();
    this.app.workspace.onLayoutReady(() => void this.onLayoutReady());
  }

  onunload(): void {
    this.pairingCancelled = true;
    this.clearAutomaticUploadTimer();
  }

  async saveSettings(): Promise<void> {
    // OAuth tokens, temporary state, and pairing codes are intentionally absent from this object.
    await this.saveData(this.settings);
    this.updateStatusBar();
  }

  rebuildServices(): void {
    this.client = this.settings.developerMode
      ? new MockActraClient()
      : new HttpActraClient(
        this.settings.apiBaseUrl,
        () => this.ensureAccessToken(),
        () => this.settings.oauthScope
      );
    this.vaultService = new ActraVaultService(this.app.vault, this.app.metadataCache);
    this.inboundEngine = new InboundSyncEngine(
      this.app.vault,
      this.app.fileManager,
      this.vaultService,
      this.settings,
      this.client,
      () => this.saveSettings()
    );
    this.outboundIndexer = new OutboundIndexer(this.app, this.settings, this.client, () => this.saveSettings());
  }

  isPulling(): boolean {
    return this.inboundEngine?.isRunning() ?? false;
  }

  hasUploadScope(): boolean {
    if (this.settings.developerMode) return true;
    return this.settings.oauthScope.split(/[\s,]+/).includes("upload");
  }

  async startOAuthAuthorization(scopes: readonly string[] = OAUTH_REQUESTED_SCOPES): Promise<void> {
    if (!this.settings.apiBaseUrl.trim()) {
      throw new ActraError("请先输入 ACTRA API 地址。", "INVALID_CONFIGURATION");
    }
    this.authGeneration += 1;
    const state = createOAuthState();
    const authorizationUrl = buildOAuthAuthorizationUrl(
      this.settings.apiBaseUrl,
      this.settings.oauthClientId,
      state,
      OAUTH_CALLBACK_URI,
      scopes
    );
    this.app.secretStorage.setSecret(
      this.oauthStateSecretId(),
      JSON.stringify({ state, createdAt: Date.now() })
    );
    this.settings.connectionStatus = "PENDING_CONFIRMATION";
    this.settings.lastError = "";
    window.open(authorizationUrl, "_blank", "noopener,noreferrer");
    await this.saveSettings();
  }

  async startPairing(pairingCode: string): Promise<void> {
    if (!this.settings.developerMode && !this.settings.apiBaseUrl) {
      throw new ActraError("请先在高级设置中填写 ACTRA 服务地址。", "INVALID_CONFIGURATION");
    }
    this.pairingCancelled = false;
    this.settings.connectionStatus = "CLAIMING";
    this.settings.lastError = "";
    await this.saveSettings();
    try {
      const claim = await this.client.claimPairing({
        pairingCode,
        pluginInstanceId: this.settings.pluginInstanceId,
        vaultName: this.app.vault.getName(),
        platform: Platform.isMobile ? "mobile" : "desktop",
        pluginVersion: this.manifest.version,
        requestedScopes: ["service.connect", "notes.create", "notes.update_managed"]
      });
      this.settings.pairingId = claim.pairingId;
      if (claim.status === "CONNECTED") {
        await this.completePairing(claim);
      } else {
        this.settings.connectionStatus = "PENDING_CONFIRMATION";
        await this.saveSettings();
        void this.pollPairing(claim.pairingId);
      }
    } catch (error) {
      this.settings.connectionStatus = "PAIRING_FAILED";
      this.settings.lastError = safeUserError(error);
      await this.saveSettings();
      throw error;
    }
  }

  async pullNow(showNotice = false): Promise<void> {
    try {
      const results = await this.inboundEngine.pull();
      const succeeded = results.filter((result) => result.status === "SUCCEEDED").length;
      const duplicates = results.filter((result) => result.status === "DUPLICATE").length;
      const conflicts = results.filter((result) => result.status === "CONFLICT").length;
      const failed = results.length - succeeded - duplicates - conflicts;
      if (showNotice) {
        const summary = [
          succeeded > 0 ? `已同步 ${succeeded} 项` : "",
          duplicates > 0 ? `${duplicates} 项已是最新` : "",
          conflicts > 0 ? `${conflicts} 项冲突已保护原文件` : "",
          failed > 0 ? `${failed} 项失败` : ""
        ].filter(Boolean).join("，");
        const firstError = results.find((result) => result.status !== "SUCCEEDED" && result.status !== "DUPLICATE")?.error;
        new Notice(
          results.length === 0
            ? "ACTRA 当前没有待同步数据。"
            : `ACTRA：${summary}。${firstError ? `原因：${firstError}` : ""}`,
          failed > 0 || conflicts > 0 ? 9000 : 6000
        );
      }
    } catch (error) {
      if (showNotice) new Notice(safeUserError(error), 7000);
    }
  }

  async indexNow(showNotice = true): Promise<void> {
    if (this.outboundIndexer.isRunning()) {
      if (showNotice) new Notice("Obsidian 笔记正在上传，请稍候。", 5000);
      return;
    }
    try {
      const result = await this.outboundIndexer.reconcile();
      if (showNotice) {
        const details = [
          result.indexed > 0 ? `已向 ACTRA 上传 ${result.indexed} 个文件` : "",
          result.unchanged > 0 ? `${result.unchanged} 个文件已是最新` : "",
          result.filtered > 0 ? `${result.filtered} 个 ACTRA 同步文件已过滤` : "",
          result.failed > 0 ? `${result.failed} 个文件失败` : ""
        ].filter(Boolean);
        new Notice(
          details.length > 0
            ? `${result.indexed === 0 && result.failed === 0 ? "没有需要上传的更新；" : ""}${details.join("，")}。`
            : "授权目录中没有可上传的 Markdown。",
          result.failed > 0 ? 8000 : 6000
        );
      }
    } catch (error) {
      this.settings.lastError = safeUserError(error);
      await this.saveSettings();
      if (showNotice) new Notice(this.settings.lastError, 7000);
    } finally {
      this.refreshAutomaticUploadSchedule();
    }
  }

  async setAutomaticUploadEnabled(enabled: boolean): Promise<void> {
    this.settings.automaticUploadEnabled = enabled;
    await this.saveSettings();
    this.refreshAutomaticUploadSchedule();
  }

  async setApiBaseUrl(value: string): Promise<{ changed: boolean; reauthorizationRequired: boolean; url: string }> {
    const nextUrl = value.trim() ? normalizeStavechoBaseUrl(value) : "";
    const currentUrl = this.settings.apiBaseUrl.trim()
      ? normalizeStavechoBaseUrl(this.settings.apiBaseUrl)
      : "";
    if (nextUrl === currentUrl) {
      this.settings.apiBaseUrl = nextUrl;
      await this.saveSettings();
      return { changed: false, reauthorizationRequired: false, url: nextUrl };
    }

    const reauthorizationRequired = this.settings.authMode !== "none"
      || this.settings.connectionStatus === "PENDING_CONFIRMATION"
      || this.hasStoredCredentials();
    this.authGeneration += 1;
    this.clearAutomaticUploadTimer();
    this.oauthRefreshPromise = null;
    this.app.secretStorage.setSecret(this.oauthStateSecretId(), "");
    if (reauthorizationRequired) {
      if (this.settings.tokenSecretId) this.app.secretStorage.setSecret(this.settings.tokenSecretId, "");
      if (this.settings.refreshTokenSecretId) this.app.secretStorage.setSecret(this.settings.refreshTokenSecretId, "");
      this.settings.vaultConnectionId = "";
      this.settings.pairingId = "";
      this.settings.authMode = "none";
      this.settings.oauthScope = "";
      this.settings.oauthAccessTokenExpiresAt = 0;
      this.settings.oauthRefreshTokenExpiresAt = 0;
      this.settings.connectionStatus = "REAUTH_REQUIRED";
      this.settings.paused = false;
      this.settings.completedJobs = {};
      this.settings.indexedDocuments = {};
      this.settings.lastIndexSyncAt = "";
      this.settings.lastError = "ACTRA 服务地址已更新，请使用新地址重新登录授权。";
    } else {
      this.settings.lastError = "";
    }
    this.settings.apiBaseUrl = nextUrl;
    await this.saveSettings();
    this.rebuildServices();
    return { changed: true, reauthorizationRequired, url: nextUrl };
  }

  refreshAutomaticUploadSchedule(): void {
    this.clearAutomaticUploadTimer();
    if (!this.canAutomaticallyUpload()) return;
    const delay = Math.max(1000, automaticUploadDelay(this.settings.lastIndexSyncAt));
    this.automaticUploadTimer = window.setTimeout(() => {
      this.automaticUploadTimer = null;
      if (this.outboundIndexer.isRunning()) {
        this.automaticUploadTimer = window.setTimeout(() => this.refreshAutomaticUploadSchedule(), 60_000);
        return;
      }
      void this.indexNow(false);
    }, delay);
  }

  async setPaused(paused: boolean): Promise<void> {
    this.settings.paused = paused;
    this.settings.connectionStatus = paused ? "PAUSED" : "CONNECTED";
    await this.saveSettings();
    this.refreshAutomaticUploadSchedule();
  }

  async revokeConnection(): Promise<void> {
    this.authGeneration += 1;
    if (this.settings.authMode !== "oauth" && this.settings.vaultConnectionId) {
      await this.client.revokeConnection(this.settings.vaultConnectionId);
    }
    if (this.settings.tokenSecretId) this.app.secretStorage.setSecret(this.settings.tokenSecretId, "");
    if (this.settings.refreshTokenSecretId) this.app.secretStorage.setSecret(this.settings.refreshTokenSecretId, "");
    this.app.secretStorage.setSecret(this.oauthStateSecretId(), "");
    this.settings.vaultConnectionId = "";
    this.settings.pairingId = "";
    this.settings.authMode = "none";
    this.settings.oauthScope = "";
    this.settings.oauthAccessTokenExpiresAt = 0;
    this.settings.oauthRefreshTokenExpiresAt = 0;
    this.settings.connectionStatus = "REVOKED";
    this.settings.paused = false;
    this.settings.lastError = "";
    this.settings.completedJobs = {};
    this.settings.indexedDocuments = {};
    this.clearAutomaticUploadTimer();
    // Local Markdown and mappings are retained by design.
    await this.saveSettings();
  }

  loadDemoJobs(): void {
    if (!(this.client instanceof MockActraClient)) {
      new Notice("请先开启本地演示模式。", 5000);
      return;
    }
    this.client.enqueue(createDemoJobs());
    this.settings.counters.pending += 2;
    void this.saveSettings();
  }

  async enqueueTestJob(job: SyncJob): Promise<string> {
    if (!(this.client instanceof MockActraClient)) {
      throw new ActraError("测试数据生成器仅在本地演示模式下可用。", "INVALID_CONFIGURATION");
    }
    const mapping = this.settings.mappings[job.actraId];
    let targetPath: string;
    if (mapping && mapping.vaultConnectionId === this.settings.vaultConnectionId) {
      if (job.revision <= mapping.lastRevision) {
        throw new ActraError(
          `对象 ${job.actraId} 当前版本为 ${mapping.lastRevision}；测试更新时请输入更高版本号。`,
          "INVALID_CONFIGURATION"
        );
      }
      targetPath = assertWritePath(mapping.filePath, this.settings.writeRoot);
    } else {
      const preferredPath = this.vaultService.targetFor(job, this.settings.writeRoot);
      const appendTitle = job.type === "daily_summary" || job.type === "exercise" || job.type === "task_collection";
      targetPath = assertWritePath(
        chooseAvailableTestTarget(
          preferredPath,
          job.content.title,
          appendTitle,
          (path) => this.vaultService.pathExists(path)
        ),
        this.settings.writeRoot
      );
      job.targetPath = targetPath;
    }
    this.client.enqueue([job]);
    this.settings.counters.pending += 1;
    await this.saveSettings();
    return targetPath;
  }

  async revokeReadRoot(root: string): Promise<void> {
    try {
      await this.outboundIndexer.revokeRoot(root);
    } catch (error) {
      this.settings.lastError = `本地授权已移除；停止上传时发生错误：${safeUserError(error)}`;
      await this.saveSettings();
      new Notice(this.settings.lastError, 8000);
    }
  }

  async exportDiagnostics(): Promise<string> {
    const root = secureVaultPath(this.settings.writeRoot, "folder");
    const diagnosticsRoot = joinVaultPath(root, "诊断");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let path = assertWritePath(joinVaultPath(diagnosticsRoot, `ACTRA-diagnostics-${stamp}.json.md`), root);
    let suffix = 2;
    while (this.vaultService.pathExists(path)) {
      path = assertWritePath(joinVaultPath(diagnosticsRoot, `ACTRA-diagnostics-${stamp}-${suffix}.json.md`), root);
      suffix += 1;
    }
    const redacted = {
      generatedAt: new Date().toISOString(),
      pluginVersion: this.manifest.version,
      appVersion: apiVersion,
      vaultName: this.app.vault.getName(),
      pluginInstanceId: this.settings.pluginInstanceId,
      connectionIdSuffix: this.settings.vaultConnectionId.slice(-8),
      connectionStatus: this.settings.connectionStatus,
      writeRoot: this.settings.writeRoot,
      readRoots: this.settings.readRoots,
      permissions: this.settings.permissions,
      counters: this.settings.counters,
      lastSuccessfulSyncAt: this.settings.lastSuccessfulSyncAt,
      lastIndexSyncAt: this.settings.lastIndexSyncAt,
      lastError: this.settings.lastError,
      mappingCount: Object.keys(this.settings.mappings).length,
      indexedDocumentCount: Object.keys(this.settings.indexedDocuments).length,
      locallyRemovedCount: this.settings.locallyRemoved.length,
      pendingIndexCleanupRoots: this.settings.pendingIndexCleanupRoots
    };
    await this.vaultService.ensureParentFolders(path, root);
    await this.app.vault.create(path, `\`\`\`json\n${JSON.stringify(redacted, null, 2)}\n\`\`\`\n`);
    return path;
  }

  private getAccessToken(): string | null {
    if (!this.settings.tokenSecretId) return null;
    return this.app.secretStorage.getSecret(this.settings.tokenSecretId);
  }

  private getRefreshToken(): string | null {
    if (!this.settings.refreshTokenSecretId) return null;
    return this.app.secretStorage.getSecret(this.settings.refreshTokenSecretId);
  }

  private hasStoredCredentials(): boolean {
    if (this.getAccessToken()) return true;
    return this.settings.authMode === "oauth" && Boolean(this.getRefreshToken());
  }

  private oauthStateSecretId(): string {
    return `actra-oauth-state-${this.settings.pluginInstanceId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  }

  private async ensureAccessToken(): Promise<string | null> {
    const accessToken = this.getAccessToken();
    if (this.settings.authMode !== "oauth") return accessToken;
    if (accessToken && isAccessTokenFresh(this.settings.oauthAccessTokenExpiresAt)) return accessToken;
    if (!this.oauthRefreshPromise) {
      const generation = this.authGeneration;
      this.oauthRefreshPromise = this.refreshOAuthToken(generation).finally(() => {
        this.oauthRefreshPromise = null;
      });
    }
    return this.oauthRefreshPromise;
  }

  private async refreshOAuthToken(generation: number): Promise<string> {
    const refreshToken = this.getRefreshToken();
    if (
      !refreshToken
      || (this.settings.oauthRefreshTokenExpiresAt > 0 && this.settings.oauthRefreshTokenExpiresAt <= Date.now())
    ) {
      this.settings.connectionStatus = "REAUTH_REQUIRED";
      this.settings.lastError = "ACTRA 授权已过期，请重新登录授权。";
      await this.saveSettings();
      this.settingTab?.display();
      throw new ActraError(this.settings.lastError, "REAUTH_REQUIRED");
    }
    try {
      const token = await new HttpActraOAuthClient(this.settings.apiBaseUrl)
        .refresh(refreshToken, this.settings.oauthClientId);
      if (generation !== this.authGeneration || this.settings.authMode !== "oauth") {
        throw new ActraError("OAuth 刷新已取消。", "REQUEST_CANCELLED");
      }
      await this.storeOAuthTokens(token);
      return token.accessToken;
    } catch (error) {
      if (error instanceof ActraError && (error.code === "OAUTH_TOKEN_REJECTED" || error.code === "REAUTH_REQUIRED")) {
        this.settings.connectionStatus = "REAUTH_REQUIRED";
        this.settings.lastError = "ACTRA 授权已失效，请重新登录授权。";
        await this.saveSettings();
        this.settingTab?.display();
      }
      throw error;
    }
  }

  private async handleOAuthCallback(params: ObsidianProtocolData): Promise<void> {
    const code = typeof params.code === "string" ? params.code : "";
    const returnedState = typeof params.state === "string" ? params.state : "";
    const pendingValue = this.app.secretStorage.getSecret(this.oauthStateSecretId());
    let pending: { state: string; createdAt: number } | null = null;
    try {
      pending = pendingValue ? JSON.parse(pendingValue) as { state: string; createdAt: number } : null;
    } catch {
      pending = null;
    }
    if (
      !returnedState
      || !pending
      || returnedState !== pending.state
      || !Number.isFinite(pending.createdAt)
      || pending.createdAt > Date.now() + 60_000
      || Date.now() - pending.createdAt > 15 * 60 * 1000
    ) {
      this.settings.connectionStatus = "PAIRING_FAILED";
      this.settings.lastError = "ACTRA OAuth 回调无效或已过期，请重新授权。";
      await this.saveSettings();
      this.settingTab?.display();
      new Notice(this.settings.lastError, 7000);
      return;
    }
    const callbackError = typeof params.error === "string"
      ? params.error
      : typeof params.err_msg === "string" ? params.err_msg : "";
    if (callbackError) {
      this.app.secretStorage.setSecret(this.oauthStateSecretId(), "");
      this.settings.connectionStatus = "REJECTED";
      this.settings.lastError = `ACTRA 授权未完成：${safeUserError(callbackError)}`;
      await this.saveSettings();
      this.settingTab?.display();
      new Notice(this.settings.lastError, 7000);
      return;
    }
    if (!code) {
      this.settings.connectionStatus = "PAIRING_FAILED";
      this.settings.lastError = "ACTRA OAuth 回调缺少授权码，请重新授权。";
      await this.saveSettings();
      this.settingTab?.display();
      new Notice(this.settings.lastError, 7000);
      return;
    }
    this.app.secretStorage.setSecret(this.oauthStateSecretId(), "");
    this.settings.connectionStatus = "CLAIMING";
    this.settings.lastError = "";
    await this.saveSettings();
    try {
      const token = await new HttpActraOAuthClient(this.settings.apiBaseUrl)
        .exchangeAuthorizationCode(code, this.settings.oauthClientId, OAUTH_CALLBACK_URI);
      await this.completeOAuthAuthorization(token);
    } catch (error) {
      this.settings.connectionStatus = "PAIRING_FAILED";
      this.settings.lastError = safeUserError(error);
      await this.saveSettings();
      this.settingTab?.display();
      new Notice(this.settings.lastError, 7000);
    }
  }

  private async storeOAuthTokens(token: OAuthTokenResponse): Promise<void> {
    if (!this.settings.tokenSecretId) {
      this.settings.tokenSecretId = createId("actra-token").replace(/_/g, "-");
    }
    if (!this.settings.refreshTokenSecretId) {
      this.settings.refreshTokenSecretId = createId("actra-refresh-token").replace(/_/g, "-");
    }
    this.app.secretStorage.setSecret(this.settings.tokenSecretId, token.accessToken);
    this.app.secretStorage.setSecret(this.settings.refreshTokenSecretId, token.refreshToken);
    this.settings.oauthAccessTokenExpiresAt = expiresAt(token.expiresIn);
    this.settings.oauthRefreshTokenExpiresAt = expiresAt(token.refreshExpiresIn);
    this.settings.oauthScope = token.scope.trim().split(/[\s,]+/).filter(Boolean).join(" ");
    await this.saveSettings();
  }

  private async completeOAuthAuthorization(token: OAuthTokenResponse): Promise<void> {
    const previousConnectionId = this.settings.vaultConnectionId;
    this.settings.authMode = "oauth";
    this.settings.pairingId = "";
    this.settings.vaultConnectionId = createId("oauth");
    if (previousConnectionId && previousConnectionId !== this.settings.vaultConnectionId) {
      this.settings.completedJobs = {};
      this.settings.indexedDocuments = {};
    }
    await this.storeOAuthTokens(token);
    this.settings.connectionStatus = "CONFIGURATION_REQUIRED";
    await this.saveSettings();
    this.rebuildServices();
    await this.performConnectionWriteTest();
    this.settings.connectionStatus = "CONNECTED";
    this.settings.lastError = "";
    await this.saveSettings();
    this.refreshAutomaticUploadSchedule();
    this.settingTab?.display();
    new Notice("ACTRA 授权完成，正在首次同步数据。", 7000);
    await this.pullNow(false);
    this.settingTab?.display();
  }

  private async completePairing(data: PairingClaim | PairingStatus): Promise<void> {
    if (!data.vaultConnectionId || !data.accessToken) {
      throw new ActraError("ACTRA 未返回完整连接凭据。", "PAIRING_FAILED");
    }
    if (!this.settings.tokenSecretId) {
      this.settings.tokenSecretId = createId("actra-token").replace(/_/g, "-");
    }
    const previousConnectionId = this.settings.vaultConnectionId;
    this.app.secretStorage.setSecret(this.settings.tokenSecretId, data.accessToken);
    if (this.settings.refreshTokenSecretId) this.app.secretStorage.setSecret(this.settings.refreshTokenSecretId, "");
    this.settings.authMode = "pairing";
    this.settings.oauthScope = "";
    this.settings.oauthAccessTokenExpiresAt = 0;
    this.settings.oauthRefreshTokenExpiresAt = 0;
    this.settings.vaultConnectionId = data.vaultConnectionId;
    if (previousConnectionId && previousConnectionId !== data.vaultConnectionId) {
      this.settings.completedJobs = {};
      this.settings.indexedDocuments = {};
    }
    this.settings.connectionStatus = "CONFIGURATION_REQUIRED";
    await this.saveSettings();
    await this.performConnectionWriteTest();
    this.settings.connectionStatus = "CONNECTED";
    this.settings.lastError = "";
    await this.saveSettings();
    this.rebuildServices();
    this.refreshAutomaticUploadSchedule();
    new Notice("ACTRA 已连接，并已通过本地写入测试。", 7000);
  }

  private async pollPairing(pairingId: string): Promise<void> {
    for (let attempt = 0; attempt < 150 && !this.pairingCancelled; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const status = await this.client.getPairingStatus(pairingId);
        if (status.status === "CONNECTED") {
          await this.completePairing(status);
          return;
        }
        if (status.status === "REJECTED" || status.status === "EXPIRED") {
          this.settings.connectionStatus = status.status === "REJECTED" ? "REJECTED" : "PAIRING_FAILED";
          this.settings.lastError = status.status === "REJECTED" ? "ACTRA App 已拒绝此次连接。" : "配对码已过期。";
          await this.saveSettings();
          return;
        }
      } catch (error) {
        this.settings.lastError = safeUserError(error);
        await this.saveSettings();
      }
    }
    if (!this.pairingCancelled) {
      this.settings.connectionStatus = "PAIRING_FAILED";
      this.settings.lastError = "等待 ACTRA App 确认超时，请重新生成配对码。";
      await this.saveSettings();
    }
  }

  private async performConnectionWriteTest(): Promise<void> {
    const root = secureVaultPath(this.settings.writeRoot, "folder");
    const base = joinVaultPath(root, "连接测试.md");
    let path = assertWritePath(base, root);
    if (this.vaultService.pathExists(path)) {
      path = assertWritePath(joinVaultPath(root, `连接测试-${Date.now()}.md`), root);
    }
    await this.vaultService.ensureParentFolders(path, root);
    await this.app.vault.create(
      path,
      `---\nactra_connection_test: true\nactra_managed: true\ncreated_at: ${JSON.stringify(new Date().toISOString())}\n---\n\n# ACTRA 连接测试\n\n本文件证明插件已成功写入当前 Vault。解除连接后，本文件仍会保留。\n`
    );
  }

  private async onLayoutReady(): Promise<void> {
    if (this.settings.connectionStatus !== "CONNECTED" || this.settings.paused) return;
    await this.ensureActraSyncTags();
    try {
      if (this.settings.authMode !== "oauth" && this.settings.vaultConnectionId) {
        await this.client.sessionOpen(this.settings.vaultConnectionId);
      }
    } catch (error) {
      this.settings.lastError = safeUserError(error);
      await this.saveSettings();
    }
    if (this.settings.pullOnObsidianOpen) await this.pullNow(false);
    this.refreshAutomaticUploadSchedule();
  }

  private async ensureActraSyncTags(): Promise<void> {
    const root = secureVaultPath(this.settings.writeRoot, "folder");
    let encounteredError = false;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(`${root}/`)) continue;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (typeof frontmatter?.actra_id !== "string") continue;
      const currentTags = Array.isArray(frontmatter.tags)
        ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
        : typeof frontmatter.tags === "string"
          ? frontmatter.tags.split(/[ ,]+/).filter(Boolean)
          : [];
      if (currentTags.includes(ACTRA_SYNC_TAG)) continue;
      try {
        await this.app.fileManager.processFrontMatter(file, (properties) => {
          const tags = Array.isArray(properties.tags)
            ? properties.tags.filter((tag: unknown): tag is string => typeof tag === "string")
            : typeof properties.tags === "string"
              ? properties.tags.split(/[ ,]+/).filter(Boolean)
              : [];
          properties.tags = Array.from(new Set([...tags, "actra", ACTRA_SYNC_TAG]));
        });
      } catch (error) {
        encounteredError = true;
        this.settings.lastError = safeUserError(error);
      }
    }
    if (encounteredError) await this.saveSettings();
  }

  private registerVaultEvents(): void {
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      for (const mapping of Object.values(this.settings.mappings)) {
        if (mapping.filePath === oldPath) mapping.filePath = file.path;
      }
      void this.saveSettings();
      void this.outboundIndexer.handleRename(file, oldPath);
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      for (const mapping of Object.values(this.settings.mappings)) {
        if (mapping.filePath === file.path && !this.settings.locallyRemoved.includes(mapping.actraId)) {
          this.settings.locallyRemoved.push(mapping.actraId);
        }
      }
      void this.saveSettings();
      void this.outboundIndexer.handleLocalDelete(file.path);
    }));
  }

  private canAutomaticallyUpload(): boolean {
    return this.settings.automaticUploadEnabled
      && this.settings.connectionStatus === "CONNECTED"
      && !this.settings.paused
      && this.hasUploadScope()
      && this.settings.permissions.readAuthorizedNotes
      && this.settings.readRoots.length > 0;
  }

  private clearAutomaticUploadTimer(): void {
    if (this.automaticUploadTimer === null) return;
    window.clearTimeout(this.automaticUploadTimer);
    this.automaticUploadTimer = null;
  }

  private updateStatusBar(): void {
    if (!this.statusBarEl) return;
    const labels: Record<string, string> = {
      CONNECTED: "ACTRA 已连接",
      PAUSED: "ACTRA 已暂停",
      OFFLINE: "ACTRA 离线",
      REAUTH_REQUIRED: "ACTRA 需重新认证"
    };
    this.statusBarEl.setText(labels[this.settings.connectionStatus] ?? "ACTRA 未连接");
  }
}
