# ACTRA Obsidian OAuth 接入说明

本文档记录 ACTRA OAuth 授权码流程在 Obsidian 插件中的实际接入方式。OAuth 负责取得和刷新访问凭据；每日总结、笔记和录音通过 Stavecho ACTRA 的 `/service/v1/client/*` 接口同步。

## 服务端必须提供的配置

| 配置 | 要求 |
| --- | --- |
| 服务根地址 | 生产环境为 `https://api.stavecho.com`；本地仅允许 `localhost` 或 `127.0.0.1` 使用 HTTP |
| Client ID | ACTRA 为 Obsidian 插件分配的公开应用 ID；插件不使用 Client Secret |
| Redirect URI | 必须精确登记为 `obsidian://actra-connect-oauth` |
| Scope | 插件申请 `dailylog note recording upload`；Token 中以用户最终勾选结果为准 |

生产授权接口位于：

```text
GET  <baseUrl>/auth/v1/app/oauth/authorize
POST <baseUrl>/auth/v1/app/oauth/token
```

授权页的可直接接入版本见 [`oauth-authorize-page.html`](./oauth-authorize-page.html)。页面保留现有相对接口 `captcha`、`send_code` 和当前授权路由的 JSON POST，同时明确区分 ACTRA → Obsidian 与 Obsidian → ACTRA 两个同步方向。

## 插件执行流程

1. 用户在插件设置中填写服务地址和 Client ID。
2. 插件生成 256 位随机 `state`，存入 Obsidian `SecretStorage`。
3. 插件打开 ACTRA 授权页，传入 `response_type=code`、Client ID、回调地址、scope 和 state。
4. ACTRA 回调 `obsidian://actra-connect-oauth?code=...&state=...`。
5. 插件拒绝 state 不匹配或超过 15 分钟的回调，再用授权码换取 Token。
6. Access Token 和 Refresh Token 分别存入 `SecretStorage`；有效期和实际 scope 可写入普通设置，但 Token 本身不会进入 `data.json`。
7. 已授权的同步请求发送 `Authorization: Bearer <access_token>`。
8. Access Token 距离过期不足 60 秒时，插件使用 Refresh Token 换取一组新 Token。并发请求共用同一次刷新，避免重复轮换 Refresh Token。

## 授权页文案约定

授权页应明确连接双方、登录账户和数据方向，避免把 Obsidian 误解为 ACTRA 的数据来源：

- 标题：`连接 ACTRA 与 Obsidian`；
- 说明：`使用 ACTRA 账户登录，并选择允许 Obsidian 插件同步的数据。`；
- 邮箱字段：`ACTRA 账户邮箱`；
- `dailylog`：`ACTRA → Obsidian`，将 ACTRA 日常记录同步到 Obsidian；
- `note`：`ACTRA → Obsidian`，将 ACTRA 笔记同步到 Obsidian；
- `recording`：`ACTRA → Obsidian`，将 ACTRA 录音记录、摘要和转写同步到 Obsidian；
- `upload`：`Obsidian → ACTRA`，仅允许插件上传用户另外选择的 Markdown；
- 提交按钮：`登录 ACTRA 并连接 Obsidian`。

勾选 `upload` 本身不能触发 Vault 扫描或上传。插件仍须在本地取得读取目录授权；授权后立即上传一次，后续默认每 24 小时自动检查，也可关闭自动任务并只手动上传。

## 服务端数据接口

插件按 Token 中的实际 scope 请求对应接口，并将分页响应转换为本地同步任务：

| Scope | 接口 | 本地类型 |
| --- | --- | --- |
| `dailylog` | `GET /service/v1/client/dailylog` | `daily_summary` |
| `note` | `GET /service/v1/client/note` | `idea` |
| `recording` | `GET /service/v1/client/recording` | `recording` |
| `upload` | `POST /service/v1/client/upload` | 上传用户授权目录中的 Markdown |

三个接口均使用 `page`、`page_size` 分页，并返回 `data`、`has_more`。插件使用源数据 ID 作为稳定对象标识，使用 `update_time`（缺失时使用 `create_time`）生成版本号，因此重复拉取不会重复创建文件。服务端未提供 ack/fail 接口，本地映射负责幂等处理。

`upload` 使用 `multipart/form-data`，字段为 `file` 和 `channel=obsidian`。插件在本地完成逐目录授权、内容哈希去重和 24 小时调度；只有授权目录内、且不是 ACTRA 同步生成的 Markdown 会被读取和上传。同步文件通过 `actra_managed`、`actra_id`、`actra-synced` 和本地映射识别，并在读取正文前过滤。

官方接口当前没有远端删除能力。移除读取目录会停止后续读取与上传，但此前已上传到 ACTRA 的副本仍会保留。关闭自动上传不会禁用手动上传。

当前 OAuth 文档未提供 Token 撤销接口，因此用户在插件中“解除连接”时只会安全清除本地 Token。若需要同时撤销 ACTRA 账户侧授权，服务端需补充撤销接口或在 ACTRA App 中提供授权管理入口。

当前服务端文档也未定义 PKCE。由于 Obsidian 插件属于不持有 Client Secret 的公开客户端，且回调使用自定义 URI scheme，生产发布前建议服务端补充 `S256` PKCE；在服务端协议确认前，插件严格按现有文档发送参数，没有自行添加未声明字段。

## 本地联调

在 ACTRA 插件设置中填写：

```text
ACTRA 服务地址: http://127.0.0.1:8080
OAuth Client ID: test_app
OAuth 回调地址: obsidian://actra-connect-oauth
```

本地 OAuth 服务必须能够把浏览器重定向到 `obsidian://` 自定义协议。Obsidian 打开后，插件会校验回调并完成 Token 交换。

建议至少验证：

- 正常授权和取消部分 scope；
- state 缺失、错误和过期；
- 授权码重复使用和超过 10 分钟；
- Access Token 到期后的自动刷新；
- Refresh Token 轮换与过期；
- 401、500 和网络中断；
- 解除连接后本地 Token 已清空且 Vault 文件未删除。
