# 双版本构建与独立验收

状态：实现完成，待独立 review 与作者内容确认。用户随后授权 Git 发布，发布版本为 v4.61.6；未部署、未修改 Vercel。下方本地完整验收记录来自升级版本号前的 v4.61.5 实现。

## 产品边界

同一引擎、32 支球队（16/8/8）、三级联赛、六项具名杯赛、四种现有游戏模式、三个推荐观察视角。参赛版只更换身份与交付策略，不更改规则或数值。沙盒模式仍可使用内置参赛球队，但不提供编辑器或导入。

球队与教练 ID 保留为不展示的兼容标识（包含历史英文缩写），保护球队、教练战术哈希和历史引用不变。大陆/南洲/东洲及地区相等关系保持不变；子地区改为虚构地名。姓名池长度、重复词元与所有 7,889 个可生成姓名的碰撞关系保持一致，避免姓名查重改变 RNG 消耗。通用姓氏为语言素材，不代表实际球员名单；原创姓名组合仍可能与现实人物重名。

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

## Vercel 配置对照（仅建议，尚未执行）

| 配置 | 现有个人项目 | 新参赛项目 |
| --- | --- | --- |
| Build Command | pnpm build:personal | pnpm build:contest |
| Output Directory | dist/personal | dist/contest |
| Install Command | pnpm install --frozen-lockfile | 同左 |
| Node | 22（本地验收 22.22.2） | 同左 |
| Production 变量 | 不需要版别变量；不要设审计开关 | CONTEST_SITE_URL=作者最终确认的独立 HTTPS 域名 |
| Preview 变量 | 同 Production 策略 | 同样必须明确 CONTEST_SITE_URL，可用正式 canonical，绝不沿用个人域名 |
| 审计开关 | 禁止 true | 禁止 true |
| 发布来源 | 个人日常分支 | 验收后固定参赛发布分支与 commit |

不要把两个项目都无约束跟随同一日常分支：参赛验收后固定发布版本，后续个人 push 不应自动覆盖参赛站。项目创建、部署分支、Preview 域名、域名绑定和发布授权由作者后续执行。

## 本地验证结果（2026-09-12）

- Node 22.22.2 / pnpm 10.34.5：153 个测试文件、1,060 项测试通过；最终聚焦回归 4 文件 / 35 项通过；TypeScript、ESLint、docs:check、scripts:check 通过。
- personal / contest / audit 三套生产/PWA 构建、模块/内容扫描和原性能预算均通过。初始 JS gzip 分别为 159,078 / 158,684 / 159,333 字节；PWA 预缓存分别为 86 / 83 / 86 项。没有放宽预算。
- 3 个种子（20260709、42、93896）各模拟 5 季，两版逐窗口比较完整数值投影、稳定身份、赛程、赛果与 RNG，无差异。姓名碰撞映射穷举通过。
- 两套正式包均在 1280×720、390×844 浏览器视口走完判断、锁定直播、战报、S1 跳过与档案、自动转会、S2 恢复、导出及离线重载；无横向溢出或控制台错误/警告。参赛版保留但不读取预置的个人存档和个人模板，直接编辑器路径受阻。
- 参赛正式包拒绝错误版别的远端 version.json，正常手动更新检查通过。通用 PWA 更新回归 verify:pwa-update 通过（独立 audit 包）。未进行 Vercel 真实双部署升级或物理手机测试。
- 标准 web-game Playwright client 执行并查看截图；还实际查看了移动直播、球队、设置版别、桌面开场/教练/赛季档案、专属 OG 和共享图片联系表。未新增音乐资源。
- 缺域名、冲突 APP_EDITION、正式构建开启审计、额外 --mode 参数均以非零状态退出。vercel.json 无差异。

## 尚待确认

见 [原创名称与素材审阅](contest-content-review.md)。命名是提案，不宣称已获授权或没有法律风险。不得发布前删掉“待确认”记录来代替审阅。

现有投稿材料原稿保留。后续需为参赛版重新制作：README/说明用图、欢迎/联赛/杯赛/人物/新闻/历史截图、试玩录屏、演示路线中的球队名、分享预览、二维码、投稿表单中的链接与离线说明。当前 docs/screenshots 仍为个人版，不随参赛包部署。
