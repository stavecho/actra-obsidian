# Actra for Obsidian

ACTRA 是一个 Obsidian 社区插件，用于在用户打开 Obsidian 后，将 ACTRA 的每日总结、录音总结与转写、灵感、待办和运动数据主动拉取到当前 Vault。插件也提供逐目录授权的 ACTRA 知识索引能力。

## 当前版本

`V1.0.0` 已实现：

- ACTRA OAuth 授权码登录、`dailylog note recording upload` 权限、Obsidian `SecretStorage` 双 Token 存储与自动刷新；
- 用户可配置 OAuth 认证与 API 调用共用的服务根地址；留空时使用 `https://api.stavecho.com`；
- 直接读取 Stavecho ACTRA 的 `/service/v1/client/dailylog`、`note`、`recording` 分页接口；
- 将用户逐目录授权的本地 Markdown 通过 `/service/v1/client/upload` 上传至 ACTRA，默认每 24 小时自动检查一次并支持独立“立即上传”；
- 打开 Obsidian 后单次主动拉取，以及“立即拉取”；
- Markdown 稳定元数据、受控区块、`actra_id` 幂等写入；
- ACTRA 同步文件带有 `actra-synced` 标签，upload 会在读取正文前过滤这些文件，避免数据回流；
- 用户修改保护、目标占用保护和冲突副本；
- 用户删除本地 ACTRA 文件后不自动重建；
- 写入根目录与读取目录的独立权限校验；
- 读取目录逐个确认、本地数据上传单独确认与内容哈希去重；
- 暂停、状态栏、统计、脱敏诊断导出；

音频附件下载和任务状态回写属于后续阶段。官方上传接口当前没有远端删除能力；移除目录会立即停止对该目录的读取与上传，但不会删除此前已上传到 ACTRA 的副本。

## OAuth 配置

正式连接使用：

- ACTRA 服务根地址可由用户填写；留空使用 `https://api.stavecho.com`。插件会自动区分 `/auth` OAuth 服务和 `/service` 数据服务；
- 为 Obsidian 插件分配的公开 `client_id`：`obdisian-ngefXHKjmLer8GQWKhto`；
- 为该 Client ID 精确登记回调地址 `obsidian://actra-connect-oauth`；
- OAuth 首次连接申请 `dailylog note recording upload`，按最终授权 scope 调用对应 `/service/v1/client/*` 接口。

用户从插件设置页点击“登录 ACTRA 并授权”后，会在浏览器完成邮箱验证码登录和权限确认，再回到 Obsidian。Access Token 和 Refresh Token 均只保存在 Obsidian `SecretStorage`，插件会在 Access Token 到期前自动刷新。服务端仍需提供已登记回调地址的 Obsidian OAuth Client ID。详细协议和字段映射见 [docs/ACTRA-OAUTH.md](docs/ACTRA-OAUTH.md)。

## 安装后的连接流程

1. 在“设置 → ACTRA”按需填写“ACTRA 认证与 API 地址”；留空使用 `https://api.stavecho.com`。插件已预填正式 OAuth Client ID，连接默认服务时无需修改。
2. 点击“使用 ACTRA 账户连接”。浏览器打开 ACTRA 授权页，使用 ACTRA 登录邮箱完成图形验证码和邮箱验证码，并确认权限：`dailylog`、`note`、`recording` 将 ACTRA 数据拉取到 Obsidian，`upload` 允许插件上传用户另行授权的本地 Markdown。
3. ACTRA 通过 `obsidian://actra-connect-oauth` 返回插件。插件校验一次性 `state`，用授权码换取 Token，并在 Vault 中创建连接测试文件。
4. 连接成功后插件立即执行首次拉取；以后每次打开 Obsidian 拉取一次，也可以点击“立即拉取”。
5. ACTRA 默认不能读取现有 Vault 笔记。用户单独选择读取目录后，插件会立即上传一次，并默认每 24 小时自动检查更新；可以关闭自动上传，仍可随时点击“立即上传”。

## 安装开发版

需要 Obsidian 1.11.4 或更高版本。

```bash
pnpm install
pnpm run check
```

把以下文件复制到 Vault 的 `.obsidian/plugins/actra-connect/`：

- `main.js`
- `manifest.json`
- `styles.css`

然后在 Obsidian 的“设置 → 第三方插件”中启用 ACTRA。

更完整的验收步骤见 [docs/LOCAL-TEST.md](docs/LOCAL-TEST.md)。

如需自行实现 ACTRA 本地 Mock 服务，接口路径、请求/响应字段、六类同步数据示例和验收清单见 [docs/ACTRA-LOCAL-API.md](docs/ACTRA-LOCAL-API.md)。

如需由 ACTRA 服务端提供真实每日总结、对话、录音转写、AI 总结、运动和待办数据，首轮联调所需的最小接口、真实数据映射和交付清单见 [docs/ACTRA-REAL-DATA-API-REQUEST.md](docs/ACTRA-REAL-DATA-API-REQUEST.md)。

## 数据与隐私

- ACTRA 账户用于连接用户配置的 ACTRA 服务。
- 插件只连接用户配置的 ACTRA HTTPS 服务，不包含第三方遥测 SDK。
- Access Token、Refresh Token 和临时 OAuth state 均存入 Obsidian `SecretStorage`，不会写入插件 `data.json`。
- 默认不读取任何已有笔记。只有用户逐个确认的 `readRoots` 才可读取。
- 写入目录不会自动成为读取目录。
- 选择读取目录时会明确说明上传用途；自动上传默认每 24 小时运行，支持关闭，“立即上传”始终独立可用。
- ACTRA 拉取生成的 Markdown 会标记为 `actra-synced`，不会通过 upload 传回 ACTRA。
- 移除读取目录时，插件立即停止对该目录的读取和上传；当前接口无法删除此前已上传的远端副本。
- 插件不会删除、移入废纸篓或清空任何本地文件。解除连接也不会删除已经创建的 Markdown。

详见 [PRIVACY.md](PRIVACY.md)。生产发布前还需补充正式隐私政策 URL、服务条款 URL、数据保存区域、加密方式和删除 SLA。

## 安全约束

`pnpm run review:security` 会阻止常见的 Obsidian 本地文件删除 API 进入 `src/`。路径在每次操作前都会规范化，并拒绝绝对路径、`..`、隐藏目录、非 Markdown 文件以及授权根目录外的路径。

## 构建产物

正式发布包只包含 `main.js`、`manifest.json` 和 `styles.css`。版本兼容关系记录在 `versions.json`。
