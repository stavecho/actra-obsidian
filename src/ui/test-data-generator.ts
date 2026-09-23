import { App, Modal, Notice, Setting } from "obsidian";
import {
  createTestJob,
  defaultTestJobDraft,
  TEST_JOB_TYPE_LABELS,
  type TestJobDraft
} from "../api/test-generator";
import type { ActraNoteType, SyncJob } from "../types";
import { safeUserError } from "../utils/errors";

export class TestDataGeneratorModal extends Modal {
  private readonly draft: TestJobDraft = defaultTestJobDraft();

  constructor(
    app: App,
    private readonly onGenerate: (job: SyncJob) => Promise<string>
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("actra-generator-modal");
    this.titleEl.setText("ACTRA 测试数据生成器");
    this.contentEl.createEl("p", {
      text: "这里模拟 ACTRA 服务端创建一条待同步任务。生成后回到设置页点击“立即拉取”，Obsidian 才会写入 Markdown。",
      cls: "actra-modal-description"
    });

    new Setting(this.contentEl)
      .setName("内容类型")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(TEST_JOB_TYPE_LABELS)) dropdown.addOption(value, label);
        dropdown.setValue(this.draft.type).onChange((value) => {
          this.draft.type = value as ActraNoteType;
        });
      });

    this.addText("标题", "例如：产品复盘会议", "title");
    this.addText("日期", "YYYY-MM-DD", "date");
    this.addText("项目", "可选", "project");
    this.addText("标签", "用逗号分隔，例如 meeting, actra", "tags");
    this.addText("ACTRA 对象 ID", "留空自动生成；更新测试时填写同一个 ID", "actraId");
    this.addText("版本号", "同一对象更新时必须递增", "revision");
    this.addTextArea("AI 总结", "可选，会写入受控区块", "summary", 3);
    this.addTextArea("正文", "可选，适合对话、灵感和普通记录", "body", 4);
    this.addTextArea("录音转写", "可选，适合录音与会议类型", "transcript", 4);
    this.addText("录音链接", "可选，只接受 HTTPS 链接", "audioUrl");
    this.addTextArea(
      "待办",
      "每行一项；格式：[ ] 内容 | YYYY-MM-DD，完成项使用 [x]",
      "tasks",
      4
    );

    const actions = new Setting(this.contentEl).setClass("actra-generator-actions");
    actions.addButton((button) => button.setButtonText("取消").onClick(() => this.close()));
    actions.addButton((button) => button
      .setButtonText("生成待同步任务")
      .setCta()
      .onClick(async () => {
        button.setDisabled(true).setButtonText("生成中…");
        try {
          const job = createTestJob(this.draft);
          const targetPath = await this.onGenerate(job);
          new Notice(`已模拟 ACTRA 生成“${job.content.title}”，目标为 ${targetPath}；请点击“立即拉取”。`, 8000);
          this.close();
        } catch (error) {
          new Notice(safeUserError(error), 7000);
          button.setDisabled(false).setButtonText("生成待同步任务");
        }
      }));
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private addText(
    name: string,
    placeholder: string,
    key: "title" | "date" | "project" | "tags" | "actraId" | "revision" | "audioUrl"
  ): void {
    new Setting(this.contentEl)
      .setName(name)
      .addText((text) => text
        .setPlaceholder(placeholder)
        .setValue(this.draft[key])
        .onChange((value) => { this.draft[key] = value; }));
  }

  private addTextArea(
    name: string,
    description: string,
    key: "summary" | "body" | "transcript" | "tasks",
    rows: number
  ): void {
    new Setting(this.contentEl)
      .setName(name)
      .setDesc(description)
      .addTextArea((text) => {
        text.setValue(this.draft[key]).onChange((value) => { this.draft[key] = value; });
        text.inputEl.rows = rows;
      });
  }
}
