# 双版本构建与独立验收

品牌更名版本：v4.61.9《下一季见：足球编年史》，已获 Git 提交与推送授权，腾讯云部署另行进行。见 [品牌验收](brand-rename.md)。下方 v4.61.8 及更早记录描述当时的发布状态。

当前源码发布版本：v4.61.8，增加默认关闭的 ICP 备案展示。以下部署状态为此前验收记录，不代表本次已部署；腾讯云启用参数见 [部署文档](tencent-cloud-deployment.md)。

当前发布：v4.61.7。2026-09-12 用户明确选择并授权“双 Vercel 项目、同仓库同 main、不同构建命令与输出目录、自动更新各自 Production 域名”。现已部署：个人站 https://kurt-football.vercel.app ，参赛站 https://kurt-football-cup.vercel.app 。不要求固定参赛分支或冻结更新。Linux CI build job 已通过，但独立 browser-audit 仍失败；作者内容确认仍待完成。以下较早版本数字为历史验证记录，最新云端交接见 output/vercel-deployment-handoff-2026-09-12.md。

历史实施状态：当时实现完成，待独立 review 与作者内容确认；用户随后授权 Git 发布 v4.61.6，当时尚未部署或修改 Vercel。下方早期本地完整验收记录来自升级版本号前的 v4.61.5 实现；当前发布状态以上段为准。

## 跨平台部署修复验收（2026-09-12）

- 基线 f2a7a34 / v4.61.6。Workbox 页面排除改为大小写敏感的 URL transform，保留 `teams-*.js` 共享模块、仅排除 `Teams-*.js` 页面；OG 两种格式均不预缓存。预算门禁新增初始静态 JS 依赖完整性断言，不增加原预算。
- Node engines 限定 22.x，验收固定 22.22.2 / pnpm 10.34.5。Node 大版本不是该大小写问题的根因。
- 本地 macOS 三套构建、版别检查与预算通过。personal：86 项 / 2,096,330 B，contest：84 项 / 1,914,774 B，audit：86 项 / 2,097,274 B。初始 JS gzip 分别为 159,155 / 158,725 / 159,403 B。构建 ID 使用本地版本号；云端提交 SHA 会产生少量字节差异，必须重新检查。
- Linux 状态后续更新：GitHub CI #134（run 34676771238，提交 4271635）的 build job 已通过三版构建/检查/预算及 Linux 正式版/PWA 验证；browser-audit 的完整 smoke 失败，具体 Linux 子脚本日志需登录获取。本地同 SHA 原样 smoke 首个失败是 audit:advance-performance，不能直接当作已证实的 Linux 根因。
- 参赛域名 `https://kurt-football-cup.vercel.app` 已在 2026-09-12 正式部署。按用户最新选择，两个项目都跟随 main，使用各自构建命令、输出目录和项目变量；保留版别与预算门禁，不另设冻结分支策略。
- 参赛命名确认、OG 待审阅标识与公开 slug 方案见 `contest-content-review.md`；原 ID 不变，不承诺产物不存在现实指代。

## 产品边界

同一引擎、32 支球队（16/8/8）、三级联赛、六项具名杯赛、四种现有游戏模式、三个推荐观察视角。参赛版只更换身份与交付策略，不更改规则或数值。沙盒模式仍可使用内置参赛球队，但不提供编辑器或导入。

球队与教练 ID 保留为稳定兼容标识（包含历史英文缩写），保护球队、教练战术哈希和历史引用不变。这些 ID 仍可见于 `/team/:id`、`/coach/:id`、JSON 导出和 JS 产物，并非完全不展示或已去除所有现实指代。大陆/南洲/东洲及地区相等关系保持不变；子地区改为虚构地名。姓名池长度、重复词元与所有 7,889 个可生成姓名的碰撞关系保持一致，避免姓名查重改变 RNG 消耗。通用姓氏为语言素材，不代表实际球员名单；原创姓名组合仍可能与现实人物重名。

## 构建命令

锁定 Node 22.22.2 / pnpm 10.34.5。命令拒绝额外参数，不接受用 --mode 或 --outDir 改版别。APP_EDITION、APP_PRESET_ID 或 VITE_ENABLE_AUDIT 与命令冲突时失败。

| 用途 | 命令 | 产物 | 身份 |
| --- | --- | --- | --- |
| 个人正式 | pnpm build:personal（pnpm build 同义） | dist/personal | personal / personal-v1 |
| 参赛正式 | CONTEST_SITE_URL=<独立 HTTPS origin> pnpm build:contest | dist/contest | contest / three-shores-v1 |
| 本地审计 | pnpm build:audit | dist/audit | personal / personal-v1，audit=true |

审计包不能部署。正式包即使外部注入 VITE_ENABLE_AUDIT=true 也会失败。buildId 包含版别、预设、构建目标及部署 SHA（本地回退版本号）。version.json 与 build-manifest.json 可直接核对；后者提供实际模块图。Vite 在解析阶段选择唯一预设，并把参赛版编辑器与日志替换成独立模块，不依赖隐藏 UI 或 tree-shaking 删除个人数据。

本地参赛验收可显式使用保留域名：

```sh
CONTEST_SITE_URL=https://contest.invalid pnpm build:contest
CONTEST_SITE_URL=https://contest.invalid pnpm preview:contest --host 127.0.0.1 --port 4185
pnpm preview:personal --host 127.0.0.1 --port 4186
pnpm verify:editions
```

contest.invalid 仅用于本地验证，不是已经存在的参赛站，禁止作为正式配置发布。preview:contest 也要求相同 CONTEST_SITE_URL。审计脚本使用 preview:audit；不要再把根 dist 作为产物目录，旧 dist/index.html 不会被新命令读取。

## 存档与资源

- personal 保持 football-universe-save、既有偏好 key、schema 25、旧档 Env → 台积（含冻结历史快照）兼容。
- contest 使用 football-contest-three-shores-v1: 前缀；存档外层增加 edition/presetId，schema 不升级。跨版身份在恢复时拒绝，不做旧档转换。
- contest 暂时关闭全部手动存档导入，包括参赛备份再导入；导出只是备份，自动保存与刷新恢复可用。恢复导入功能前必须增加完整内容验证，不能只信任 edition 标签。
- 导航隐藏编辑入口，直接 /team-editor 路由重定向，编辑器模块不入包，initializeGameWorld 的 customTeams 参数和 importCurrentSave 底层入口也拒绝。模板、个人存档不能通过正常产品路径回流。不防御开发者工具任意改本地代码。
- contest 不复制 public 目录，仅白名单复制 favicon、通用应用图标与图标集合，生成专属分享图/robots/sitemap/LICENSE。当前共享 vercel.json 的缓存头与 SPA 路由完全保留。
- PWA cacheId、运行时资源缓存与版本检测按版别区分；不同版别/预设的 version.json 不能被当作本版更新。两站应使用独立域名，不支持同源子目录混装。

## 可重复验收

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build:personal
BUILD_TARGET=personal pnpm budgets:check
BUILD_TARGET=personal pnpm editions:check
CONTEST_SITE_URL=https://contest.invalid pnpm build:contest
BUILD_TARGET=contest pnpm budgets:check
pnpm editions:check
pnpm build:audit
BUILD_TARGET=audit pnpm budgets:check
BUILD_TARGET=audit pnpm editions:check
pnpm docs:check
pnpm scripts:check
```

失败路径：无 CONTEST_SITE_URL 的 build:contest、APP_EDITION=personal 的 build:contest、VITE_ENABLE_AUDIT=true 的任一正式构建、build:contest -- --mode personal 均应失败。不要用 VITE_ENABLE_AUDIT=true pnpm build 代替 build:audit。

scripts/contest-forbidden-content.json 是可审阅禁止清单，覆盖预设球队/教练全名、个人站/仓库 URL、模板与审计全局。扫描实际 HTML/JS/JSON/SVG/XML/CSS/TXT/manifest，并禁止 source map；不检查二进制图像文字，不等于绝对合规。需结合截图与素材人工审阅。

## Vercel 配置对照（2026-09-12 已执行）

| 配置 | 现有个人项目 | 新参赛项目 |
| --- | --- | --- |
| Build Command | pnpm build:personal | pnpm build:contest |
| Output Directory | dist/personal | dist/contest |
| Install Command | pnpm install --frozen-lockfile | 同左 |
| Node | 22（本地验收 22.22.2） | 同左 |
| Production 变量 | 无项目变量；显式个人构建命令锁定版别 | APP_EDITION=contest、APP_PRESET_ID=three-shores-v1、VITE_ENABLE_AUDIT=false、CONTEST_SITE_URL=https://kurt-football-cup.vercel.app |
| Preview 变量 | 同 Production 策略 | 上述四变量同时配置到 Preview |
| 审计开关 | 禁止 true | 禁止 true |
| 发布来源 | main，自动 Production 发布 | main，自动 Production 发布 |

两项目均使用 Automatic Ignored Build Step，并开启 Production 域名自动分配。表内为核心构建命令；实际 Vercel 命令还串联对应 `BUILD_TARGET=personal/contest pnpm editions:check` 和 `BUILD_TARGET=personal/contest pnpm budgets:check`。任一步失败均不得发布新产物。现有命令不等待或运行整套 GitHub browser smoke，因此不要把 Vercel Ready 等同于完整 CI 通过。此前创建的 codex/contest-release 分支保留但不再作为发布源，无需维护或合并它。

## 本地验证结果（2026-09-12）

- Node 22.22.2 / pnpm 10.34.5：153 个测试文件、1,060 项测试通过；最终聚焦回归 4 文件 / 35 项通过；TypeScript、ESLint、docs:check、scripts:check 通过。
- personal / contest / audit 三套生产/PWA 构建、模块/内容扫描和原性能预算均通过。初始 JS gzip 分别为 159,078 / 158,684 / 159,333 字节；PWA 预缓存分别为 86 / 83 / 86 项。没有放宽预算。
- 3 个种子（20260709、42、93896）各模拟 5 季，两版逐窗口比较完整数值投影、稳定身份、赛程、赛果与 RNG，无差异。姓名碰撞映射穷举通过。
- 两套正式包均在 1280×720、390×844 浏览器视口走完判断、锁定直播、战报、S1 跳过与档案、自动转会、S2 恢复、导出及离线重载；无横向溢出或控制台错误/警告。参赛版保留但不读取预置的个人存档和个人模板，直接编辑器路径受阻。
- 参赛正式包拒绝错误版别的远端 version.json，正常手动更新检查通过。通用 PWA 更新回归 verify:pwa-update 通过（独立 audit 包）。未进行 Vercel 真实双部署升级或物理手机测试。
- 标准 web-game Playwright client 执行并查看截图；还实际查看了移动直播、球队、设置版别、桌面开场/教练/赛季档案、专属 OG 和共享图片联系表。未新增音乐资源。
- 缺域名、冲突 APP_EDITION、正式构建开启审计、额外 --mode 参数均以非零状态退出。vercel.json 无差异。

## 腾讯云双站（2026-09-14 已上线）

个人版使用 `https://football.dyp02.vip`，参赛版使用 `https://cup.dyp02.vip`。两版仍取同一份源码，分别构建，独立域名、目录、资源与存储，不支持同源子目录混装。原 Vercel 设置及其 main 自动部署保留；腾讯云当前为手动发布，不随 Git push 自动更新。

新增可选 `PERSONAL_SITE_URL`，默认个人 Vercel 地址不变。腾讯云构建为两版都指定 `PERSONAL_SITE_URL=https://football.dyp02.vip` 和 `CONTEST_SITE_URL=https://cup.dyp02.vip`；正式审计关闭、对应版别命令与产物/预算门禁不变。两地址必须是独立 HTTPS origin，不接受路径、认证、query 或 hash；两版 HTML metadata 与个人 robots/sitemap 均采用配置地址。

上线包以 main/4271635 加尚未提交的域名补丁构建，buildId 显式包含 `local-92e86c85a80b`；本轮没有 commit/push。目录、证书、发布、回滚与真实验收边界见 [腾讯云部署与维护](tencent-cloud-deployment.md)。

## 内容与材料待确认

见 [原创名称与素材审阅](contest-content-review.md)。命名是提案，不宣称已获授权或没有法律风险。不得发布前删掉“待确认”记录来代替审阅。

现有投稿材料原稿保留。后续需为参赛版重新制作：README/说明用图、欢迎/联赛/杯赛/人物/新闻/历史截图、试玩录屏、演示路线中的球队名、分享预览、二维码、投稿表单中的链接与离线说明。当前 docs/screenshots 仍为个人版，不随参赛包部署。
