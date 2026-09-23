# ACTRA 真实数据接口需求

> 实现状态（2026-09-23）：插件已改为直接接入 Stavecho ACTRA 的
> `/service/v1/client/dailylog`、`/note`、`/recording` 接口。本文后续的
> `/v1/obsidian/*` 队列协议保留为早期方案记录，不再是当前生产接入要求。

> 接收方：ACTRA 服务端/数据平台  
> 使用方：ACTRA Obsidian 插件  
> 用途：使用 ACTRA 测试账号产生的真实总结、对话、录音、运动和待办数据进行本地联调  
> 对应插件版本：0.1.2  
> 更新日期：2026-08-06

## 1. 需要提供什么

请提供一个可从本地 Obsidian 访问的测试环境 API。API 从 ACTRA 后端读取指定测试账号实际产生的每日总结、对话、录音转写、AI 总结、运动和待办数据，并转换为本文约定的同步任务格式。

首轮联调至少需要提供：

1. 一个测试环境 Base URL，例如 `https://actra-test.example.com`；
2. 一个可使用的 6 位测试配对码，或固定的本地测试配对规则；
3. 一个已获授权的 ACTRA 测试账号，账号中具有本文第 2 节列出的真实测试数据；
4. 配对、打开会话、拉取任务、成功回执、失败回执共 5 个接口；
5. 一份可供核对的脱敏响应样例。

如果接口只在本地电脑上运行，可使用：

```text
http://localhost:<port>
http://127.0.0.1:<port>
```

如果需要跨电脑访问，必须提供 HTTPS 测试地址。

## 2. 联调数据范围

首轮需要以下真实数据：

| 数据类型 | `type` | 必须提供的内容 |
| --- | --- | --- |
| 每日总结 | `daily_summary` | 稳定对象 ID、标题、日期、更新时间、每日总结完整文本 |
| ACTRA 对话 | `conversation` | 稳定对象 ID、标题、日期、更新时间、对话正文或摘要 |
| ACTRA 录音 | `recording` | 稳定对象 ID、标题、日期、更新时间、录音转写文本、AI 总结；有条件时提供播放链接 |
| 运动数据 | `exercise` | 稳定对象 ID、日期、更新时间、运动指标明细 |
| 待办集合 | `task_collection` | 稳定对象 ID、日期、更新时间、待办 ID、文本、状态和可选截止日期 |

`summary` 是通用的 AI 总结字段，不单独作为一种 `type`。录音 AI 总结放在 `recording.content.summary`，对话 AI 总结放在 `conversation.content.summary`。

## 3. 联调调用流程

```text
Obsidian 插件提交测试配对码
→ ACTRA 测试服务返回连接 ID 和 Token
→ 插件打开一次会话
→ 插件拉取该测试账号的真实总结、对话、录音、运动和待办数据
→ 插件写入本地 Markdown
→ 写入成功后发送 ack
→ 写入冲突或数据非法时发送 fail
```

ACTRA 服务只需要提供数据。所有 Obsidian 本地文件创建和更新仍由插件执行，服务端不能直接访问 Vault。

## 4. 必须接口

### 4.1 测试配对

```http
POST /v1/obsidian/pairings/claim
Content-Type: application/json
```

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

首轮联调建议直接返回已连接，避免依赖 ACTRA App 二次确认：

```json
{
  "pairingId": "pairing_test_001",
  "status": "CONNECTED",
  "vaultConnectionId": "vault_test_001",
  "accessToken": "test_access_token_001"
}
```

要求：

- `status` 固定返回 `CONNECTED`；
- `vaultConnectionId` 标识本次测试连接；
- `accessToken` 后续通过 Bearer Header 传递；
- Token 必须绑定指定测试账号，不能返回其他用户的数据。

### 4.2 打开会话

```http
POST /v1/obsidian/connections/{connectionId}/session-open
Authorization: Bearer <accessToken>
```

无请求体，成功返回：

```json
{}
```

该接口只表示 Obsidian 已打开，不要求建立 WebSocket 或长连接。

### 4.3 拉取真实数据

```http
GET /v1/obsidian/sync/jobs?status=pending
GET /v1/obsidian/sync/jobs?status=pending&cursor=<cursor>
Authorization: Bearer <accessToken>
Accept: application/json
```

响应：

```json
{
  "jobs": [
    {
      "jobId": "job_daily_20260806_r1",
      "actraId": "daily_20260806",
      "type": "daily_summary",
      "revision": 1,
      "updatedAt": "2026-08-06T23:30:00+08:00",
      "content": {
        "title": "2026-08-06 每日总结",
        "date": "2026-08-06",
        "tags": ["daily", "real-data"],
        "body": "今天完成了 ACTRA 真实数据接口的字段确认。\n\n主要进展包括接口联调、录音转写检查和运动数据核对。"
      }
    },
    {
      "jobId": "job_conversation_01_r1",
      "actraId": "conversation_01",
      "type": "conversation",
      "revision": 1,
      "updatedAt": "2026-08-06T10:30:00+08:00",
      "content": {
        "title": "关于 ACTRA 接口的对话",
        "date": "2026-08-06",
        "tags": ["conversation", "real-data"],
        "summary": "讨论了 ACTRA 与 Obsidian 的数据联调方式。",
        "body": "**用户：** 请提供真实数据接口。\n\n**ACTRA：** 可以提供测试账号产生的对话数据。"
      }
    },
    {
      "jobId": "job_recording_01_r1",
      "actraId": "recording_01",
      "type": "recording",
      "revision": 1,
      "updatedAt": "2026-08-06T11:20:00+08:00",
      "content": {
        "title": "ACTRA 产品会议",
        "date": "2026-08-06",
        "tags": ["recording", "meeting", "real-data"],
        "summary": "会议确认了真实录音数据的联调方案。",
        "transcript": "这是 ACTRA 真实录音产生的转写内容。",
        "audioUrl": "https://app.actra.example/recordings/recording_01"
      }
    },
    {
      "jobId": "job_exercise_20260806_r1",
      "actraId": "exercise_20260806",
      "type": "exercise",
      "revision": 1,
      "updatedAt": "2026-08-06T23:35:00+08:00",
      "content": {
        "title": "2026-08-06 运动记录",
        "date": "2026-08-06",
        "tags": ["exercise", "real-data"],
        "exerciseRows": [
          { "项目": "步数", "数值": 8650, "单位": "步" },
          { "项目": "活动时长", "数值": 48, "单位": "分钟" },
          { "项目": "消耗热量", "数值": 326, "单位": "千卡" }
        ]
      }
    },
    {
      "jobId": "job_tasks_current_r3",
      "actraId": "tasks_current",
      "type": "task_collection",
      "revision": 3,
      "updatedAt": "2026-08-06T23:40:00+08:00",
      "content": {
        "title": "ACTRA 待办",
        "date": "2026-08-06",
        "tags": ["tasks", "real-data"],
        "tasks": [
          {
            "id": "task_real_001",
            "text": "提供 ACTRA 测试环境地址",
            "completed": false,
            "dueDate": "2026-08-08"
          },
          {
            "id": "task_real_002",
            "text": "核对真实录音转写",
            "completed": true
          }
        ]
      }
    }
  ]
}
```

有下一页时返回 `nextCursor`：

```json
{
  "jobs": [],
  "nextCursor": "opaque_cursor_2"
}
```

最后一页或没有数据时返回：

```json
{
  "jobs": []
}
```

### 4.4 成功回执

```http
POST /v1/obsidian/sync/jobs/{jobId}/ack
Authorization: Bearer <accessToken>
Content-Type: application/json
```

请求：

```json
{
  "path": "ACTRA/录音/2026-08-06-ACTRA 产品会议.md",
  "content_hash": "64e6f163c8c945f767fef1be6f30f4f98df29170d1e88f58bf14f90a2738a91c"
}
```

成功返回：

```json
{}
```

收到 `ack` 后，该 `jobId` 不应继续出现在 pending 列表中。重复提交同一个 `jobId` 的 `ack` 也应返回成功。

### 4.5 失败回执

```http
POST /v1/obsidian/sync/jobs/{jobId}/fail
Authorization: Bearer <accessToken>
Content-Type: application/json
```

请求：

```json
{
  "code": "CONFLICT",
  "message": "检测到本地修改，未覆盖原文件。",
  "path": "ACTRA/录音/2026-08-06-ACTRA 产品会议.conflict-20260806-113000.md"
}
```

`code` 可取：

- `PERMISSION_DENIED`
- `INVALID_TARGET`
- `CONFLICT`
- `LOCALLY_REMOVED`
- `FAILED`

成功返回：

```json
{}
```

## 5. 真实数据任务格式

### 5.1 外层任务字段

| 字段 | 类型 | 必填 | 数据来源/要求 |
| --- | --- | --- | --- |
| `jobId` | string | 是 | 本次同步任务 ID；建议 `{actraId}_r{revision}` |
| `actraId` | string | 是 | ACTRA 业务对象的真实稳定 ID |
| `type` | string | 是 | `daily_summary`、`conversation`、`recording`、`exercise` 或 `task_collection` |
| `revision` | integer | 是 | 从 1 开始；真实内容更新后必须递增 |
| `updatedAt` | string | 是 | ACTRA 数据实际更新时间，ISO 8601 |
| `content` | object | 是 | 对应类型的真实业务内容 |

ID 推荐只包含字母、数字、下划线和连字符，最长 100 个字符：

```text
^[A-Za-z0-9_-]{1,100}$
```

不要返回 `targetPath`，由插件根据类型、日期和标题在本地生成安全路径。

### 5.2 每日总结 `content`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 建议使用 `{date} 每日总结` |
| `date` | string | 是 | 总结归属日期，`YYYY-MM-DD` |
| `body` | string | 是 | ACTRA 生成的每日总结完整文本，可包含 Markdown |
| `summary` | string | 否 | 如存在比正文更短的概览，可单独提供 |
| `tags` | string[] | 否 | 例如 `daily`、项目标签 |
| `project` | string | 否 | 能明确关联项目时提供 |
| `tasks` | array | 否 | 当日总结中提取的真实待办 |

每日总结示例：

```json
{
  "title": "2026-08-06 每日总结",
  "date": "2026-08-06",
  "body": "今天完成了 ACTRA 真实数据接口的字段确认。\n\n主要进展包括接口联调、录音转写检查和运动数据核对。",
  "tags": ["daily", "real-data"]
}
```

如果 ACTRA 每日总结只有一个文本字段，统一映射到 `body`，不要只放在标题或未经约定的自定义字段中。

### 5.3 对话 `content`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 对话标题；没有标题时由服务端生成简短标题 |
| `date` | string | 是 | 对话发生日期，`YYYY-MM-DD` |
| `summary` | string | 否 | ACTRA 生成的真实对话摘要 |
| `body` | string | 是 | 对话正文，推荐使用 Markdown 和说话人标签 |
| `tags` | string[] | 否 | 例如 `conversation`、项目标签 |
| `project` | string | 否 | 能明确关联项目时提供 |
| `tasks` | array | 否 | 从对话中真实提取的待办 |

对话正文示例：

```json
{
  "title": "产品需求讨论",
  "date": "2026-08-06",
  "summary": "讨论了 Obsidian 真实数据联调需求。",
  "body": "**用户：** 需要哪些数据？\n\n**ACTRA：** 需要对话正文、标题、时间和稳定 ID。",
  "tags": ["conversation", "product"]
}
```

如果 ACTRA 原始数据按消息数组保存，请在接口层合并成 `body` 字符串。当前插件不会解析 `messages` 或 `segments` 数组。

### 5.4 录音转写与 AI 总结 `content`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 录音或会议标题 |
| `date` | string | 是 | 录音发生日期，`YYYY-MM-DD` |
| `transcript` | string | 是 | ACTRA 真实 ASR 转写文本 |
| `summary` | string | 是 | ACTRA 基于该录音生成的真实 AI 总结 |
| `audioUrl` | string | 否 | HTTPS 播放页或音频地址 |
| `tags` | string[] | 否 | 例如 `recording`、`meeting` |
| `project` | string | 否 | 能明确关联项目时提供 |
| `tasks` | array | 否 | 从录音中真实提取的待办 |

录音内容示例：

```json
{
  "title": "ACTRA 周会",
  "date": "2026-08-06",
  "summary": "确认了真实数据接口的字段和测试范围。",
  "transcript": "发言人 A：今天确认接口格式。\n发言人 B：我会提供测试环境。",
  "audioUrl": "https://app.actra.example/recordings/recording_01",
  "tags": ["recording", "meeting"]
}
```

如果 ACTRA 原始转写按时间片或说话人分段保存，请在接口层合并为 `transcript` 字符串。可以保留说话人名称，但当前插件不消费逐段时间戳。

`audioUrl` 必须使用 HTTPS。插件会把该链接写入 Markdown，但不会携带 API Bearer Token 打开链接，因此建议提供：

- ACTRA 登录后的稳定播放页面；或
- 在约定测试周期内有效的签名链接。

不要提供只能依赖接口 Header 鉴权的裸音频 URL。

### 5.5 AI 总结字段

AI 总结不是独立任务类型，统一使用 `content.summary`：

```json
{
  "summary": "会议确认了真实数据接口、字段映射和首轮联调范围。"
}
```

字段要求：

- 类型为 string；
- 返回真实 AI 生成结果，不返回用于演示的固定占位文本；
- 录音任务必须提供；
- 对话和每日总结如果有单独的 AI 摘要也应提供；
- 不要把录音转写和 AI 总结拼成同一个字段。

### 5.6 运动数据 `content`

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `title` | string | 是 | 建议使用 `{date} 运动记录` |
| `date` | string | 是 | 运动数据归属日期，`YYYY-MM-DD` |
| `exerciseRows` | object[] | 是 | 运动指标行；每个值只能是 string 或 number |
| `summary` | string | 否 | ACTRA 对当日运动情况的 AI 总结 |
| `tags` | string[] | 否 | 例如 `exercise`、`health` |

运动数据示例：

```json
{
  "title": "2026-08-06 运动记录",
  "date": "2026-08-06",
  "summary": "今日活动量达到日常目标。",
  "exerciseRows": [
    { "项目": "步数", "数值": 8650, "单位": "步" },
    { "项目": "活动时长", "数值": 48, "单位": "分钟" },
    { "项目": "消耗热量", "数值": 326, "单位": "千卡" }
  ],
  "tags": ["exercise", "real-data"]
}
```

`exerciseRows` 的列名可以按 ACTRA 实际数据扩展，例如距离、心率、睡眠或训练类型，但值不能是嵌套对象、数组、布尔值或 `null`。缺失指标建议省略，不要用虚构的 `0` 补齐。

### 5.7 待办数据 `content`

待办既可以放在每日总结、对话或录音的 `content.tasks` 中，也可以通过独立的 `task_collection` 任务提供。首轮联调要求至少提供一个独立待办集合。

```json
{
  "tasks": [
    {
      "id": "task_real_001",
      "text": "提供 ACTRA 测试环境地址",
      "completed": false,
      "dueDate": "2026-08-08"
    }
  ]
}
```

`id` 和 `text` 必填，`completed` 和 `dueDate` 可选；`dueDate` 使用 `YYYY-MM-DD`。

独立待办集合还必须包含：

```json
{
  "title": "ACTRA 待办",
  "date": "2026-08-06",
  "tasks": [
    {
      "id": "task_real_001",
      "text": "提供 ACTRA 测试环境地址",
      "completed": false,
      "dueDate": "2026-08-08"
    }
  ]
}
```

同一个待办在不同版本中必须保持相同 `id`。状态或截止日期发生变化时，提高外层 `task_collection.revision`。

## 6. ACTRA 原始数据映射建议

| ACTRA 原始字段 | 接口字段 | 转换规则 |
| --- | --- | --- |
| 每日总结/对话/录音/运动/待办集合主键 | `actraId` | 保持稳定，不使用临时请求 ID |
| 数据版本或更新时间版本 | `revision` | 转为从 1 开始的递增整数 |
| 同步任务 ID | `jobId` | 新版本生成新任务；任务重试保持不变 |
| 更新时间 | `updatedAt` | ISO 8601，保留时区 |
| 开始时间 | `content.date` | 转为数据发生地日期 `YYYY-MM-DD` |
| 每日总结文本 | `content.body` | 返回完整文本，可保留 Markdown 段落 |
| 对话消息数组 | `content.body` | 按发生顺序合并，保留说话人 |
| ASR 分段数组 | `content.transcript` | 按时间顺序合并，可保留说话人 |
| AI 摘要 | `content.summary` | 原样返回真实生成结果 |
| 录音播放地址 | `content.audioUrl` | 转为可点击的 HTTPS 地址 |
| 运动指标明细 | `content.exerciseRows` | 转为扁平对象数组，值仅使用 string 或 number |
| 抽取待办 | `content.tasks` | 保留稳定 task ID |

## 7. 队列和幂等要求

- 只返回当前 Token 绑定测试账号的数据。
- 同一条真实数据使用稳定 `actraId`。
- 内容更新时增加 `revision`，不要创建新的 `actraId`。
- 同一任务在收到 `ack` 前可重复返回，但必须保持相同 `jobId` 和内容。
- 收到 `ack` 后将任务移出 pending 队列。
- 单页建议不超过 20 条；有更多数据时使用不透明 `nextCursor`。
- 不要返回重复游标，插件最多处理 100 页。
- 服务端不下发删除 Obsidian 文件的任务。

## 8. 真实数据与隐私要求

- 使用专门的 ACTRA 测试账号和经授权的测试内容。
- 不使用未授权用户的总结、录音、对话、运动、待办或个人信息。
- 服务端日志不得记录完整 Access Token。
- 脱敏样例可替换姓名、电话、地址等信息，但联调接口应保留真实的数据结构、长度和换行特征。
- Token 撤销或测试结束后，应停止返回该账号的数据。
- 本轮接口只需读取 ACTRA 数据，不得修改或删除 ACTRA 原始总结、对话、录音、音频、运动和待办数据。

## 9. 建议准备的测试数据

请至少准备以下数据：

| 数量 | 数据 | 用途 |
| --- | --- | --- |
| 1 条 | 有多段正文的真实每日总结 | 验证 daily_summary 写入 |
| 1 条 | 有摘要和多轮正文的真实对话 | 验证 conversation 写入 |
| 1 条 | 同时有转写和 AI 总结的真实录音 | 验证 recording、transcript 和 summary 写入 |
| 1 条 | 带可访问 `audioUrl` 的录音 | 验证播放链接 |
| 1 天 | 包含至少 3 个真实指标的运动数据 | 验证 exerciseRows 表格 |
| 1 组 | 至少包含未完成和已完成状态的真实待办 | 验证 task_collection 和任务状态 |
| 1 次更新 | 对同一业务对象生成更高 `revision` | 验证原文件安全更新 |

## 10. 接口交付清单

- [ ] 测试环境 Base URL
- [ ] 6 位测试配对码或配对规则
- [ ] 测试账号及数据范围说明
- [ ] `claim` 接口
- [ ] `session-open` 接口
- [ ] `sync/jobs` 接口
- [ ] `ack` 接口
- [ ] `fail` 接口
- [ ] 一条脱敏 daily_summary 响应样例
- [ ] 一条脱敏 conversation 响应样例
- [ ] 一条同时包含 transcript 和 summary 的脱敏 recording 响应样例
- [ ] 一条脱敏 exercise 响应样例
- [ ] 一条脱敏 task_collection 响应样例
- [ ] `audioUrl` 的访问方式和有效期说明
- [ ] 测试数据更新时间与 `revision` 生成规则

完整的插件端协议、知识索引接口和异常约定参见 `docs/ACTRA-LOCAL-API.md`。
