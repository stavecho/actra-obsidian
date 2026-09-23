# ACTRA Obsidian 本地联调接口文档

> 文档版本：v1.0  
> 对应插件版本：0.1.2  
> 更新日期：2026-08-06  
> 适用范围：ACTRA 本地 Mock 服务、ACTRA 服务端、Obsidian 插件联调与测试

## 1. 文档目标

本文档定义 ACTRA Obsidian 插件当前实际调用的数据接口。实现一个本地 HTTP 服务后，将插件的“ACTRA 服务地址”配置为该服务地址，即可完成配对、ACTRA 数据下发、同步回执和 Obsidian 笔记索引上传测试。

当前代码允许以下本地地址使用 HTTP：

```text
http://localhost:<port>
http://127.0.0.1:<port>
```

非本地地址必须使用 HTTPS。

本文档以当前 `src/api/client.ts`、`src/types.ts` 和同步引擎的实现为准。字段名大小写必须严格匹配；当前协议同时存在 `camelCase` 和少量 `snake_case` 字段，不能自动互换。

## 2. 接口范围

| 模块 | 方法 | 路径 | 认证 | 本地联调优先级 |
| --- | --- | --- | --- | --- |
| 配对 | `POST` | `/v1/obsidian/pairings/claim` | 否 | 必须 |
| 配对 | `GET` | `/v1/obsidian/pairings/{pairingId}/status` | 否 | 异步配对时必须 |
| 连接 | `POST` | `/v1/obsidian/connections/{connectionId}/session-open` | Bearer | 必须 |
| 连接 | `POST` | `/v1/obsidian/connections/{connectionId}/revoke` | Bearer | 必须 |
| 入站同步 | `GET` | `/v1/obsidian/sync/jobs?status=pending&cursor={cursor}` | Bearer | 必须 |
| 入站同步 | `POST` | `/v1/obsidian/sync/jobs/{jobId}/ack` | Bearer | 必须 |
| 入站同步 | `POST` | `/v1/obsidian/sync/jobs/{jobId}/fail` | Bearer | 必须 |
| 知识索引 | `POST` | `/v1/obsidian/index/documents:batchUpsert` | Bearer | 索引测试时必须 |
| 知识索引 | `DELETE` | `/v1/obsidian/index/documents/{documentId}` | Bearer | 索引测试时必须 |
| 知识索引 | `POST` | `/v1/obsidian/index/authorizations:revoke` | Bearer | 撤权测试时必须 |
| 知识索引 | `POST` | `/v1/obsidian/index/reconcile` | Bearer | 索引测试时必须 |

本版本插件尚未调用 Token 刷新、远程配置、远程 `pull-now`、附件上传下载或任务状态回写接口，这些不属于本地 Mock 的必需范围。

## 3. 通用约定

### 3.1 请求与响应

- 请求和响应编码：UTF-8。
- 有请求体时使用 `Content-Type: application/json`。
- 客户端发送 `Accept: application/json`。
- 除配对申请和配对状态查询外，其余接口均发送：

```http
Authorization: Bearer <accessToken>
```

- 服务端通过 Token 确定用户和 `vaultConnectionId`。同步和索引请求不重复传连接 ID。
- 建议所有成功接口返回 `200 OK` 和合法 JSON。无业务返回值时返回 `{}`，本地 Mock 不建议返回空响应体。

### 3.2 字段命名

默认使用 `camelCase`，以下成功/失败回执字段按当前客户端实现使用下划线命名：

```json
{
  "content_hash": "<SHA-256 hex>"
}
```

不得将同步任务中的 `jobId`、`actraId`、`updatedAt`、`targetPath` 改成 `job_id`、`actra_id`、`updated_at`、`target_path`。

### 3.3 时间和哈希

| 数据 | 格式 | 示例 |
| --- | --- | --- |
| 日期 | `YYYY-MM-DD`，有效公历日期 | `2026-08-06` |
| 业务更新时间 | ISO 8601 字符串，建议带时区 | `2026-08-06T10:30:00+08:00` |
| 文件创建/修改时间 | Unix Epoch 毫秒整数 | `1785983400000` |
| 内容哈希 | 小写 SHA-256 十六进制字符串 | `64e6...a91c` |

当前插件生成的哈希不带 `sha256:` 前缀。服务端应把哈希当作不透明字符串保存和比较。

### 3.4 HTTP 状态码

| 状态码 | 含义 | 当前插件行为 |
| --- | --- | --- |
| `200` | 成功 | 解析 JSON 并继续 |
| `400` | 请求字段或格式错误 | 显示请求被拒绝，不自动重试 |
| `401` | Token 缺失、无效或过期 | 进入需重新认证的错误流程 |
| `403` | 当前 Token 不允许调用 | 当前插件同样按需重新认证处理 |
| `404` | 资源不存在 | 显示请求被拒绝 |
| `409` | 服务端状态冲突 | 显示请求被拒绝 |
| `429` | 频率限制 | 当前插件不把它标记为可重试 |
| `500`–`599` | 服务端异常 | 拉取和回执接口最多尝试 3 次 |

建议错误响应使用以下结构，便于服务端日志和后续客户端扩展；当前插件只依据 HTTP 状态码，不读取该结构中的文案：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "date must use YYYY-MM-DD",
    "requestId": "req_local_001"
  }
}
```

## 4. 核心数据格式

### 4.1 `SyncJob`：ACTRA 下发给 Obsidian 的同步任务

```ts
interface SyncJob {
  jobId: string;
  actraId: string;
  type: ActraNoteType;
  revision: number;
  updatedAt: string;
  targetPath?: string;
  content: SyncJobContent;
}
```

| 字段 | 类型 | 必填 | 约束与含义 |
| --- | --- | --- | --- |
| `jobId` | string | 是 | 本次队列任务的稳定唯一 ID；重试时保持不变 |
| `actraId` | string | 是 | ACTRA 业务对象稳定 ID；更新同一笔记时保持不变 |
| `type` | enum | 是 | 见 4.2 |
| `revision` | integer | 是 | 大于等于 1；同一 `actraId` 的新内容必须递增 |
| `updatedAt` | string | 是 | ACTRA 业务数据更新时间，ISO 8601 |
| `targetPath` | string | 否 | Vault 内相对 Markdown 路径；建议本地联调时省略 |
| `content` | object | 是 | 要写入笔记的业务内容，见 4.3 |

推荐 ID 约束：`^[A-Za-z0-9_-]{1,100}$`。虽然同步引擎当前只强制 ID 非空，但该约束与内置测试生成器一致，也能防止 ID 被注入 Markdown 管理标记。

`jobId` 和 `actraId` 的职责不同：

- `actraId` 标识业务对象，例如同一段录音。
- `jobId` 标识一次待处理队列任务。
- 对同一 `actraId` 下发更高 `revision` 时，应使用新的 `jobId`。
- 网络重试或回执重试必须复用原 `jobId`。

### 4.2 `ActraNoteType`

| 值 | 含义 | 默认路径 |
| --- | --- | --- |
| `daily_summary` | 每日总结 | `ACTRA/每日总结/{date}.md` |
| `recording` | 录音、会议总结和转写 | `ACTRA/录音/{date}-{title}.md` |
| `conversation` | 对话摘要 | `ACTRA/对话与灵感/{date}-{title}.md` |
| `idea` | 灵感 | `ACTRA/对话与灵感/{date}-{title}.md` |
| `task_collection` | 待办集合 | `ACTRA/待办/待办.md` |
| `exercise` | 运动记录 | `ACTRA/运动/{date}.md` |

表中以默认写入根目录 `ACTRA` 为例。实际根目录由用户本地设置决定。

### 4.3 `SyncJobContent`

```ts
interface SyncJobContent {
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
```

| 字段 | 类型 | 必填 | 约束与渲染方式 |
| --- | --- | --- | --- |
| `title` | string | 是 | 非空；作为 Markdown 一级标题，也可能用于文件名 |
| `date` | string | 是 | 有效 `YYYY-MM-DD` 日期 |
| `project` | string | 否 | 写入 frontmatter 的 `project` |
| `tags` | string[] | 否 | 写入 frontmatter；插件会额外加入 `actra` 标签 |
| `summary` | string | 否 | 渲染为“AI 总结”章节 |
| `transcript` | string | 否 | 渲染为“录音转写”章节 |
| `body` | string | 否 | 直接写入 ACTRA 受控区块，可包含 Markdown |
| `audioUrl` | string | 否 | 必须是有效 HTTPS URL；其他协议不会生成可点击链接 |
| `tasks` | `ActraTask[]` | 否 | 渲染为 Markdown checkbox 列表 |
| `exerciseRows` | object[] | 否 | 每个值只能是 string 或 number，渲染为 Markdown 表格 |

`summary`、`body` 和 `transcript` 中出现形如 `<!-- actra:managed:` 的文本时，插件会转义，以防破坏受控区块边界。

### 4.4 `ActraTask`

```ts
interface ActraTask {
  id: string;
  text: string;
  completed?: boolean;
  dueDate?: string;
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `id` | string | 是 | ACTRA 待办稳定 ID |
| `text` | string | 是 | 非空；换行会被压成单行 |
| `completed` | boolean | 否 | 缺省按 `false` 渲染 |
| `dueDate` | string | 否 | `YYYY-MM-DD` |

### 4.5 各内容类型建议字段

除 `title` 和 `date` 始终必填外，建议按下表提供内容：

| 类型 | 建议字段 |
| --- | --- |
| `daily_summary` | `summary`、`tasks`、`tags`、`project` |
| `recording` | `summary`、`transcript`、`audioUrl`、`tasks`、`tags` |
| `conversation` | `summary` 或 `body`、`tasks`、`tags` |
| `idea` | `body` 或 `summary`、`tags` |
| `task_collection` | `tasks`，可带 `summary` |
| `exercise` | `exerciseRows`，可带 `summary` |

示例内容片段：

```json
{
  "daily_summary": {
    "title": "2026-08-06 每日总结",
    "date": "2026-08-06",
    "summary": "完成了本地联调。",
    "tasks": [
      { "id": "task_001", "text": "检查同步结果", "dueDate": "2026-08-07" }
    ]
  },
  "recording": {
    "title": "ACTRA 产品会议",
    "date": "2026-08-06",
    "summary": "确认了配对和同步协议。",
    "transcript": "这是会议转写。",
    "audioUrl": "https://app.actra.example/recordings/recording_001"
  },
  "conversation": {
    "title": "关于本地测试的对话",
    "date": "2026-08-06",
    "body": "用户希望通过本地 Mock 服务验证同步。"
  },
  "idea": {
    "title": "增加接口回放工具",
    "date": "2026-08-06",
    "body": "保存一组固定响应，用于回归测试。"
  },
  "task_collection": {
    "title": "ACTRA 待办",
    "date": "2026-08-06",
    "tasks": [
      { "id": "task_002", "text": "完成接口 Mock", "completed": false }
    ]
  },
  "exercise": {
    "title": "2026-08-06 运动记录",
    "date": "2026-08-06",
    "exerciseRows": [
      { "项目": "步数", "数值": 8600, "单位": "步" },
      { "项目": "活动时长", "数值": 45, "单位": "分钟" }
    ]
  }
}
```

上例只展示六种类型各自的 `content`，不是一个实际接口请求体。

### 4.6 `IndexDocumentPayload`：Obsidian 上传给 ACTRA 的索引文档

```ts
interface IndexDocumentPayload {
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
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `documentId` | string | 插件生成的稳定文档 ID；重命名文件时保持不变 |
| `path` | string | Vault 内相对路径，不得保存本地绝对路径 |
| `title` | string | 文件名去掉 `.md` 后的标题 |
| `contentHash` | string | Markdown 全文 SHA-256 |
| `createdAt` | integer | 文件创建时间，Epoch 毫秒 |
| `modifiedAt` | integer | 文件修改时间，Epoch 毫秒 |
| `tags` | string[] | 正文标签与 frontmatter 标签的去重合集，不带 `#` |
| `properties` | object | frontmatter；插件会移除 Obsidian 内部的 `position` 字段 |
| `headings` | string[] | MetadataCache 提取的标题文本 |
| `links` | string[] | MetadataCache 提取的链接目标 |
| `content` | string | 完整 Markdown 正文，可能包含中文和换行 |

只有用户明确授权的 `readRoots` 内文件才会上传。服务端必须按连接隔离文档，不能仅以 `documentId` 跨用户或跨 Vault 查找。

## 5. 配对与连接接口

### 5.1 申请配对

```http
POST /v1/obsidian/pairings/claim
```

无需 Bearer Token。

请求：

```json
{
  "pairingCode": "123456",
  "pluginInstanceId": "plugin_local_001",
  "vaultName": "ACTRA-Test-Vault",
  "platform": "desktop",
  "pluginVersion": "0.1.2",
  "requestedScopes": [
    "service.connect",
    "notes.create",
    "notes.update_managed"
  ]
}
```

字段约束：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `pairingCode` | string | 是 | 插件 UI 当前要求 6 位数字 |
| `pluginInstanceId` | string | 是 | 本地插件实例稳定 ID |
| `vaultName` | string | 是 | Vault 显示名称，不是文件系统绝对路径 |
| `platform` | enum | 是 | `desktop` 或 `mobile` |
| `pluginVersion` | string | 是 | 插件版本 |
| `requestedScopes` | string[] | 是 | 当前固定为示例中的三个权限 |

本地联调推荐直接完成配对：

```json
{
  "pairingId": "pairing_local_001",
  "status": "CONNECTED",
  "vaultConnectionId": "vault_local_001",
  "accessToken": "local_test_token_001"
}
```

需要测试 App 二次确认流程时返回：

```json
{
  "pairingId": "pairing_local_001",
  "status": "PENDING_CONFIRMATION"
}
```

`status` 只能是 `PENDING_CONFIRMATION` 或 `CONNECTED`。返回 `CONNECTED` 时，`vaultConnectionId` 和 `accessToken` 必须同时存在。

### 5.2 查询配对状态

```http
GET /v1/obsidian/pairings/{pairingId}/status
```

无需 Bearer Token。插件每 2 秒查询一次，最多查询 150 次。

等待确认：

```json
{
  "status": "PENDING_CONFIRMATION"
}
```

确认成功：

```json
{
  "status": "CONNECTED",
  "vaultConnectionId": "vault_local_001",
  "accessToken": "local_test_token_001"
}
```

拒绝或过期：

```json
{ "status": "REJECTED" }
```

```json
{ "status": "EXPIRED" }
```

### 5.3 打开连接会话

```http
POST /v1/obsidian/connections/{connectionId}/session-open
Authorization: Bearer local_test_token_001
```

无请求体。插件在 Obsidian 布局加载完成后调用一次。服务端可记录在线时间，但不能把它当作常驻连接。

响应：

```json
{}
```

### 5.4 撤销连接

```http
POST /v1/obsidian/connections/{connectionId}/revoke
Authorization: Bearer local_test_token_001
```

无请求体。服务端成功后应立即使当前 Token 失效，但不得删除用户 Obsidian 中已经创建的文件。

响应：

```json
{}
```

## 6. ACTRA → Obsidian 入站同步接口

### 6.1 获取待同步任务

```http
GET /v1/obsidian/sync/jobs?status=pending
GET /v1/obsidian/sync/jobs?status=pending&cursor=<opaqueCursor>
Authorization: Bearer local_test_token_001
```

`cursor` 是服务端生成的不透明字符串。下一页必须返回新的游标；插件发现游标重复或单次超过 100 页时会停止同步。

响应：

```json
{
  "jobs": [
    {
      "jobId": "job_recording_001_r1",
      "actraId": "recording_001",
      "type": "recording",
      "revision": 1,
      "updatedAt": "2026-08-06T10:30:00+08:00",
      "content": {
        "title": "ACTRA 产品会议",
        "date": "2026-08-06",
        "project": "ACTRA",
        "tags": ["meeting", "product"],
        "summary": "会议确认了本地接口联调方案。",
        "transcript": "这是本地测试转写。",
        "audioUrl": "https://app.actra.example/recordings/recording_001",
        "tasks": [
          {
            "id": "task_001",
            "text": "完成 Mock 服务",
            "completed": false,
            "dueDate": "2026-08-08"
          }
        ]
      }
    }
  ],
  "nextCursor": "cursor_page_2"
}
```

最后一页省略 `nextCursor`：

```json
{
  "jobs": []
}
```

#### `targetPath` 规则

本地测试推荐不返回 `targetPath`，由插件根据类型、日期和标题生成安全路径。

如必须指定：

```json
{
  "targetPath": "ACTRA/录音/2026-08-06-ACTRA 产品会议.md"
}
```

它必须满足：

- 是 Vault 内相对路径，不能以 `/`、`\` 或盘符开头；
- 使用 `/` 分隔；
- 不包含空路径段、`.`、`..` 或任何以 `.` 开头的目录；
- 以 `.md` 结尾；
- 位于用户配置的写入根目录内。

否则插件会调用失败回执，错误码为 `INVALID_TARGET` 或 `PERMISSION_DENIED`。

### 6.2 同步成功回执

```http
POST /v1/obsidian/sync/jobs/{jobId}/ack
Authorization: Bearer local_test_token_001
Content-Type: application/json
```

请求：

```json
{
  "path": "ACTRA/录音/2026-08-06-ACTRA 产品会议.md",
  "content_hash": "64e6f163c8c945f767fef1be6f30f4f98df29170d1e88f58bf14f90a2738a91c"
}
```

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `path` | string | 插件最终创建或更新的 Vault 内相对路径 |
| `content_hash` | string | ACTRA 受控区块哈希，不是整个 Markdown 文件哈希 |

服务端收到回执后将任务标记为成功，不再通过 `status=pending` 返回。接口必须支持幂等调用：重复提交同一 `jobId` 应返回成功。

响应：

```json
{}
```

### 6.3 同步失败回执

```http
POST /v1/obsidian/sync/jobs/{jobId}/fail
Authorization: Bearer local_test_token_001
Content-Type: application/json
```

请求：

```json
{
  "code": "CONFLICT",
  "message": "检测到本地修改，未覆盖原文件，已创建冲突副本。",
  "path": "ACTRA/录音/2026-08-06-ACTRA 产品会议.conflict-20260806-104500.md"
}
```

| `code` | 含义 | `path` |
| --- | --- | --- |
| `PERMISSION_DENIED` | 目标路径超出用户授权写入根目录 | 可省略 |
| `INVALID_TARGET` | 路径格式非法或目标不可写 | 可省略 |
| `CONFLICT` | 本地受控区块被修改或目标被占用 | 建议返回本地冲突副本路径 |
| `LOCALLY_REMOVED` | 用户已删除映射文件，插件拒绝自动恢复 | 可省略 |
| `FAILED` | 其他数据或处理错误 | 可省略 |

`message` 是经过脱敏和长度限制的用户可读信息，服务端不得把它当作稳定程序错误码。

本地 Mock 可在收到失败回执后将任务移出 pending 队列，以便测试单次失败流程；生产服务是否允许用户显式重试，应通过新的 attempt 状态管理，但保持原任务的幂等语义。

响应：

```json
{}
```

## 7. Obsidian → ACTRA 知识索引接口

### 7.1 批量新增或更新文档

```http
POST /v1/obsidian/index/documents:batchUpsert
Authorization: Bearer local_test_token_001
Content-Type: application/json
```

请求：

```json
{
  "documents": [
    {
      "documentId": "doc_local_001",
      "path": "项目/ACTRA/2026-08-06 周报.md",
      "title": "2026-08-06 周报",
      "contentHash": "9300f8d26c6ee015be628c099477800000000000000000000000000000000000",
      "createdAt": 1785981600000,
      "modifiedAt": 1785983400000,
      "tags": ["actra", "weekly"],
      "properties": {
        "project": "ACTRA",
        "status": "in-progress"
      },
      "headings": ["本周进展", "下周计划"],
      "links": ["ACTRA 接口方案"],
      "content": "---\nproject: ACTRA\n---\n\n# 本周进展\n\n已完成本地联调。"
    }
  ]
}
```

当前插件每批最多发送 20 个文档。服务端应以“当前连接 + `documentId`”执行 upsert，并允许相同内容重复提交。

响应：

```json
{}
```

### 7.2 删除云端索引文档

```http
DELETE /v1/obsidian/index/documents/{documentId}
Authorization: Bearer local_test_token_001
```

无请求体。此接口只删除 ACTRA 保存的 Obsidian 文档副本、分块和向量索引：

- 不删除 Obsidian 本地文件；
- 不删除 ACTRA 的录音、总结或待办等源业务数据；
- 资源已不存在时也应幂等返回成功。

响应：

```json
{}
```

### 7.3 撤销读取目录的云端授权数据

```http
POST /v1/obsidian/index/authorizations:revoke
Authorization: Bearer local_test_token_001
Content-Type: application/json
```

请求：

```json
{
  "root": "项目/ACTRA"
}
```

服务端应删除当前连接下 `path == root` 或 `path` 以 `root + "/"` 开头的索引文档及全部派生数据。`root` 是 Vault 内相对目录，不是本机绝对路径。

响应：

```json
{}
```

### 7.4 对账当前索引

```http
POST /v1/obsidian/index/reconcile
Authorization: Bearer local_test_token_001
Content-Type: application/json
```

请求：

```json
{
  "documents": [
    {
      "documentId": "doc_local_001",
      "path": "项目/ACTRA/2026-08-06 周报.md",
      "contentHash": "9300f8d26c6ee015be628c099477800000000000000000000000000000000000"
    }
  ]
}
```

该列表表示插件当前仍有权读取且已经成功上传的文档集合。服务端应：

1. 按当前连接隔离对账范围；
2. 记录路径和哈希差异；
3. 清理该连接中已不在列表内的 Obsidian 派生索引；
4. 不对 Obsidian 本地文件发出任何删除指令；
5. 不删除 ACTRA 源业务数据。

本地 Mock 只需接受并保存该列表即可完成基础联调。

响应：

```json
{}
```

## 8. 本地 Mock 服务最小行为

一个可用的本地服务至少维护以下内存数据：

```ts
interface LocalMockState {
  pairings: Map<string, {
    status: "PENDING_CONFIRMATION" | "CONNECTED" | "REJECTED" | "EXPIRED";
    vaultConnectionId?: string;
    accessToken?: string;
  }>;
  tokens: Map<string, { vaultConnectionId: string; revoked: boolean }>;
  jobs: Map<string, SyncJob & { status: "pending" | "succeeded" | "failed" }>;
  indexedDocuments: Map<string, IndexDocumentPayload>;
}
```

最短联调流程：

```text
1. claim 返回 CONNECTED + vaultConnectionId + accessToken
2. 插件在本地创建连接测试 Markdown
3. session-open 返回 {}
4. GET sync/jobs 返回预置的 pending 任务
5. 插件写入 Markdown
6. ack 将任务改为 succeeded
7. 再次 GET sync/jobs 不再返回该任务
```

需要测试索引时，再实现：

```text
batchUpsert 保存 documents
DELETE document 删除指定云端文档
authorizations:revoke 按目录删除云端文档
reconcile 保存或比较当前文档清单
```

## 9. 本地调用示例

以下示例假设服务运行在 `http://127.0.0.1:8787`。

申请配对：

```bash
curl -X POST 'http://127.0.0.1:8787/v1/obsidian/pairings/claim' \
  -H 'Content-Type: application/json' \
  -d '{
    "pairingCode":"123456",
    "pluginInstanceId":"plugin_local_001",
    "vaultName":"ACTRA-Test-Vault",
    "platform":"desktop",
    "pluginVersion":"0.1.2",
    "requestedScopes":["service.connect","notes.create","notes.update_managed"]
  }'
```

读取待同步任务：

```bash
curl 'http://127.0.0.1:8787/v1/obsidian/sync/jobs?status=pending' \
  -H 'Authorization: Bearer local_test_token_001' \
  -H 'Accept: application/json'
```

插入一条本地测试任务的推荐数据：

```json
{
  "jobId": "job_daily_20260806_r1",
  "actraId": "daily_20260806",
  "type": "daily_summary",
  "revision": 1,
  "updatedAt": "2026-08-06T12:00:00+08:00",
  "content": {
    "title": "2026-08-06 每日总结",
    "date": "2026-08-06",
    "project": "ACTRA",
    "tags": ["daily", "local-test"],
    "summary": "这是一条由本地 ACTRA Mock 服务下发的测试数据。",
    "tasks": [
      {
        "id": "task_local_001",
        "text": "验证 Obsidian 同步结果",
        "completed": false,
        "dueDate": "2026-08-07"
      }
    ]
  }
}
```

## 10. 验收清单

- [ ] `claim` 能直接返回 `CONNECTED`，插件创建 `ACTRA/连接测试.md`。
- [ ] `session-open` 能在 Obsidian 启动后成功返回。
- [ ] 空队列返回 `{ "jobs": [] }`。
- [ ] 六种 `type` 均能生成对应目录和 Markdown 内容。
- [ ] 同一 `actraId` 的更高 `revision` 更新原文件，不创建重复文件。
- [ ] 重复 `jobId` 或相同/更低 `revision` 不造成重复写入。
- [ ] `ack` 后任务不再出现在 pending 队列。
- [ ] 非法 `targetPath` 会收到失败回执。
- [ ] 修改 ACTRA 受控区块后下发新版本，会收到 `CONFLICT` 和冲突副本路径。
- [ ] 删除本地映射文件后下发新版本，会收到 `LOCALLY_REMOVED`。
- [ ] 索引上传能接收 Epoch 毫秒时间和完整 Markdown 正文。
- [ ] 删除索引、撤销目录和对账只影响 ACTRA 云端派生索引，不影响本地文件。
- [ ] Token 失效时返回 `401`，其他服务端临时异常返回 `5xx`。

## 11. 当前版本边界

- 首版是 Obsidian 打开后主动拉取，不使用服务端推送或 WebSocket。
- 插件不会在 Obsidian 关闭时写入本地文件。
- `audioUrl` 目前只写入链接，不下载音频附件。
- `taskWriteback` 目前未实现，待办只从 ACTRA 单向同步到 Obsidian。
- `DELETE /index/documents/{documentId}` 只表示云端索引清理，协议中不得增加删除本地文件的任务类型。
- 当前插件不会读取服务端错误响应正文，也不会消费批量索引的逐条结果；生产接口若需要更细粒度状态，需要同步升级客户端类型和处理逻辑。
