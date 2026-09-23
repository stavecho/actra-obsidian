# ACTRA Obsidian 插件开发说明

> 文档版本：v0.3  
> 更新日期：2026-08-06  
> 文档状态：方案草案  
> 插件建议名称：ACTRA  
> 适用对象：产品、客户端、服务端、插件、算法、测试与安全团队

> 实现更新（2026-08-06）：生产连接已按 `oauth-integration.md` 改为 ACTRA OAuth 授权码流程，使用 `obsidian://actra-connect-oauth` 回调并支持 Refresh Token 轮换。本说明后文中的一次性配对码流程仅保留为早期方案背景和插件本地演示入口；生产联调以 `docs/ACTRA-OAUTH.md` 为准。
>
> 上传更新（2026-09-23）：用户确认 `readRoots` 后立即上传一次，后续默认在 Obsidian 运行时每 24 小时执行差异上传；用户可关闭自动上传并继续手动上传。ACTRA 同步文件统一添加 `actra-synced` 标签，并从两个上传入口中过滤。

## 1. 项目背景

ACTRA 是支持语音对话和录音的智能设备。用户可在 ACTRA App 中查看每日总结、待办、录音转写、录音 AI 总结、音频和运动数据等内容。

本项目通过 ACTRA Obsidian 社区插件，将 ACTRA 产生的数据同步至用户指定的 Obsidian Vault，并将用户明确授权的 Obsidian 笔记接入 ACTRA 知识检索。连接完成后，用户可以直接对 ACTRA 设备提问，例如：

> “帮我查询 Obsidian 里 XXX 项目的最新进度。”

ACTRA 在后台检索用户授权的笔记、生成带来源的回答，并通过设备播放简要结果；ACTRA App 展示完整回答、引用文件和路径。

本接入不是 Obsidian 账号 OAuth；生产环境通过 ACTRA 自身的 OAuth 授权页确认用户身份和数据权限。本地演示模式仍使用一次性数字建立无网络连接。

## 2. 产品目标

### 2.1 核心目标

1. 将 ACTRA 产生的总结、录音记录、灵感、待办和运动数据加入待同步队列，并在用户打开 Obsidian 后由插件主动拉取并写入 Vault。
2. 将用户授权的 Obsidian 目录接入 ACTRA 知识检索，支持设备语音查询和总结。
3. 将写入目录与读取目录分开授权，保证每次读取、写入和上传都受用户选择的目录与权限约束。
4. 支持离线队列、失败重试、幂等写入和冲突保护。
5. 在 ACTRA App 中提供连接、权限、最近同步时间和异常状态管理。

### 2.2 非目标

首个版本不包含以下能力：

- 删除任何 Obsidian 本地文件，包括 ACTRA 创建的文件；这是不可开放的产品和安全红线。
- 覆盖不属于 ACTRA 管理的笔记。
- 将 ACTRA 新数据实时推送并写入 Obsidian；数据只在用户打开 Obsidian 后由插件拉取，或由用户手动触发拉取。
- 保证 Obsidian 关闭或移动端进入后台时仍可执行本地写入。
- 代替 Obsidian Sync 完成用户设备间的 Vault 同步。
- 默认读取整个 Vault。
- 默认读取或上传附件。
- 默认将 Obsidian 任务状态回写 ACTRA。
- 依赖其他社区插件，例如 Dataview 或 Tasks，才能完成核心流程。

### 2.3 两项核心约束

#### ACTRA 数据采用“打开后拉取”，不采用实时推送

- ACTRA 产生新数据后，只在服务端创建待同步记录，不直接触达本地 Vault。
- 用户打开 Obsidian 并加载 ACTRA 插件后，插件主动向 ACTRA 拉取当前 Vault 的待同步数据。
- 插件完成本地写入并返回回执后，服务端才将任务标记为成功。
- Obsidian 已关闭或插件未启用时，数据继续保留在 ACTRA 待同步队列中。
- 一次 Obsidian 会话启动后新产生的 ACTRA 数据，不通过长连接实时写入；用户可点击“立即拉取”，否则在下次打开 Obsidian 时同步。

#### 读取 Obsidian 必须先授权文件夹

- `writeRoot` 表示 ACTRA 数据写入目录，例如 `ACTRA/`。
- `readRoots` 表示 ACTRA 获准读取、索引和查询的目录列表，默认是空数组。
- 写入权限不自动产生读取权限，即使 `writeRoot` 为 `ACTRA/`，ACTRA 也不能把该目录用于知识查询，除非用户同时将它加入 `readRoots`。
- 插件不得读取、上传或索引 `readRoots` 以外的文件，也不得因为笔记中存在链接而继续读取授权目录外的目标文件。
- 用户新增、移除或修改 `readRoots` 时，需要再次明确确认；移除目录后必须清理 ACTRA 持有的对应云端派生索引。

### 2.4 文件删除红线

ACTRA 与 Obsidian 集成不支持删除对方的原始文件，此约束不可通过配置、实验、管理员指令或服务端任务放开。

- ACTRA 插件不得删除、移入废纸篓或清空任何 Obsidian 本地文件，包括由 ACTRA 创建的 Markdown 和附件。
- 插件代码不得调用 `Vault.delete()`、`Vault.trash()`、`FileManager.trashFile()`、`DataAdapter.remove()`、`DataAdapter.rmdir()` 或同等文件删除能力。
- ACTRA 服务端协议不得定义或下发 `DELETE_FILE`、`TRASH_FILE`、`DELETE_FOLDER` 等本地删除任务。
- 用户解除连接、暂停同步、撤销目录授权或删除 ACTRA 云端源数据时，本地 Obsidian 文件必须保留。
- 用户在 Obsidian 中删除文件时，插件可以监听该事件用于更新映射和知识索引，但不得据此删除 ACTRA 中的源记录、录音、待办或其他业务数据。
- 用户删除由 ACTRA 创建的本地文件后，插件默认记录为 `LOCALLY_REMOVED`，不得自动重建；只有用户明确执行“重新同步/恢复文件”后才能再次创建。
- 撤销读取授权时可以且必须清理 ACTRA 云端保存的笔记副本、分块和向量索引。这属于清理 ACTRA 自己持有的派生数据，不是删除用户的 Obsidian 原始文件。

## 3. 官方 API 能力与边界

ACTRA 插件应仅使用 Obsidian 官方公开插件 API，不依赖内部 API。

| 需求 | 官方能力 | 实现结论 |
| --- | --- | --- |
| 获取 Vault 名称 | `Vault.getName()` | 支持；稳定 Vault ID 由 ACTRA 自行生成 |
| 创建目录 | `Vault.createFolder()` | 支持 |
| 创建 Markdown | `Vault.create()` | 支持 |
| 读取 Markdown | `Vault.read()`、`Vault.cachedRead()` | 支持 |
| 安全修改 Markdown | `Vault.process()` | 支持，后台修改优先使用 |
| 追加内容 | `Vault.append()` | 支持 |
| 修改 Properties | `FileManager.processFrontMatter()` | 支持 |
| 创建和读取附件 | `createBinary()`、`readBinary()` | 支持；大文件需单独测试 |
| 获取标题、路径和时间 | `TFile`、`FileStats` | 支持 |
| 获取标签、属性、标题和链接 | `MetadataCache` | 支持 |
| 识别 Markdown 任务 | `CachedMetadata.listItems` | 支持 |
| 监听文件变化 | Vault 的 `create`、`modify`、`rename`、`delete` 事件 | 支持，仅在插件运行时有效 |
| 监听元数据更新 | `MetadataCache.changed` 等事件 | 支持 |
| 关键词和模糊匹配 | `prepareSimpleSearch()`、`prepareFuzzySearch()` | 提供匹配函数，不提供完整 Vault 搜索服务 |
| 访问 ACTRA HTTPS 服务 | `requestUrl()` | 支持 |
| 保存 Token | `SecretStorage` | Obsidian 1.11.4+ 支持 |
| 语义搜索、向量索引 | 无 | 由 ACTRA 实现 |
| AI 总结和语音回答 | 无 | 由 ACTRA 实现 |
| 原生目录权限沙箱 | 无 | 由插件和 ACTRA 服务端共同限制 |
| App 关闭后后台运行 | 无 | 不支持；ACTRA 数据保留在待同步队列，等待用户再次打开 Obsidian |
| 多文件事务 | 无 | 由 ACTRA 同步层保证最终一致性 |

官方参考：

- [Obsidian Vault 开发文档](https://docs.obsidian.md/Plugins/Vault)
- [Obsidian 官方 TypeScript API](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
- [Obsidian SecretStorage 指南](https://docs.obsidian.md/plugins/guides/secret-storage)
- [Obsidian 插件开发政策](https://docs.obsidian.md/Developer+policies)
- [Obsidian 插件发布流程](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)

## 4. 总体架构

```text
┌──────────────┐       语音请求/播放结果       ┌──────────────────┐
│  ACTRA 设备   │ ◄──────────────────────────► │   ACTRA 云端服务   │
└──────────────┘                              │                  │
                                              │ 身份与配对        │
┌──────────────┐       连接与权限管理          │ 同步任务队列       │
│  ACTRA App   │ ◄──────────────────────────► │ 笔记知识索引       │
└──────────────┘                              │ 检索与 AI 总结     │
                                              └────────┬─────────┘
                                                       │ HTTPS
                                                       │ 打开 Obsidian 后主动拉取
                                              ┌────────▼─────────┐
                                              │ ACTRA Obsidian   │
                                              │ 插件              │
                                              └────────┬─────────┘
                                                       │ 官方 Vault API
                                              ┌────────▼─────────┐
                                              │ 用户 Obsidian     │
                                              │ Vault             │
                                              └──────────────────┘
```

### 4.1 架构原则

- ACTRA 云端不能直接访问用户本地 Vault。
- 插件是所有本地文件操作的唯一执行端。
- 插件只能主动连接 ACTRA 服务，不开放公网入站端口。
- ACTRA 不实时向 Obsidian 推送数据。服务端维护待同步队列，用户打开 Obsidian、插件完成加载后再主动拉取并执行。
- 默认不建立用于 ACTRA 数据写入的常驻长连接，也不在后台持续轮询。
- 本地写入成功并返回回执后，ACTRA 才能向用户反馈“同步成功”。
- 语音查询主场景推荐使用预先建立的云端知识索引，避免每次查询依赖 Obsidian 在线。

### 4.2 两个数据方向的触发规则

| 数据方向 | 触发方式 | 目录约束 |
| --- | --- | --- |
| ACTRA → Obsidian | 用户打开 Obsidian 后自动拉取；或用户点击“立即拉取” | 只能写入 `writeRoot` |
| Obsidian → ACTRA | 用户首次授权 `readRoots` 后立即上传；默认每 24 小时自动差异上传；也可随时手动上传 | 只能读取和上传 `readRoots` 内非 ACTRA 同步生成的内容 |

两个方向的目录权限互不继承。配置了写入目录，不代表 ACTRA 获得该目录或整个 Vault 的读取权限。

## 5. 插件模块划分

```text
src/
├── main.ts                 # 插件入口与生命周期
├── settings/               # 设置页、连接状态、权限配置
├── pairing/                # 一次性配对码与 Token 管理
├── api/                    # ACTRA HTTPS 拉取与上传客户端
├── permissions/            # 路径和能力权限校验
├── sync/
│   ├── inbound/            # ACTRA → Obsidian
│   ├── outbound/           # Obsidian → ACTRA 索引
│   ├── queue/              # 本地任务队列与重试
│   ├── conflict/           # 版本、哈希和冲突处理
│   └── mapping/            # ACTRA 对象与文件映射
├── vault/                  # Vault API 封装
├── search/                 # 本地关键词检索与内容选取
├── tasks/                  # Markdown 任务识别与状态同步
├── attachments/            # 附件下载、读取和大小限制
├── ui/                     # 配对、目录选择、提示和错误界面
└── utils/                  # 日志、哈希、路径、时间等工具
```

模块之间不得绕过 `permissions` 直接读写 Vault。

## 6. 连接与配对

### 6.1 前置条件

- 用户已登录 ACTRA App。
- 用户已经在当前 Vault 中安装并启用 ACTRA 插件。
- 插件可以访问 ACTRA HTTPS 服务。
- 每个 Vault 独立连接；同一 Vault 在不同设备上运行时，每个插件实例生成独立设备 ID。

### 6.2 推荐配对流程

1. 用户在 ACTRA App 的“三方应用”中选择 Obsidian。
2. ACTRA App 引导用户安装并启用社区插件“ACTRA”。
3. ACTRA App 生成一次性配对码。
4. 用户在插件设置页输入配对码。
5. 插件生成本地 `plugin_instance_id`，并提交：
   - 一次性配对码；
   - 插件实例 ID；
   - Vault 显示名称；
   - 平台和插件版本；
   - 申请的权限范围。
6. ACTRA App 展示待连接设备、Vault 名称和权限范围。
7. 用户在 ACTRA App 中确认连接。
8. 插件轮询配对结果，获得 Vault 级 Token。
9. 插件在本地分别配置：
   - ACTRA 数据写入目录 `writeRoot`；
   - 允许 ACTRA 读取的目录列表 `readRoots`，默认为空；
   - 可选附件目录。
10. 插件执行测试同步并返回本地写入回执。
11. ACTRA App 展示：“Obsidian 已连接，将同步至 ‘ACTRA’ 目录。”

目录应在 Obsidian 插件内做最终确认。ACTRA App 可以展示目录配置，但不应在用户授权前上传整个 Vault 的目录树。连接建立和测试写入只需要 `writeRoot`；配置 `readRoots` 是独立步骤，不能作为默认授权隐式开启。

### 6.3 配对安全要求

- 配对码有效期建议为 5～10 分钟。
- 配对码只能成功使用一次。
- 配对码绑定当前 ACTRA 登录会话。
- 限制错误尝试次数和频率。
- 用户在 ACTRA App 最终确认前，不下发正式 Token。
- Token 按 ACTRA 用户、插件实例和 Vault 连接签发。
- Token 支持轮换、过期和单连接撤销。
- 解除连接后，服务端立即使 Token 失效。
- Token 使用 `app.secretStorage.setSecret()` 保存，不写入插件 `data.json`。
- 插件最低 Obsidian 版本建议设为 1.11.4，以使用 `SecretStorage`。

### 6.4 连接状态

```text
UNPAIRED
  └── 输入配对码 → CLAIMING
        ├── 无效/过期 → PAIRING_FAILED
        └── 等待 App 确认 → PENDING_CONFIRMATION
              ├── 用户拒绝 → REJECTED
              └── 用户确认 → CONFIGURING
                    ├── 目录或权限未完成 → CONFIGURATION_REQUIRED
                    └── 测试同步成功 → CONNECTED

CONNECTED
  ├── 用户暂停 → PAUSED
  ├── Token 失效 → REAUTH_REQUIRED
  ├── 网络异常 → OFFLINE
  └── 用户解除连接 → REVOKED
```

## 7. 权限模型

Obsidian 官方 Manifest 没有原生的目录级权限字段。以下权限是 ACTRA 插件的逻辑权限，必须同时在本地和服务端校验。

| 权限标识 | 默认 | 说明 |
| --- | --- | --- |
| `service.connect` | 开启 | 连接 ACTRA 网络服务 |
| `notes.create` | 开启 | 在写入目录 `writeRoot` 创建 ACTRA 笔记 |
| `notes.update_managed` | 开启 | 修改由 ACTRA 创建和管理的内容 |
| `notes.read_authorized` | 关闭 | 读取用户逐个选择并确认的 `readRoots` 中的 Markdown |
| `upload.automatic` | 开启 | 在 Obsidian 运行时每 24 小时上传授权目录的变化；可关闭 |
| `upload.manual` | 可用 | 用户点击“手动上传”时立即执行，与自动上传开关无关 |
| `attachments.read` | 关闭 | 读取授权目录中的附件 |
| `attachments.write` | 关闭 | 将 ACTRA 附件下载到 Vault |
| `tasks.writeback` | 关闭 | 将 Obsidian 任务状态回写 ACTRA |
| `files.delete` | 永不提供 | 文件删除是安全红线，任何版本均不得通过插件删除 Obsidian 本地文件 |

### 7.1 路径权限校验

每次文件操作必须：

1. 使用 `normalizePath()` 规范化路径。
2. 拒绝绝对文件系统路径。
3. 拒绝包含越权语义的 `..` 路径。
4. 写入操作验证路径位于 `writeRoot`；读取、搜索和索引操作验证路径位于 `readRoots` 中的某个授权目录。
5. 默认只允许 `.md`；附件必须另行授权扩展名和目录。
6. 服务端下发的路径不得绕过本地权限校验。
7. 不允许访问隐藏配置目录和 `.obsidian` 目录。

### 7.2 读取文件夹授权流程

1. `readRoots` 初始值必须为空。
2. 用户在 ACTRA 插件中点击“添加读取目录”。
3. 插件展示目录选择器，并说明该目录的 Markdown 内容可能被发送至 ACTRA 用于查询和总结。
4. 用户逐个选择并确认目录。
5. 插件记录 Vault 内相对路径，不保存或上传本地绝对路径。
6. 只有同时开启 `notes.read_authorized` 后，插件才能读取这些目录。
7. 确认后立即上传一次；默认每 24 小时自动检查，也可关闭自动任务并只手动上传。
8. 用户移除目录后，插件立即停止读取，并通知 ACTRA 清理自己持有的该目录云端副本和派生索引。

授权目录采用包含子目录的语义。例如授权 `项目/ACTRA/` 后，可以读取其子目录；不能读取父目录、同级目录或笔记链接指向的其他目录。

## 8. ACTRA 数据同步至 Obsidian

### 8.1 支持的数据类型

| ACTRA 数据 | 默认文件形式 | 首版建议 |
| --- | --- | --- |
| 每日总结 | 每日一个 Markdown | 支持 |
| 录音 AI 总结 | 每段录音一个 Markdown | 支持 |
| 录音转写 | 写入录音 Markdown 正文 | 支持 |
| 录音音频 | ACTRA 链接或本地附件 | 默认链接，附件按需开启 |
| 对话摘要、灵感 | 每条或每日聚合 Markdown | 支持 |
| 待办 | 集中待办文件或来源笔记中的任务 | 支持 |
| 运动数据 | 每日 Markdown 属性和表格 | 支持单向同步 |

### 8.2 默认目录结构

```text
ACTRA/
├── 每日总结/
│   └── 2026-08-06.md
├── 录音/
│   └── 2026-08-06-ACTRA产品会议.md
├── 对话与灵感/
│   └── 2026-08-06.md
├── 待办/
│   └── 待办.md
├── 运动/
│   └── 2026-08-06.md
└── 附件/
    └── 2026-08-06-ACTRA产品会议.m4a
```

目录名称和映射规则允许用户配置，但所有输出必须位于同步根目录内。

### 8.3 Markdown 元数据

ACTRA 创建的笔记必须包含稳定的 frontmatter：

```yaml
---
actra_id: recording_01JXYZ
actra_type: recording
actra_managed: true
actra_revision: 3
actra_updated_at: 2026-08-06T10:30:00+08:00
actra_content_hash: sha256:example
date: 2026-08-06
project: ACTRA
tags:
  - actra
  - meeting
---
```

字段说明：

- `actra_id`：ACTRA 对象的全局稳定 ID，用于幂等写入。
- `actra_type`：`daily_summary`、`recording`、`conversation`、`idea`、`task_collection` 或 `exercise`。
- `actra_managed`：标识该文件包含 ACTRA 管理内容。
- `actra_revision`：服务端对象版本。
- `actra_updated_at`：ACTRA 数据更新时间。
- `actra_content_hash`：最近一次成功同步的受控内容哈希。

插件本地还应维护映射表，不得只依赖可被用户修改的 frontmatter：

```text
actra_id
→ vault_connection_id
→ file_path
→ last_revision
→ last_content_hash
→ last_synced_at
```

### 8.4 受控内容区块

为避免覆盖用户新增内容，ACTRA 可更新的正文应放在标记区块内：

```md
# ACTRA 产品会议

<!-- actra:managed:start recording_01JXYZ -->
## AI 总结

本次会议确认了插件配对、目录授权和同步冲突方案。

## 待办

- [ ] 完成插件配对接口设计
- [ ] 确认笔记上传授权文案
<!-- actra:managed:end recording_01JXYZ -->

## 我的补充

用户可以在这里自由编辑，ACTRA 不得覆盖。
```

更新前必须比较 `actra_revision` 和受控区块哈希。若用户修改了受控区块，不得直接覆盖。

### 8.5 音频策略

默认采用链接方式，避免大文件占用 Vault 空间：

```md
[在 ACTRA 中播放录音](https://app.actra.example/recordings/recording_01JXYZ)
```

用户开启“同步音频附件”后，插件才下载二进制音频并写入附件目录。需要设置：

- 单文件大小限制；
- 支持的音频格式；
- 下载超时和断点策略；
- 移动网络是否允许下载；
- 磁盘空间不足处理；
- 下载完成后再写入 Markdown 引用。

### 8.6 入站同步流程

```text
ACTRA 创建或更新数据
→ 服务端创建 sync_job
→ 数据进入待同步队列，不实时推送至 Obsidian
→ 用户打开 Obsidian
→ ACTRA 插件等待 workspace.onLayoutReady()
→ 插件主动拉取当前 Vault 的待同步任务
→ 校验 Token、scope、路径和 revision
→ 检查 actra_id 映射
→ 创建或安全更新文件
→ 重新读取并计算哈希
→ 返回成功回执
→ 服务端标记任务完成
→ ACTRA App/设备反馈同步结果
```

写入未完成前不得显示“同步成功”。如果 Obsidian 没有打开，ACTRA App 应显示“等待打开 Obsidian”，不能显示“正在写入”或“已同步”。

### 8.7 拉取触发与会话行为

- 自动触发：每次用户打开 Obsidian、插件加载且布局初始化完成后，执行一次待同步数据拉取。
- 手动触发：用户在插件设置页点击“立即拉取”。
- 首版不使用 ACTRA 服务端推送、常驻 WebSocket 或后台持续轮询来实时写入。
- 插件在同一次 Obsidian 会话完成启动拉取后，ACTRA 新产生的数据继续留在服务端队列，直到用户手动拉取或下次打开 Obsidian。
- 单次拉取应分页获取任务，并在每个任务写入成功后分别回执，避免一个失败任务阻塞整个批次。
- Obsidian 启动拉取失败时保留服务端任务，并在插件界面展示“拉取失败，可重试”。

## 9. Obsidian 数据接入 ACTRA

### 9.1 上传模式

- 插件只上传用户逐个授权的 `readRoots` 中的 Markdown。
- 确认目录授权后立即上传一次；后续默认每 24 小时自动执行差异上传。
- 用户可以关闭自动上传，且始终可以使用“手动上传”。
- ACTRA 同步生成的文件通过本地映射、`actra_managed`、`actra_id` 和 `actra-synced` 标签识别并过滤，避免循环回传。

### 9.2 初始索引流程

1. `readRoots` 默认为空，插件不读取任何用户笔记。
2. 用户选择一个或多个读取目录，并逐个确认授权。
3. 插件只统计已选目录内预计扫描的 Markdown 数量。
4. 用户明确确认“这些目录中的笔记内容将发送给 ACTRA 用于查询和总结”。
5. 插件调用 `getMarkdownFiles()` 获取文件对象后，必须先在本地按 `readRoots` 过滤，再调用 `cachedRead()`；不得先读取全文后再过滤。
6. 对每个授权文件读取：
   - Vault 连接 ID；
   - 文件路径和标题；
   - 创建、修改时间；
   - tags、frontmatter、headings、links；
   - Markdown 正文；
   - 内容哈希。
7. 插件分批上传 ACTRA。
8. ACTRA 服务端完成清洗、分块、embedding 和索引。
9. 服务端返回已索引文件数、失败文件数和最近索引时间。

### 9.3 差异上传

自动或手动上传都会扫描授权目录，以内容哈希和修改时间识别新增或修改的文件。插件不因每次编辑立即上传，避免用户连续输入时高频发送。重命名和删除事件只维护本地映射；当前 ACTRA 接口没有远端删除能力。

如果已授权文件被移动到 `readRoots` 之外，插件应按“移出授权范围”处理：停止读取并清理 ACTRA 云端派生索引，但不删除任何原文件。如果未授权文件被移动到 `readRoots` 之内，应按新增授权范围内文件处理。

### 9.4 云端索引记录

```json
{
  "vault_connection_id": "vault_conn_01JXYZ",
  "document_id": "doc_01JABC",
  "path": "项目/ACTRA/2026-08-05 周报.md",
  "title": "2026-08-05 周报",
  "content_hash": "sha256:example",
  "modified_at": "2026-08-05T18:00:00+08:00",
  "tags": ["actra", "weekly"],
  "properties": {
    "project": "ACTRA",
    "status": "in-progress"
  },
  "sync_revision": 8
}
```

云端不得保存本地绝对文件系统路径，只保存 Vault 内相对路径。

### 9.5 语音查询流程

```text
用户对 ACTRA 设备提问
→ 设备上传语音并完成 ASR
→ ACTRA 判断为 Obsidian 知识查询
→ 确定用户、Vault 和授权范围
→ 按标题、标签、属性、时间和语义检索
→ 对命中片段进行重排
→ 基于片段生成回答
→ 返回简短语音文本和引用来源
→ ACTRA 设备播放简要回答
→ ACTRA App 展示详细答案、引用片段和文件路径
```

设备回答示例：

> “XXX 项目已经完成需求评审和交互设计，插件开发正在进行，配对流程尚未完成测试。依据是 8 月 3 日的项目周报和 8 月 5 日的产品会议记录。详细来源已发送到 ACTRA App。”

### 9.6 回答要求

- 只能基于已授权和已检索到的内容回答。
- 未找到内容时不得推测或编造。
- 设备播报结论和少量来源名称，不朗读完整长路径。
- ACTRA App 展示完整文件名、Vault 内路径和引用片段。
- 回答中展示“Obsidian 最近同步时间”。
- 索引过期时应说明“根据最近一次同步的数据”。
- 多个 Vault 或同名项目存在歧义时，优先使用默认 Vault，否则向用户追问。

## 10. Markdown 待办同步

### 10.1 ACTRA 写入 Obsidian

```md
- [ ] 完成 Notion 接入方案 📅 2026-08-10
  <!-- actra_task_id: task_01J001 -->
- [ ] 开发 ACTRA Obsidian 插件 📅 2026-08-15
  <!-- actra_task_id: task_01J002 -->
- [ ] 测试插件配对流程 📅 2026-08-20
  <!-- actra_task_id: task_01J003 -->
```

Obsidian 原生 Markdown 任务只统一定义勾选状态。截止日期、负责人、项目和优先级需要 ACTRA 定义自己的兼容格式。

### 10.2 状态回写

只有开启 `tasks.writeback` 后，插件才监听 ACTRA 创建的任务：

1. 从 `CachedMetadata.listItems` 获取任务状态和位置。
2. 通过相邻的 `actra_task_id` 识别 ACTRA 任务。
3. 检测 `[ ]` 与 `[x]` 的变化。
4. 向 ACTRA 上传任务 ID、新状态、本地修改时间和文件路径。
5. 服务端执行版本检查并返回结果。

插件不得回写没有 `actra_task_id` 的普通用户任务。

## 11. 幂等、冲突与一致性

### 11.1 幂等规则

- 每个 ACTRA 对象使用稳定且唯一的 `actra_id`。
- 每个同步任务使用唯一 `job_id`。
- 插件保存 `actra_id → file_path` 映射。
- 重复执行同一个 `job_id` 时直接返回上次结果。
- 文件移动后，通过映射、frontmatter 和事件更新路径，不创建重复文件。

### 11.2 冲突判定

满足任意条件即视为冲突：

- 本地受控区块哈希与上次同步哈希不同。
- 本地 revision 与服务端基线不一致。
- 同一任务状态在两端同时变更。
- 原文件失去 ACTRA 标识，但本地映射仍存在。
- 目标路径已被其他文件占用。

### 11.3 冲突处理

- 不直接覆盖用户本地修改。
- 保留原文件。
- 创建冲突副本或将服务端版本写入单独文件。
- 在插件和 ACTRA App 中提示冲突。
- 记录原文件、冲突文件、两端 revision、哈希和时间。

冲突文件命名示例：

```text
2026-08-05-ACTRA产品会议.conflict-20260806-103000.md
```

冲突处理只能创建新文件或停止同步，不能通过删除原文件来“解决”冲突。若目标路径已存在，插件应使用新路径、生成冲突副本或等待用户处理。

## 12. 同步队列与重试

### 12.1 任务状态

```text
PENDING
→ WAITING_FOR_OBSIDIAN_OPEN
→ RUNNING
→ SUCCEEDED

RUNNING
├── 可重试错误 → RETRY_SCHEDULED
├── 权限错误 → PERMISSION_DENIED
├── 路径错误 → INVALID_TARGET
├── 冲突 → CONFLICT
├── 用户已删除本地文件 → LOCALLY_REMOVED
└── 永久错误 → FAILED
```

### 12.2 重试规则

- 网络超时、5xx、临时文件占用可重试。
- Obsidian 未打开不属于失败，任务保持 `WAITING_FOR_OBSIDIAN_OPEN`。
- `LOCALLY_REMOVED` 不自动重建文件，等待用户明确执行恢复或重新同步。
- Token 失效进入 `REAUTH_REQUIRED`，不无限重试。
- 权限不足和路径越界不得重试。
- 使用指数退避并加入随机抖动。
- 插件重启后恢复未完成的本地任务。
- 服务端任务必须有过期时间和最大重试次数。
- 用户手动点击“重新同步”时创建新 attempt，但保持原 `job_id` 幂等语义。

## 13. ACTRA 服务接口建议

以下为逻辑接口，最终路径和字段由服务端规范确定。

### 13.1 配对接口

```text
POST /v1/obsidian/pairings/claim
GET  /v1/obsidian/pairings/{pairing_id}/status
POST /v1/obsidian/connections/{id}/revoke
POST /v1/obsidian/tokens/refresh
```

### 13.2 入站同步接口

```text
GET  /v1/obsidian/sync/jobs?status=pending&cursor={cursor}
POST /v1/obsidian/sync/jobs/{job_id}/ack
POST /v1/obsidian/sync/jobs/{job_id}/fail
```

### 13.3 知识索引接口

```text
POST   /v1/obsidian/index/documents:batchUpsert
PATCH  /v1/obsidian/index/documents/{document_id}
DELETE /v1/obsidian/index/documents/{document_id}
POST   /v1/obsidian/index/reconcile
```

这里的 `DELETE` 只清理 ACTRA 云端持有的索引副本和派生数据，不能转换为 Obsidian 本地文件删除指令，也不能删除 ACTRA 的原始业务记录。

### 13.4 启动拉取与状态

```text
POST /v1/obsidian/connections/{id}/session-open
GET  /v1/obsidian/connections/{id}/configuration
POST /v1/obsidian/connections/{id}/pull-now
```

所有接口必须使用 HTTPS。首版使用 `requestUrl()` 在 Obsidian 启动后执行分页拉取和批量回执，不建立用于入站写入的 WebSocket，也不在 Obsidian 后台持续轮询。

## 14. 本地配置与数据存储

### 14.1 可保存至插件配置的数据

```json
{
  "pluginInstanceId": "plugin_01JXYZ",
  "vaultConnectionId": "vault_conn_01JXYZ",
  "writeRoot": "ACTRA",
  "readRoots": [],
  "attachmentRoot": "ACTRA/附件",
  "pullOnObsidianOpen": true,
  "automaticUploadEnabled": true,
  "permissions": {
    "readAuthorizedNotes": false,
    "readAttachments": false,
    "writeAttachments": false,
    "taskWriteback": false
  },
  "paused": false,
  "lastSuccessfulSyncAt": "2026-08-06T10:30:00+08:00"
}
```

### 14.2 不得明文保存的数据

- Access Token。
- Refresh Token。
- 配对过程中的临时凭据。
- 用户笔记正文缓存。
- 可恢复完整笔记内容的调试日志。

Token 保存至 Obsidian `SecretStorage`。配置中只保存 Secret ID。

## 15. 插件界面

### 15.1 设置页

至少包含：

- ACTRA 连接状态。
- 当前 Vault 名称。
- 插件实例/设备名称。
- 配对码输入。
- ACTRA 数据写入目录 `writeRoot`。
- 授权读取目录 `readRoots` 列表，默认显示“未授权任何目录”。
- “打开 Obsidian 时自动拉取”状态。
- “每 24 小时自动上传”开关，默认开启。
- “手动上传”按钮，不受自动上传开关影响。
- 附件同步开关。
- 任务状态回写开关。
- 最近成功同步时间。
- 待同步、失败和冲突数量。
- “立即拉取”“暂停同步”“管理读取授权”“解除连接”操作。

### 15.2 通知与错误

成功示例：

> 已同步至 `ACTRA/录音/2026-08-06-ACTRA产品会议.md`。

等待示例：

> ACTRA 已保存待同步数据。打开 Obsidian 后将由插件拉取并写入。

冲突示例：

> 检测到本地修改，ACTRA 未覆盖原文件，已创建冲突副本。

权限示例：

> ACTRA 没有读取该目录的权限。请在插件设置中添加授权目录。

## 16. 安全与隐私要求

- 文件删除属于不可放开的红线：插件运行代码和服务端指令中均不得出现本地文件删除操作。
- 解除连接、撤销授权和删除 ACTRA 云端数据只能停止同步或清理 ACTRA 自己持有的索引，不得触碰 Obsidian 原始文件。
- 默认只申请创建和更新 ACTRA 管理笔记的权限。
- `writeRoot` 与 `readRoots` 是两套独立配置，写入权限不得被解释为读取授权。
- 读取用户笔记、建立云端索引、读取附件和任务回写分别授权。
- 开启云端索引前必须明确告知笔记内容会发送至 ACTRA。
- ACTRA 只能索引用户明确选择的目录。
- 取消目录授权后，清理 ACTRA 自己持有的对应云端文档副本、分块和向量索引。
- 解除连接后撤销 Token，并停止所有同步任务。
- 本地已经生成的 Markdown 默认保留。
- 不记录正文、Token、配对码和完整检索片段到普通日志。
- 服务端返回的文件路径必须再次经过本地校验。
- 防止路径穿越、重放、伪造回执和同步循环。
- 插件不包含客户端遥测 SDK。
- README 必须披露 ACTRA 账户要求、网络访问、读取范围、数据上传和隐私政策。
- 设备播放 Obsidian 内容时，应支持锁屏查询、敏感内容播报和身份确认设置。

## 17. 桌面端与移动端兼容

### 17.1 通用实现要求

- 核心文件操作使用 `Vault` API，不直接使用 Node.js `fs`。
- 网络请求优先使用 `requestUrl()`。
- 使用 `Platform` 判断平台，不使用 `process.platform`。
- 不假设 `Vault.adapter` 一定是 `FileSystemAdapter`。
- 插件 Manifest 的 `isDesktopOnly` 应为 `false`，前提是所有首版能力均完成移动端验证。

### 17.2 移动端限制

- App 进入后台后网络和插件执行可能被系统暂停。
- ACTRA 数据写入明确采用打开 Obsidian 后拉取，不承诺也不尝试实时推送。
- 大音频下载可能造成内存压力，应默认关闭附件下载。
- 插件打开并完成布局初始化后执行待同步任务拉取；如果自动上传已到期，则执行授权目录差异上传。
- 自动上传仅在 Obsidian 运行时调度；错过的周期在下次打开时补执行。

## 18. 性能要求

- 插件 `onload()` 不执行全库读取和网络批量上传。
- 等待 `workspace.onLayoutReady()` 后执行 ACTRA 待同步任务拉取，并启动 24 小时上传调度。
- 初始索引分页读取和批量上传，避免一次加载全部正文到内存。
- 使用内容哈希和修改时间跳过未变化文件；不在每次编辑后立即上传。
- 使用内容哈希避免未变化文件重复上传。
- 仅扫描授权目录，不遍历无关目录正文。
- 大 Vault 初始同步可暂停、恢复和显示进度。
- 索引上传应设置并发和速率限制。

## 19. 日志与可观测性

允许记录：

- 事件类型和状态码。
- `job_id`、脱敏后的连接 ID。
- 文件类型、大小区间和耗时。
- 重试次数和错误分类。
- 成功、失败和冲突数量。

禁止记录：

- Token 和配对码。
- 完整 Markdown 正文。
- 用户查询原文，除非用户明确同意 ACTRA 服务端保存。
- 完整本地文件系统绝对路径。
- 附件原始内容。

插件本地应提供“导出诊断信息”，导出前再次过滤敏感字段。

## 20. 发布要求

- 插件 Manifest 名称建议为 `ACTRA`。
- 插件 ID 不得包含 `obsidian`，例如使用 `actra` 或 `actra-connect`。
- 测试阶段可手动安装 `main.js`、`manifest.json` 和 `styles.css`。
- 正式版提交 Obsidian 社区插件目录。
- 发布包通过 GitHub Release 提供。
- 插件不内置自己的代码自动更新器。
- README、LICENSE、隐私政策和服务条款必须齐全。
- 使用 `versions.json` 管理不同最低 Obsidian 版本的兼容性。
- CI 必须静态检查并阻止提交 `Vault.delete`、`Vault.trash`、`trashFile`、`DataAdapter.remove`、`DataAdapter.rmdir` 及等价删除调用；如第三方依赖包含删除能力，需要安全评审确认不会被插件执行。

## 21. 建议开发阶段

### 阶段一：单向写入 MVP

- 插件安装与一次性配对。
- Vault 和写入目录 `writeRoot` 配置。
- 每日总结、录音总结、转写、灵感和待办写入。
- ACTRA 服务端待同步队列，以及打开 Obsidian 后的插件主动拉取。
- `actra_id` 幂等。
- 离线任务、失败重试和写入回执。
- 暂停、解除连接和 Token 撤销。
- 不读取用户已有笔记，不同步附件，不做任务回写。

### 阶段二：Obsidian 知识索引

- `readRoots` 文件夹逐个授权，默认不授权任何目录。
- 初始上传、每 24 小时自动差异上传和手动上传。
- ACTRA 云端派生索引清理和权限撤销。
- ACTRA 设备语音查询。
- App 展示引用文件、路径和同步时间。

### 阶段三：双向和附件

- 任务状态回写。
- 音频和其他附件同步。
- 更完善的冲突处理。
- 仅在线本地检索模式。
- 多 Vault 查询与语音消歧。

## 22. 验收标准

### 22.1 连接

- 过期、已使用或错误配对码不能建立连接。
- 未经 ACTRA App 最终确认不能获得正式 Token。
- Token 不出现在插件 `data.json` 和普通日志中。
- 每个 Vault 能独立连接、暂停和撤销。
- 测试文件真正写入成功后才显示连接完成。

### 22.2 写入

- ACTRA 产生数据时只创建待同步任务，不尝试实时写入本地 Vault。
- Obsidian 未打开时，任务保持“等待打开 Obsidian”。
- 用户打开 Obsidian、插件完成加载后，能够自动拉取待同步任务。
- 同一次会话启动拉取后新产生的数据，不会被实时推送；点击“立即拉取”或下次打开 Obsidian 后再同步。
- 指定类型的数据能写入正确目录和 Markdown 格式。
- 同一 `actra_id` 重复同步不会创建重复文件。
- 用户移动文件后，插件能更新映射或提示异常。
- 用户修改受控区块时，后续同步不直接覆盖。
- 网络中断时任务保留，恢复后能够重试。
- 写入失败时 ACTRA 不反馈“同步成功”。
- 用户删除本地 ACTRA 文件后，插件不会自动恢复，除非用户明确选择重新同步或恢复。

### 22.3 读取与查询

- 新连接的 `readRoots` 默认为空；未授权文件夹前，插件不得读取任何用户笔记正文。
- 读取、搜索和上传都只能发生在用户逐个确认的 `readRoots` 内。
- 配置 `writeRoot` 不会自动授予该目录的读取权限。
- 只上传授权目录中的 Markdown，且不得跟随链接读取授权目录外的笔记。
- 未开启云端索引时，不持续上传笔记正文。
- 新建、修改、移动和删除文件后，云端索引最终一致。
- 取消目录授权后，对应索引不可再被查询。
- 回答包含引用文件名和 Vault 内路径。
- 没有检索依据时明确回答“未找到”，不生成推测内容。
- Obsidian 离线时，设备可基于最近一次云端索引回答并说明同步时间。

### 22.4 待办

- ACTRA 待办包含稳定的 `actra_task_id`。
- 默认不监听和回写任务状态。
- 开启任务回写后，只处理 ACTRA 创建的任务。
- 两端同时修改时不静默覆盖。

### 22.5 安全

- 插件无法通过任何界面、配置、远程任务或异常分支删除或移入废纸篓中的 Obsidian 文件。
- 解除连接、撤销授权和 ACTRA 源数据删除后，本地 Obsidian 文件仍然保留。
- Obsidian 文件删除事件不会导致 ACTRA 源记录被删除。
- 代码扫描确认不存在 `Vault.delete()`、`Vault.trash()`、`FileManager.trashFile()`、`DataAdapter.remove()` 和 `DataAdapter.rmdir()` 调用。
- 路径穿越测试无法访问授权目录外的文件。
- 服务端伪造越权路径会被插件拒绝。
- 解除连接后旧 Token 无法继续调用接口。
- 插件不读取 `.obsidian` 和其他未授权目录。
- 关闭附件权限后不能读取或上传附件。

## 23. 待确认事项

以下内容需要产品、技术和安全团队在开发前确认：

1. ACTRA 服务端保存完整 Markdown，还是只保存分块后的文本和元数据。
2. Obsidian 笔记内容的保存区域、加密方式、保留期限和删除 SLA。
3. 是否提供“仅在线查询”模式，以及其产品优先级。
4. 默认写入目录 `writeRoot` 是否固定为 `ACTRA`，用户是否可分别配置各数据类型目录。
5. 音频首版是只写 ACTRA 链接，还是支持本地附件下载。
6. 待办采用集中 `待办.md`，还是写入原始会议笔记，或同时支持。
7. 同一个 ACTRA 对象是否允许同步到多个 Vault。
8. 多设备连接同一 Vault 时，如何识别同一知识库并避免重复索引。
9. 用户修改文件名、移动文件或删除 `actra_id` 后的恢复策略。
10. 设备锁屏状态和公共空间中播放敏感笔记的身份验证规则。
11. 用户在一次 Obsidian 会话内完成启动拉取后，是否还需要在窗口重新获得焦点时再拉取一次；首版默认只支持手动拉取或下次打开时拉取。
12. 运动数据的 Markdown 字段和单位标准。

## 24. 关键结论

ACTRA 与 Obsidian 的核心能力可以基于官方社区插件 API 实现，但应明确职责边界：

- Obsidian 官方 API 负责本地文件、元数据、任务和事件访问。
- ACTRA 插件负责在用户打开 Obsidian 后拉取待同步数据，并负责写入目录、读取授权目录、索引上传和冲突保护。
- ACTRA 云端负责配对、待同步队列、知识索引、语义检索、AI 总结和权限撤销，不直接实时写入本地 Vault。
- ACTRA 设备负责语音输入和结果播放。
- ACTRA App 负责详细结果、引用来源和连接权限管理。

ACTRA 数据写入 Obsidian 采用“服务端暂存、用户打开 Obsidian 后插件主动拉取”的非实时模式。ACTRA 获取 Obsidian 数据时，用户必须先逐个授权 `readRoots`；插件不能读取授权文件夹之外的内容。授权后立即上传一次，后续默认在 Obsidian 运行时每 24 小时自动检查，用户也可以关闭自动任务并独立使用手动上传。

任何同步、冲突处理、解除连接和授权变更都不得删除对方的原始文件：ACTRA 不删除 Obsidian 文件，Obsidian 的文件删除事件也不删除 ACTRA 源数据。
