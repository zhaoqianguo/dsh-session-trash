# 发布到插件市场（awesome-dsh-plugin / dshmarket）

目标：让 `awesome-dsh-plugin.com/index.json` 与 `dshmarket.com/index.json` 里出现本插件，用户能在 DSH「插件 → 发现」里一键安装。

## 0. 先搞清楚：这两个"市场"是同一份目录

你截图里加的两个索引源，指向的是**同一份数据**的两个镜像：

| 索引源 | 实际内容 |
| --- | --- |
| `https://awesome-dsh-plugin.com/index.json` | 精选目录（6565 条）的 JSON 快照 |
| `https://dshmarket.com/index.json` | 同一份目录的另一个站点镜像 |
| `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json` | 同一份目录的 npm/CDN 版（dshmarket 官方推荐，跨境更快） |

两个站点都不自己收录条目。dsh-market 的 README 原话：**"This repo is the market app, not the catalog. The plugin list comes from the curated awesome-dsh-plugin registry — to get your plugin listed in the market, open a PR there"**。

目录由 CI 每天生成：读 GitHub 仓 `awesome-dsh-plugin/awesome-dsh-plugin` 里 `data/plugins/*.yml`（一插件一文件）→ 补上 npm 版本、star 数、下载量、能力扫描 → 生成 `plugins.json` / `index.json`。

**所以：投一次 PR，两个市场同时出现。**

## 1. 收录条件（来自官方 contributing.md）

- 仓库里有真实可用的代码（占位、抢名、纯 README 的仓库不收）；
- `package.json` 声明 `dsh.bundle` manifest（本插件已有 `dsh.bundle.patch` + `cordis.patch.yml`）；
- 仓库**创建满 1 天**（CI 自动检查，PR 前几分钟新建的仓库会被拦）；
- 仓库加 `dsh-plugin` topic；
- 描述准确：写了几件事就要真有几件事、提到的命令/API 要真的存在（夸大是主要打回原因）；
- 分类选贴合实际行为的（本插件 = `session`）；
- 项目处于活跃维护状态（长期停更会被扫描标记并移除）。

## 2. 两种发布形态，先选一个

| | A. 只发 GitHub（快） | B. GitHub + npm（完整） |
| --- | --- | --- |
| 目录里的安装命令 | `dsh plugin add github:<owner>/dsh-session-trash` | `dsh plugin add @<scope>/dsh-session-trash` |
| 是否需要 npm 账号 | 不需要 | 需要 |
| 是否要改包名 | 不用 | 要（当前 `@local/...` 无法 publish） |
| 市场卡片 | 无版本号/下载量，但照样能装 | 有版本号、下载量，安装走 registry |
| 适用 | 今天就想上架 | 想长期发版、被更多人装 |

目录里 **3182 / 6565** 条插件没有 npm 包，都是走 A 的，所以 A 完全被接受。建议：**A 先上架，之后随时能补 B**（补的时候把 `name` 改成已发布的 npm 名即可）。

## 3. 具体操作

### 3.1 本地仓库（已替你准备好）

本目录已经是「仓库根」：`LICENSE`、`.gitignore`、`README.md`（中英双语）、`package.json`（含 license / repository / keywords / engines）、`market-entry.yml`（可直接提交的条目）。

先在本地验收一次：

```sh
cd /Users/zhaolanbaobao/Desktop/code/my-agent/session-trash
npm test                 # 25 个用例应全绿
npm pack --dry-run       # 看发布清单：12 个文件（5 个 js + cordis.patch.yml + locale×2 + icon + package.json + README + LICENSE）
# 若 npm 报 EPERM（本机 ~/.npm 权限问题）：npm_config_cache=/tmp/npmcache npm pack --dry-run
git init -b main
git add .
git commit -m "feat: session trash bin for DeepSeek Harness (delete / restore / purge / retention / stats / archive takeover)"
```

### 3.2 创建 GitHub 仓库并推送

1. GitHub → **New repository** → 名字 `dsh-session-trash` → **不要**勾选 "Add a README / .gitignore / license"（本地已有）→ Create。
2. 推送：

   ```sh
   git remote add origin git@github.com:<owner>/dsh-session-trash.git
   git push -u origin main
   ```

3. 仓库页 **About 右侧齿轮 → Topics** 加 `dsh-plugin`（也顺手加 `deepseek-harness`、`session`）。

> ⚠️ 如果你 GitHub 用户名不是 `zhaoqianguo`，把这三处一起改掉：
> `package.json` 的 `repository` / `homepage` / `bugs`，`market-entry.yml` 的 `url` 与 `name`，README 里的 `github:<owner>/...`。
> 一条命令搞定：`grep -rl zhaoqianguo . | xargs sed -i '' 's/zhaoqianguo/<owner>/g'`

### 3.3（可选）发 npm —— 想走 B 的话

```sh
# 1. 包名改成你自己的 scope（npm 上 dsh-session-trash 已被别人占用）
#    package.json: "name": "@<npm用户名>/dsh-session-trash"
# 2. 同步改 cordis.patch.yml 里的 name: 为同一个包名
# 3. 本地重装一次（插件页移除旧条目 → 重新粘贴路径安装），确认新 id 能激活
# 3.5 之前先修一次 npm 缓存权限（本机 `~/.npm` 里有 root 拥有的文件，会让所有 npm 命令 EPERM）
sudo chown -R 501:20 ~/.npm

npm login
npm publish --access public
```

目录的 npm 字段来自**仓库 package.json 的 name** + registry 查询，所以只要仓库里的 name 是已发布的包名，下一次目录刷新就会自动显示版本号和下载量，安装命令也会换成 registry 形式。

### 3.4 提交条目 PR

1. Fork <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>。
2. 在你的 fork 里新建 **一个** 文件：`data/plugins/<owner>__dsh-session-trash.yml`
   （文件名规则：`owner__repo.yml`，monorepo 子包写 `owner__repo--packages-sub.yml`）
3. 内容直接复制本目录的 [market-entry.yml](./market-entry.yml)。
4. 开 PR，标题 `Add <owner>/dsh-session-trash`，描述里写：
   - 这个插件做什么（3 句话以内）、装完在哪里看到（侧栏「回收站」图标 / 会话右键菜单）；
   - 已在你机器上实测（macOS + DSH 0.2.x）：`npm test` 25 通过；
   - 和已有条目的差异（若评审问重复）：容量统计、批量清理、归档接管、10 个工具、零依赖。
5. 等 CI 变绿 → 维护者读代码 → 合并。

> **时间线提醒**：仓库必须建满 1 天，CI 才会放行。今天建仓库 + 今天提 PR = CI 红；最稳的是仓库建好后等一天再提。

### 3.5 合并之后

- 目录每天刷新，通常 **24 小时内**出现在两个市场里。
- 自查：

  ```sh
  curl -s https://awesome-dsh-plugin.com/plugins.json | grep -o 'dsh-session-trash[^"]*' | head
  ```

  或直接打开 `https://awesome-dsh-plugin.com/p/<owner>/dsh-session-trash/`。
- 安装命令（A 形态）：`dsh plugin --profile web add github:<owner>/dsh-session-trash`
- 如果 15 秒内拉不到 index.json（国内网络常见），把索引源换成 jsdelivr 那条：`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`。

## 4. 条目描述怎么写才过审

- **en 必填**，以句号结尾；含 `": "` 必须加引号（YAML 会当嵌套键解析）；中文可留空由维护者补。
- 描述里的每个数字都会被核对：本插件确实是 **10 个工具**（`session_trash_*`），别写成 11 个。
- 目录会扫出能力标签（`fs-read` / `fs-write` / `env` / `llm`）。本插件会读写 `~/.dsh`，标签如实出现，不用遮掩。
- 不写「最好用」「革命性」这类词；只说功能。
- 分类 `session`（Sessions & Messages）最贴切；选偏了维护者会直接改，不会打回。

## 5. 上架之后要维护什么

- 定期扫描会检查仓库是否存活/归档/长期停更；被标记的条目进跟踪 issue，复核后移除。所以发版要持续。
- 每次发版：npm 版本号递增（B 形态），README 的能力表与工具数保持和代码一致（描述与代码不一致是打回主因）。
- 用户报 bug 会落在 GitHub Issues，建议开 issue 模板。
- 本地开发目录和市场安装版是两套（`link:` vs `github:`/`npm`），插件 id 相同，不能同时装。

## 6. 一个已知的同名插件

npm 上 `dsh-session-trash`（v0.1.1，2026-08 发布）是别人做的同类插件，只声明了 `dsh.client`、没有 `dsh.bundle.patch`（按官方标准属于「不可安装」）。这正是为什么我们的包名要用自己的 scope，也说明 PR 里讲清差异化（统计 / 批量 / 归档接管 / 10 工具 / 零依赖）是有必要的。
