# 本地 Obsidian 验收

## 自动化检查

```bash
pnpm run check
```

该命令依次执行官方 Obsidian ESLint、单元/集成测试、TypeScript 类型检查、生产构建、移动端兼容扫描和禁止删除 API 的静态扫描。

## 手工交互检查

1. 创建空白测试 Vault，并安装 `main.js`、`manifest.json`、`styles.css`。
2. 启用 Actra，确认插件名称为 `Actra`、版本为 `1.0.1`，设置页初始状态为“未连接”“未授权任何目录”。
3. 未连接时，确认“ACTRA 认证与 API 地址”默认显示 `https://api.stavecho.com`，可以直接编辑，失焦或按 Enter 后自动保存；清空后输入框提示“输入 API 地址”，点击连接提示“请先输入 ACTRA API 地址。”。确认连接说明仅保留登录邮箱和首次同步两步，页面不显示 OAuth Client ID。已连接时，确认地址默认只读，点击“更改”并确认影响后才会进入编辑状态；空地址不能覆盖当前连接。
4. 使用 ACTRA 账户完成 OAuth 授权，确认显示“已连接”，且 `ACTRA/连接测试.md` 真正存在。
5. 点击“立即拉取”，确认 dailylog、note、recording 数据写入对应目录；再次拉取不生成重复文件。
6. 在“我的补充”中输入文字，再拉取更新，确认补充保留。
7. 修改 `<!-- actra:managed:start ... -->` 与结束标记之间的内容，再拉取更新，确认原文件未覆盖，并生成 `.conflict-时间.md`。
8. 删除一个 ACTRA 管理文件后再次同步，确认不会自动恢复。
9. 新建独立测试目录与 Markdown，添加读取授权，确认出现用途说明和二次确认。
10. 确认“每 24 小时自动上传”默认开启；关闭后点击“立即上传”，确认上传仍可执行。
11. 将读取目录设为包含 ACTRA 写入目录，确认带 `actra_managed`、`actra_id` 或 `actra-synced` 的文件不会上传，普通本地 Markdown 可以上传。
12. 暂停或解除连接后修改授权笔记，确认插件不再读取/上传。
13. 移除读取授权，确认本地文件不变。
14. 导出诊断信息，确认文件不含配对码、Token 或笔记正文。

## iOS 与 Android 验收

1. 分别在 iOS 和 Android 的 Obsidian 1.13.0 或更高版本中，通过社区插件市场安装并启用 Actra。
2. 确认设置页可完整滚动，输入框、按钮、目录选择和确认弹窗没有超出屏幕；横竖屏切换后仍可操作。
3. 点击“使用 Actra 账号连接”，确认系统浏览器打开 ACTRA 授权页；完成授权后，`obsidian://actra-connect-oauth` 能返回原 Vault 并显示“已连接”。
4. 锁屏或将 Obsidian 切到后台后再返回，确认插件不报错；重新打开 Obsidian 后会检查拉取和到期的自动上传任务。
5. 执行“立即拉取”，确认 dailylog、note、recording 写入当前 Vault；重复执行不产生重复文件或冲突通知。
6. 新建只用于测试的本地目录，授权后执行“立即上传”，确认普通 Markdown 可上传，ACTRA 同步生成的文件被过滤。
7. 关闭自动上传后重启 Obsidian，确认不会自动上传，但“立即上传”仍可使用。
8. 分别在 iOS 和 Android 上解除连接，确认 Token 被清除、本地 Markdown 保留，应用没有崩溃。

## 安全回归

- 写入根目录尝试 `/绝对路径`、`../越权`、`.obsidian`、反斜杠和非 `.md` 文件均应失败。
- 服务端返回写入根目录外的 `targetPath` 时应返回权限错误。
- 解除连接、撤销读取目录和停止上传不能删除任何本地文件。
- `data.json` 中只允许出现 `tokenSecretId`，不得出现 Access Token 或 Refresh Token。
