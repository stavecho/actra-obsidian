import { App, Notice, PluginSettingTab, Setting, type ButtonComponent } from "obsidian";
import { ACTRA_OAUTH_CLIENT_ID, OAUTH_CALLBACK_URI, OAUTH_REQUESTED_SCOPES, OAUTH_SCOPE_DETAILS } from "../auth/oauth";
import { normalizeStavechoBaseUrl, STAVECHO_API_ORIGIN } from "../api/stavecho";
import type ActraPlugin from "../main";
import { safeUserError } from "../utils/errors";
import { ConfirmModal, FolderPickerModal } from "../ui/modals";

const STATUS_LABELS = {
  UNPAIRED: "未连接",
  CLAIMING: "正在交换授权凭据",
  PENDING_CONFIRMATION: "等待完成 ACTRA 授权",
  CONFIGURATION_REQUIRED: "需要完成配置",
  CONNECTED: "已连接",
  PAIRING_FAILED: "授权失败",
  REJECTED: "已拒绝",
  PAUSED: "已暂停",
  REAUTH_REQUIRED: "需要重新认证",
  OFFLINE: "离线",
  REVOKED: "已解除连接"
} as const;

function formatTime(value: string): string {
  if (!value) return "尚无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚无记录" : date.toLocaleString();
}

export class ActraSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ActraPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.removeClass("actra-settings");
    const pageEl = containerEl.createDiv({ cls: "actra-settings" });

    this.renderConnection(pageEl);
    if (this.plugin.settings.connectionStatus === "CONNECTED" || this.plugin.settings.connectionStatus === "PAUSED") {
      this.renderSyncStatus(pageEl);
    }
    this.renderDataSyncSettings(pageEl);
    this.renderAdvanced(pageEl);
  }

  private renderConnection(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const connected = settings.connectionStatus === "CONNECTED" || settings.connectionStatus === "PAUSED";
    let connectButton: ButtonComponent | null = null;
    const group = this.createSettingsSection(containerEl, "连接");
    const card = group.createDiv({ cls: "actra-status-card actra-group-row" });
    const top = card.createDiv({ cls: "actra-status-row" });
    top.createSpan({ text: STATUS_LABELS[settings.connectionStatus], cls: `actra-status actra-status-${settings.connectionStatus.toLowerCase()}` });
    if (settings.lastError) {
      card.createEl("p", {
        text: settings.lastError,
        cls: "actra-error"
      });
    }

    let draftApiBaseUrl = settings.apiBaseUrl === STAVECHO_API_ORIGIN ? "" : settings.apiBaseUrl;
    new Setting(group)
      .setName("ACTRA 认证与 API 地址")
      .setDesc(`OAuth 登录、Token 刷新、数据拉取和上传都使用此地址。留空时使用 ${STAVECHO_API_ORIGIN}。生产地址必须使用 HTTPS。`)
      .addText((text) => text
        .setPlaceholder(STAVECHO_API_ORIGIN)
        .setValue(draftApiBaseUrl)
        .onChange((value) => { draftApiBaseUrl = value; }))
      .addButton((button) => button.setButtonText("保存地址").onClick(async () => {
        try {
          const nextUrl = normalizeStavechoBaseUrl(draftApiBaseUrl);
          const currentUrl = normalizeStavechoBaseUrl(settings.apiBaseUrl);
          if (nextUrl !== currentUrl && connected) {
            const confirmed = await ConfirmModal.ask(
              this.app,
              "更改 ACTRA 服务地址？",
              "保存后会清除当前地址的本地登录凭据并停止同步。你需要通过新地址重新登录授权；本地 Markdown 会保留。",
              "更改并重新授权"
            );
            if (!confirmed) return;
          }
          const result = await this.plugin.setApiBaseUrl(draftApiBaseUrl);
          new Notice(
            result.reauthorizationRequired
              ? `已切换至 ${result.url}，请重新登录授权。`
              : result.changed ? `ACTRA 服务地址已保存：${result.url}` : `当前使用：${result.url}`,
            7000
          );
          this.display();
        } catch (error) {
          new Notice(safeUserError(error), 7000);
        }
      }));

    if (!settings.developerMode && !connected) {
      const steps = group.createEl("ol", { cls: "actra-connection-steps" });
      steps.createEl("li", { text: "确认 ACTRA 服务地址；正式 OAuth Client ID 已预填。" });
      steps.createEl("li", { text: "点击连接按钮，在浏览器中使用 ACTRA 账户邮箱接收验证码；这里不需要 Obsidian 账户。" });
      steps.createEl("li", { text: "浏览器返回 Obsidian 后，插件会验证写入并首次拉取 ACTRA 数据。" });
      steps.createEl("li", { text: "如需 ACTRA 获取本地笔记，再单独选择目录；自动上传默认每 24 小时运行，也可关闭后使用“立即上传”。" });
      const permissionGuide = group.createDiv({ cls: "actra-oauth-guide" });
      permissionGuide.createEl("h3", { text: "授权后数据如何流动" });
      permissionGuide.createEl("p", {
        text: "授权页中的邮箱是你的 ACTRA 登录邮箱。每项权限的同步方向如下：",
        cls: "setting-item-description"
      });
      const scopeList = permissionGuide.createEl("ul", { cls: "actra-oauth-scope-list" });
      for (const detail of OAUTH_SCOPE_DETAILS) {
        const item = scopeList.createEl("li");
        item.createEl("strong", { text: `${detail.label} · ${detail.direction}` });
        item.createSpan({ text: detail.description });
      }
      group.createEl("p", {
        text: "OAuth Token 只保存在 Obsidian 钥匙串中，不会写入插件 data.json。",
        cls: "setting-item-description actra-connection-help"
      });
      const updateConnectButton = (): void => {
        connectButton?.setDisabled(!settings.oauthClientId);
      };
      new Setting(group)
        .setName("OAuth Client ID")
        .setDesc("已预填 Actra 正式应用标识。只有连接其他 ACTRA 服务时才需要修改；这不是 Client Secret。")
        .addText((text) => text
          .setPlaceholder(ACTRA_OAUTH_CLIENT_ID)
          .setValue(settings.oauthClientId)
          .onChange(async (value) => {
            settings.oauthClientId = value.trim();
            updateConnectButton();
            await this.plugin.saveSettings();
          }));
    }

    if (!connected) {
      new Setting(group)
        .setName("连接 ACTRA 与 Obsidian")
        .setDesc(`使用 ACTRA 账户登录，并确认 ${OAUTH_REQUESTED_SCOPES.join("、")} 权限。dailylog、note、recording 用于拉取 ACTRA 数据；upload 用于上传你单独授权的本地笔记。`)
        .addButton((button) => {
          connectButton = button;
          button.setButtonText(settings.connectionStatus === "PENDING_CONFIRMATION" ? "重新打开 ACTRA 授权页" : "使用 ACTRA 账户连接")
            .setCta()
            .setDisabled(!settings.oauthClientId)
            .onClick(async () => {
              button.setDisabled(true).setButtonText("正在打开…");
              try {
                await this.plugin.startOAuthAuthorization();
              } catch (error) {
                new Notice(safeUserError(error), 7000);
              } finally {
                this.display();
              }
            });
        });
    } else {
      new Setting(group)
        .setName(settings.paused ? "同步已暂停" : "同步运行中")
        .setDesc(settings.paused ? "本地文件保持不变；服务端任务继续等待。" : "启动时拉取与手动拉取均已可用。")
        .addButton((button) => button
          .setButtonText(settings.paused ? "恢复同步" : "暂停同步")
          .onClick(async () => {
            await this.plugin.setPaused(!settings.paused);
            this.display();
          }))
        .addButton((button) => button
          .setButtonText("解除连接")
          .setWarning()
          .onClick(async () => {
            const confirmed = await ConfirmModal.ask(
              this.app,
              "解除 ACTRA 连接？",
              settings.authMode === "oauth"
                ? "这会清除插件本地保存的 OAuth 凭据并停止同步。本地已创建的 Markdown 将完整保留。"
                : "这会撤销当前连接并停止同步。本地已创建的 Markdown 将完整保留。",
              "解除连接",
              true
            );
            if (!confirmed) return;
            try {
              await this.plugin.revokeConnection();
              this.display();
            } catch (error) {
              new Notice(`解除连接失败：${safeUserError(error)}`, 7000);
            }
          }));
      if (settings.authMode === "oauth" && !this.plugin.hasUploadScope()) {
        new Setting(group)
          .setName("未授予 upload 权限")
          .setDesc("ACTRA 数据仍可拉取，但本地授权笔记不能上传。可重新授权并勾选 upload。")
          .addButton((button) => button
            .setButtonText("重新授权")
            .onClick(async () => {
              button.setDisabled(true).setButtonText("正在打开…");
              try {
                await this.plugin.startOAuthAuthorization();
              } catch (error) {
                new Notice(safeUserError(error), 7000);
              } finally {
                this.display();
              }
            }));
      }
    }
  }

  private renderDataSyncSettings(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const group = this.createSettingsSection(containerEl, "数据同步");
    group.addClass("actra-data-sync-group");

    const pullGroup = group.createEl("section", { cls: "actra-sync-subgroup" });
    pullGroup.createDiv({ text: "从 ACTRA 同步", cls: "actra-sync-direction" });
    new Setting(pullGroup)
      .setName("打开 Obsidian 时自动拉取")
      .setDesc("每次会话布局初始化完成后拉取一次；不会常驻轮询。")
      .addToggle((toggle) => toggle.setValue(settings.pullOnObsidianOpen).onChange(async (value) => {
        settings.pullOnObsidianOpen = value;
        await this.plugin.saveSettings();
      }));

    const uploadGroup = group.createEl("section", { cls: "actra-sync-subgroup" });
    uploadGroup.createDiv({ text: "同步至 ACTRA", cls: "actra-sync-direction" });
    uploadGroup.createEl("p", {
      text: "默认不读取任何已有笔记。只有你选择的目录及其子目录可上传；笔记中的链接不会扩大读取范围。",
      cls: "setting-item-description actra-group-intro"
    });

    const roots = uploadGroup.createDiv({ cls: "actra-root-list" });
    if (settings.readRoots.length === 0) {
      roots.createDiv({ text: "未授权任何目录", cls: "actra-empty-state" });
    }
    for (const root of settings.readRoots) {
      const row = roots.createDiv({ cls: "actra-root-row" });
      row.createSpan({ text: root, cls: "actra-root-path" });
      const remove = row.createEl("button", { text: "移除", cls: "mod-warning" });
      remove.addEventListener("click", () => void this.removeRoot(root));
    }

    new Setting(uploadGroup)
      .setName("读取目录")
      .setDesc("选择后将先显示用途确认，不会上传绝对路径。")
      .addButton((button) => button.setButtonText("添加读取目录").onClick(() => {
        new FolderPickerModal(this.app, settings.readRoots, (folder) => void this.confirmAddRoot(folder.path)).open();
      }));

    new Setting(uploadGroup)
      .setName("每 24 小时自动上传")
      .addToggle((toggle) => toggle
        .setValue(settings.automaticUploadEnabled)
        .setDisabled(
          !this.plugin.hasUploadScope()
          || settings.connectionStatus !== "CONNECTED"
        )
        .onChange(async (value) => {
          await this.plugin.setAutomaticUploadEnabled(value);
          this.display();
        }));
  }

  private renderSyncStatus(containerEl: HTMLElement): void {
    const settings = this.plugin.settings;
    const group = this.createSettingsSection(containerEl, "同步状态");
    new Setting(group)
      .setName("最近处理成功")
      .setDesc(formatTime(settings.lastSuccessfulSyncAt))
      .addButton((button) => button
        .setButtonText(this.plugin.isPulling() ? "拉取中…" : "立即拉取")
        .setCta()
        .setDisabled(settings.connectionStatus !== "CONNECTED" || this.plugin.isPulling())
        .onClick(async () => {
          button.setDisabled(true).setButtonText("拉取中…");
          await this.plugin.pullNow(true);
          this.display();
        }));

    new Setting(group)
      .setName("最近本地数据上传")
      .setDesc(formatTime(settings.lastIndexSyncAt))
      .addButton((button) => button
        .setButtonText("立即上传")
        .setCta()
        .setDisabled(
          !this.plugin.hasUploadScope()
          || !settings.permissions.readAuthorizedNotes
          || settings.readRoots.length === 0
          || settings.connectionStatus !== "CONNECTED"
        )
        .onClick(async () => {
          button.setDisabled(true).setButtonText("上传中…");
          await this.plugin.indexNow();
          this.display();
        }));

    const metrics = group.createDiv({ cls: "actra-metrics" });
    this.metric(metrics, "累计成功", settings.counters.succeeded);
    this.metric(metrics, "累计失败", settings.counters.failed);
    this.metric(metrics, "其中冲突", settings.counters.conflicts);
  }

  private renderAdvanced(containerEl: HTMLElement): void {
    const group = this.createSettingsSection(containerEl, "高级与诊断");
    new Setting(group)
      .setName("OAuth 回调地址")
      .setDesc("ACTRA 服务端必须为插件的 Client ID 精确登记此回调地址。")
      .addText((text) => text.setValue(OAUTH_CALLBACK_URI).setDisabled(true));

    new Setting(group)
      .setName("诊断信息")
      .setDesc("在 ACTRA 目录中创建已脱敏的 JSON；不包含 Token、配对码或笔记正文。")
      .addButton((button) => button.setButtonText("导出诊断信息").onClick(async () => {
        button.setDisabled(true).setButtonText("导出中…");
        try {
          const path = await this.plugin.exportDiagnostics();
          new Notice(`诊断信息已写入 ${path}`, 6000);
        } catch (error) {
          new Notice(`导出诊断信息失败：${safeUserError(error)}`, 7000);
        } finally {
          button.setDisabled(false).setButtonText("导出诊断信息");
        }
      }));

  }

  private async confirmAddRoot(path: string): Promise<void> {
    const settings = this.plugin.settings;
    const count = this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${path}/`)).length;
    const uploadMessage = settings.automaticUploadEnabled
      ? "自动上传已开启，授权后会立即上传一次，之后每 24 小时检查更新。"
      : "自动上传已关闭；授权后仍可点击“立即上传”。";
    const confirmed = await ConfirmModal.ask(
      this.app,
      "授权读取目录？",
      `ACTRA 将获准读取“${path}”及其子目录中的 ${count} 个 Markdown。${uploadMessage}写入权限不会因此改变。`,
      "授权此目录"
    );
    if (!confirmed) return;
    settings.readRoots = [...settings.readRoots, path];
    settings.permissions.readAuthorizedNotes = true;
    await this.plugin.saveSettings();
    this.plugin.refreshAutomaticUploadSchedule();
    if (settings.automaticUploadEnabled) await this.plugin.indexNow(true);
    this.display();
  }

  private async removeRoot(root: string): Promise<void> {
    const hadRemoteIndex = Object.keys(this.plugin.settings.indexedDocuments)
      .some((path) => path === root || path.startsWith(`${root}/`));
    const confirmed = await ConfirmModal.ask(
      this.app,
      "移除读取授权？",
      `插件会立即停止读取和上传“${root}”。当前 ACTRA 接口不能删除此前已上传的副本；本地文件不会被修改或删除。`,
      "移除授权",
      true
    );
    if (!confirmed) return;
    this.plugin.settings.readRoots = this.plugin.settings.readRoots.filter((value) => value !== root);
    if (this.plugin.settings.readRoots.length === 0) {
      this.plugin.settings.permissions.readAuthorizedNotes = false;
    }
    await this.plugin.saveSettings();
    if (hadRemoteIndex) {
      await this.plugin.revokeReadRoot(root);
    }
    this.plugin.refreshAutomaticUploadSchedule();
    this.display();
  }

  private metric(parent: HTMLElement, label: string, value: number): void {
    const item = parent.createDiv({ cls: "actra-metric" });
    item.createEl("strong", { text: String(value) });
    item.createSpan({ text: label });
  }

  private createSettingsSection(parent: HTMLElement, title: string): HTMLElement {
    parent.createEl("h2", { text: title, cls: "actra-section-title" });
    return parent.createDiv({ cls: "actra-settings-group" });
  }
}
