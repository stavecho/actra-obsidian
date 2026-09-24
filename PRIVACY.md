# Actra Obsidian 插件隐私政策

生效及更新日期：2026-09-24

本政策适用于 Actra Obsidian 插件 `1.0.0`。插件默认连接 `https://api.stavecho.com`；用户也可以在连接前配置其他 ACTRA HTTPS 服务地址。配置其他地址时，数据将发送到用户所选的服务，其数据处理规则由该服务的运营方负责。

## 插件处理的数据

### ACTRA 账户和授权数据

连接时，插件会在浏览器中打开 ACTRA OAuth 授权页，并向配置的 ACTRA 服务发送公开 Client ID、回调地址、申请的权限、随机 state 和一次性授权码。邮箱、验证码及权限确认由 ACTRA 授权页处理，插件不读取或保存用户的密码和邮箱验证码。

插件获得的 Access Token、Refresh Token 和临时 OAuth state 只保存在 Obsidian `SecretStorage`。插件设置文件 `data.json` 仅保存 Secret ID、Token 有效期、最终授权范围及同步设置，不保存 Token 或笔记正文。

### 从 ACTRA 同步到 Obsidian 的数据

授权后，插件按用户确认的权限从 ACTRA 获取 dailylog、note 和 recording 数据，并在当前 Vault 中创建或更新 Markdown。生成的文件包含来源标识和 `actra-synced` 标签，避免再次上传给 ACTRA。

这些本地 Markdown 会保留在 Vault 中，直至用户自行删除。解除 ACTRA 连接不会删除已经创建的本地文件。

### 从 Obsidian 同步到 ACTRA 的数据

插件默认不读取任何已有笔记。只有用户逐个确认的读取目录及其子目录中的 Markdown 才会被读取和上传。写入 ACTRA 数据的目录不会自动获得读取权限，笔记中的链接也不会扩大授权范围。

上传内容包括 Markdown 正文、Vault 相对路径、标题、标签、属性、标题层级、链接、创建及修改时间和内容哈希。这些数据用于 ACTRA 的数据同步与索引。插件不会上传本地绝对文件系统路径或授权目录外的文件。

授权目录确认后，插件会立即上传一次，并在 Obsidian 运行时默认每 24 小时检查新增或修改的文件。用户可以关闭自动上传，手动“立即上传”仍可使用。本地内容哈希和修改时间用于避免重复发送未变化的文件。

## 网络目标和用途

插件只向用户配置的 ACTRA HTTPS 服务发起 OAuth、Token 刷新、数据拉取和上传请求，不包含第三方广告、分析或遥测 SDK。默认网络目标是 `https://api.stavecho.com`。

发送到 ACTRA 服务的数据用于登录授权、在 ACTRA 与 Obsidian 之间同步内容，以及为用户授权的 Markdown 建立 ACTRA 索引。插件不会出售这些数据，也不会将其用于广告画像。

## 保存、撤权和删除

- 移除读取目录后，插件立即停止读取和上传该目录；关闭自动上传会停止每 24 小时的计划任务。
- 解除连接会清除保存在 Obsidian `SecretStorage` 中的 ACTRA Token，并停止后续联网同步；本地 Markdown 和不含正文的同步映射仍保留，供用户自行管理。
- 当前 ACTRA upload 接口没有远端删除能力，因此移除目录或解除连接不会删除此前发送到 ACTRA 的副本。
- ACTRA 服务端副本的保存期限和账户删除流程由 ACTRA 服务管理。用户需要访问、更正或删除服务端数据时，应通过 ACTRA 账户中的支持渠道提出请求。
- 卸载插件后，Obsidian 会停止运行插件；用户可在 Vault 的插件设置中移除残留的本地配置。已创建的 Markdown 不会被插件自动删除。

## 安全措施

生产地址必须使用 HTTPS。OAuth Token 使用 Obsidian `SecretStorage` 保存；路径在每次读写前会规范化，并拒绝绝对路径、父目录跳转、隐藏目录、非 Markdown 文件和授权根目录外的路径。

## 日志和诊断

插件的普通错误状态不包含 Token、验证码或笔记正文。用户主动导出的诊断文件包含插件版本、连接状态、Vault 相对授权路径、计数和脱敏错误，不包含 Token、验证码、完整笔记正文或本地绝对路径。诊断文件只写入用户的 Vault，是否分享由用户决定。

## 政策变更和联系

隐私处理方式发生实质变化时，本政策会随插件版本更新。有关插件隐私、数据处理或删除请求的问题，可通过 [Actra Obsidian 仓库 Issues](https://github.com/stavecho/actra-obsidian/issues) 联系项目维护者；涉及 ACTRA 账户和服务端数据的请求，也可通过 ACTRA 账户中的支持渠道提出。
