import { App, FuzzySuggestModal, Modal, Setting, TFolder } from "obsidian";

export class ConfirmModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly titleText: string,
    private readonly description: string,
    private readonly confirmText: string,
    private readonly dangerous = false
  ) {
    super(app);
  }

  static ask(
    app: App,
    title: string,
    description: string,
    confirmText: string,
    dangerous = false
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new ConfirmModal(app, title, description, confirmText, dangerous);
      modal.onResult = resolve;
      modal.open();
    });
  }

  private onResult: (value: boolean) => void = () => undefined;

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.createEl("p", { text: this.description, cls: "actra-modal-description" });
    const actions = new Setting(this.contentEl);
    actions.addButton((button) => button.setButtonText("取消").onClick(() => this.finish(false)));
    actions.addButton((button) => {
      button.setButtonText(this.confirmText).setCta();
      if (this.dangerous) button.setDestructive();
      button.onClick(() => this.finish(true));
    });
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.onResult(false);
  }

  private finish(value: boolean): void {
    this.settled = true;
    this.onResult(value);
    this.close();
  }
}

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private readonly folders: TFolder[];

  constructor(
    app: App,
    excluded: string[],
    private readonly onPick: (folder: TFolder) => void
  ) {
    super(app);
    const folders: TFolder[] = [];
    const visit = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (!(child instanceof TFolder)) continue;
        if (child.path === app.vault.configDir || child.path.split("/").some((segment) => segment.startsWith("."))) continue;
        if (excluded.some((root) => child.path === root || child.path.startsWith(`${root}/`))) continue;
        folders.push(child);
        visit(child);
      }
    };
    visit(app.vault.getRoot());
    this.folders = folders;
    this.setPlaceholder("选择一个 Vault 内目录…");
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "确认" },
      { command: "esc", purpose: "取消" }
    ]);
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onPick(folder);
  }
}
