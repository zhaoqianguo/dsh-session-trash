# 会话回收站 · Session Trash for DeepSeek Harness

Adds a **real trash bin** to DeepSeek Harness. DSH's built-in *archive* only records a session id in a set — the log file never leaves the disk. This plugin turns deletion into a recoverable flow: right-click a session → **Delete session** moves it into `~/.dsh/session-trash`, where it can be restored, purged permanently, or expired automatically after a configurable retention period. It also takes over archived sessions (list, unarchive, move to the bin) and reports capacity for bin / archived / active sessions. 10 agent tools included.

Install: `dsh plugin --profile web add github:<owner>/dsh-session-trash`, or install a local checkout by pasting its absolute path into **Plugins → + → Install third-party plugin**. Zero runtime dependencies; no build step.

---

## 中文说明

给 DSH 补上**真正的删除**：DSH 自带的「归档」只是把会话 id 记进一份集合，日志文件永远留在磁盘上。这个插件把它变成可管理、可回收、可彻底清除的流程，并顺带接管归档会话的管理和磁盘占用统计。

## 它做了什么

| 能力 | 入口 |
| --- | --- |
| 删除会话（移入回收站） | 侧栏会话行右键 → **删除会话**，一键完成（可恢复，所以不再二次确认），底部弹出提示「已移入回收站」 |
| 打开面板（回收站 / 归档两个页签） | 侧栏面板栏 → **回收站** 图标；想直接落在归档页签，则右键菜单 → **查看归档会话** |
| 容量统计 | 面板顶部三块 chip：回收站 / 归档 / 活动会话各自的**条数 + 占用** |
| 批量操作 | 回收站页：全选 / 恢复选中 / 彻底删除选中 / 清理已过期；归档页：取消归档选中 / 移入回收站选中 |
| 接管归档 | 归档页列出仍存在于磁盘上的归档会话，可直接**取消归档**（恢复回侧栏）或**移入回收站**（之后才按保留天数清理） |
| 恢复 / 彻底删除 / 清空 / 改保留天数 | 回收站页的每行按钮 + 底部 footer |
| 不可撤销操作的确认 | 彻底删除单个 / 批量、清空回收站都会弹一个确认框（标题 + 影响范围 + 取消/确认），不再用「再点一次」 |
| 过期自动清理 | 启动后 10 秒扫一次，之后每小时扫一次 |
| agent 自助操作 | 10 个工具，见下表 |

### agent 工具

| 工具 | 作用 |
| --- | --- |
| `session_trash_list` | 列出回收站条目，附带总占用与归档统计 |
| `session_trash_delete` | 把会话移入回收站 |
| `session_trash_restore` | 从回收站恢复 |
| `session_trash_purge` | 彻底删除单条 |
| `session_trash_purge_many` | 彻底删除一批（`session_ids` 数组） |
| `session_trash_empty` | 清空回收站 |
| `session_trash_settings` | 读/写保留天数（0 = 永不自动删除） |
| `session_trash_archive_list` | 列出归档会话及其占用 |
| `session_trash_archive_delete` | 把归档会话移入回收站 |
| `session_trash_archive_restore` | 取消归档 |

## 它怎么工作（原理）

DSH 的会话在磁盘上是：

```
~/.dsh/sessions/--<编码后的工作区路径>--/session-<uuid>/session.v4.jsonl.zstd
```

「归档」的状态不在文件里，而在 `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds` 数组里，由 `ctx.workspaceRegistry` 服务维护。所以删除分两步：

1. `ctx.workspaceRegistry.archiveSession(id)` —— 侧栏里那一行立刻消失；归档门（ArchivedSessionGate）也会拒绝再唤醒该会话的 agent，避免它继续往被移走的文件里写。
2. 把整个会话目录 `rename` 到 `~/.dsh/session-trash/items/<id>/session`，同目录写 `meta.json`（标题、原工作区、删除时间、过期时间、占用字节）。

恢复 = 目录搬回原位置 + `unarchiveSession`；彻底删除 = `rm -rf` 并把 id 从归档集合里摘掉。任何一步失败都会回滚归档状态。

归档页签只做「读」和两个动作（取消归档 / 移入回收站）：归档本身**不会**被自动删除，只有移入回收站之后才受保留天数约束 —— 这样「接管归档」不会变成「偷偷清理归档」。

磁盘布局：

```
~/.dsh/session-trash/settings.json           { "retentionDays": 30 }
~/.dsh/session-trash/items/<sessionId>/meta.json
~/.dsh/session-trash/items/<sessionId>/session/   ← 原来的会话目录
```

保留天数存在 `settings.json` 而不是插件配置里，因为面板上要能直接改；`0` 表示永不自动删除。

## HTTP 路由

客户端只打一个端点 `POST /api/session-trash`，body 形如 `{ "action": "...", ... }`，错误也返回 200 + `{ ok: false, code, error }`。跨源保护见下面的「同源策略」一节。支持的 action：

`list` / `panel` / `delete` / `restore` / `restore-many` / `purge` / `purge-many` / `empty` / `settings` / `purge-expired` / `archive-list` / `archive-restore` / `archive-delete`。

`panel` 一次返回面板所需的全部内容（回收站条目 + 归档条目 + 三项统计 + 设置 + 根目录），避免打开面板时打三四次请求。

## 文件

| 文件 | 作用 |
| --- | --- |
| `index.js` | Host 侧 Cordis 插件：注册 `/api/session-trash` 路由、10 个 agent 工具、定时清理 |
| `trash-store.js` | 纯 `node:fs` 的回收站实现（无 DSH 依赖，可单测） |
| `sessions-scan.js` | 只读磁盘的扫描层：读 `workspace.json` 的归档/工作区映射、扫 `sessions/` 目录、从 projcache 兜底读标题 |
| `tool-schema.js` | 自带的最小 `defineTool`：把工具参数 DSL 编译成 JSON Schema（**不 import 任何 DSH 内部包**，原因见下） |
| `client.js` | Web 侧客户端 bundle：两个右键菜单项（查看归档会话 / 删除会话）+ 回收站/归档双页签面板 |
| `cordis.patch.yml` | 补丁层：把插件插进 profile 的插件树 |
| `test/trash-store.test.mjs` | 回收站存储层单测（含 id 越界防护） |
| `test/host-route.test.mjs` | Host 侧路由/回滚/统计/批量/归档/工具契约的集成测试（真实 http 请求） |
| `test/client-smoke.test.mjs` | 客户端 bundle 的加载、槽位注册、页签切换冒烟测试 |

## 安装

### 从插件市场 / GitHub 装（发布后）

```sh
dsh plugin --profile web add github:<owner>/dsh-session-trash
```

发布到插件市场后，市场卡片上的安装按钮等价于上面这条命令。

### 从本地目录装（开发时）

1. DSH 侧栏 → **插件** → 右上角 **+** → **安装第三方插件**。
2. 规格填本目录的**绝对路径**（插件管理器接受本地目录；它会把该目录 `pnpm add` 成 `link:` 依赖，并因为这个包声明了 `dsh.bundle.patch` 自动把它加进 profile 的插件栈）：

   ```
   /Users/zhaolanbaobao/Desktop/code/my-agent/session-trash
   ```

3. 装完 **重启 DSH**。Host 侧代码（路由、工具、定时器）不会热替换；客户端 bundle 也在重启后才重新加载。
4. 重启后：侧栏面板栏多一个**回收站**图标；会话行右键菜单多出**查看归档会话**、**删除会话**。回收站本身从面板图标进入，右键菜单里不再放一个重复的「打开回收站」。

### 为什么插件不 import DSH 内部包

第一版 `index.js` 里写了 `import { defineTool } from '@deepseek-ai/dsh-tools'`，装到 DSH 里会报：

```
failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package
'@deepseek-ai/dsh-tools' imported from .../session-trash/index.js
```

原因：该包只存在于 **DSH 应用包内部**（`app.asar/node_modules`），不在 profile 的 `~/.dsh/profiles/<profile>/node_modules` 里；本地目录插件被 link 进 profile 后，Node 从插件真实路径向上找 `node_modules`，永远找不到它。第三方插件要么自带依赖，要么不依赖 DSH 内部包。

本插件的选择是**零依赖**：`tool-schema.js` 复刻了官方 `defineTool` 中本插件用到的那部分（参数 DSL → JSON Schema + 严格参数校验），其余全部只用 `node:` 内置模块。`ctx.tools.register()` 需要的也只是 `{ name, description, parameters, output: { schema, render }, execute }` 这个普通对象。副作用是：插件目录里没有 `node_modules` 也能跑，自测不需要 stub 任何 DSH 包。

### 卸载 / 数据

- 卸载：插件页移除本插件 → 重启 DSH。插件不会删回收站数据。
- 彻底清盘：退出 DSH 后 `rm -rf ~/.dsh/session-trash`（回收站条目 + 设置一起没）。
- 改本地代码：改完重启 DSH 即可（`link:` 依赖指向原目录，不用重装；本插件没有构建步骤）。

## 自测（不用装插件也能跑）

```
cd session-trash && npm test
```

25 个用例，分三层：

- **存储层**：移入 / 元数据 / 重复与缺失会话 / 恢复 / 恢复冲突 / 彻底删除 / 清空 / 过期扫描 / 设置持久化与钳制 / 非法 id（`../../evil`）不许越界。
- **Host 集成**：把 `index.js` 复制进一个没有 `node_modules` 的临时目录，真实起 http server 打 `/api/session-trash`，验证 panel 统计、批量恢复/彻底删除、归档列表/取消归档/移入回收站、删除失败回滚归档、跨源 403、**不带 Origin 的 POST / loopback 别名 / 自定义 scheme 放行**、`text/plain` 415、10 个工具的契约（同时也验证了零依赖：任一 `@deepseek-ai/*` 裸 import 都会让这组用例直接失败）。
- **客户端**：伪造 `window.__ModuleLoader__` + React stub + 假 `document`，验证 bundle 能加载、4 处槽位注册的 id/order/label 正确、菜单删除一次点击即调用 Host 并弹出成功/失败 toast、面板里不再出现「再点一次」文案。

## 发布到插件市场

把本插件收录进 awesome-dsh-plugin 目录（`awesome-dsh-plugin.com/index.json` 与 `dshmarket.com/index.json` 是同一份目录的两个镜像）的完整步骤、条目 YAML 模板和评审要求，见 [PUBLISHING.md](./PUBLISHING.md)；可直接提交的条目文件在 [market-entry.yml](./market-entry.yml)。

安装到 DSH 之后，随便删一个会话，然后对 agent 说「列出回收站」—— 它会调用 `session_trash_list`，能列出就说明 Host 侧通了。侧栏同时应该出现「回收站」图标。

## 已知边界

- **恢复后侧栏可能要刷新**：归档状态是实时推送的（删除立刻消失），但恢复后会话行要等客户端重新拉一次会话列表；面板会提示「刷新页面（⌘R / Ctrl+R）」。
- **正在运行的会话删不掉**：`archiveSession` 会拒绝有活动工作的会话，插件把错误翻译成「这个会话还有正在运行的工作，先停止它再删除」。
- **统计是实时扫盘的**：每次打开面板 / 刷新都会 stat 一遍所有会话目录算占用，会话上万时会慢一点（每轮只 stat 不解压，通常几十毫秒级）。
- 彻底删除会把 id 从 `archivedSessionIds` 里清掉（`unarchiveSession` 对不存在的会话是空操作，DSH 官方明确允许这种状态），所以 `workspace.json` 不会留幽灵条目。
- **删掉当前正在看的会话**：会话文件会真的被移走，但主界面仍停留在那个会话上（内容已经加载进内存）。切到别的会话或刷新即可；数据在回收站里，可以恢复。
- 回收站条目的标题在删除那一刻由侧栏标题快照写入 `meta.json`；没给标题时回退到 projcache 里的标题。之后标题生成器再改名不会同步过来。
- 只清理 `sessions` 目录下的会话日志。`~/.dsh/storages/session_projcache/sessions/<id>.json`（标题/折叠缓存）与 `~/.dsh/attachments/` 下被引用的附件不会被回收：前者是惰性读取、身份不匹配就作废的小文件，后者是内容寻址、可能被多个会话共享的 blob，删了有风险。
- 一键删除没有二次确认，因为它只把会话移进回收站，30 天内都能恢复；真正不可撤销的彻底删除才有确认框。
- 右键菜单里点删除后菜单会关掉，所以反馈走底部浮层提示（toast）；失败时 toast 变红并显示 Host 返回的原因（例如「这个会话还有正在运行的工作」）。

### 同源策略（为什么不再严格比对 Origin）

早期版本要求 `Origin` 与 `Host` 完全一致，结果真机上删除全部 403「只接受同源请求」：桌面壳的页面可能以自定义 scheme 或 `Origin: null` 发出 fetch，也可能是同一个 loopback 服务换了写法（`localhost` vs `127.0.0.1`）。现在的规则只拒绝「恶意网页能真正造成的东西」：

1. **没带 `Origin`** → 放行（浏览器同源 GET/HEAD 本来就不带，桌面壳的 POST 也可能不带）；
2. **`Origin: null`** → 只要 `sec-fetch-site` 不是 `cross-site` 就放行；
3. **非 http(s) scheme**（如 `app://`）→ 放行，只有桌面壳能产出这种 Origin；
4. **http(s) origin** → host 相同、或双方都是 loopback（`127.0.0.1` / `localhost` / `::1` / `0.0.0.0`）才放行；`sec-fetch-site: cross-site` 直接拒绝；
5. **真正的 CSRF 防线是 content-type**：POST 必须是 `application/json`（否则 415）。跨站表单或 `no-cors` 请求只能发 CORS 安全列表里的类型，改成 JSON 就必然触发预检，而这条路由从不回应预检。

被拒绝时会往 DSH 日志里打一行 `[session-trash] rejected a cross-origin request`，带上 origin/host/sec-fetch-site，方便排查壳子的差异。

### 彻底删除会不会弄坏 DSH

不会。会话日志是 DSH 的唯一真相，删掉一个会话目录等价于「这个会话从未存在过」。DSH 只会在下面几处见到它的残影，且全部是惰性、可容忍的：

1. `global.archivedSessionIds`（删除时写入）——彻底删除时已同步清除；
2. 工作区记录的 `sessionIds` 槽位——DSH 的 `sessionIds` getter 用 `candidateMatches` 按「会话是否还在」过滤，读写都不报错；
3. `session_projcache` 折叠缓存——按 id 存、打开时校验格式与血统（identity），孤儿记录永远匹配不上；
4. 进程内存里的全文索引（session-search 用 `:memory:` SQLite）——重启前可能仍能搜到该标题，点开只会提示会话不存在。
