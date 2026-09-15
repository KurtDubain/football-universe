# 下一季见：足球编年史 · 品牌更名验收

品牌版本 v4.61.9；更名提交 `f0b2d63` 已于 2026-09-15 00:00（北京时间）另行 review 并发布至腾讯云两站，详见 [腾讯云部署与维护](./tencent-cloud-deployment.md)。个人版与参赛版使用同一品牌，“三岸纪”仍是参赛世界预设。以下本地结果保留更名实现阶段的验收边界。

## 公开入口清单

- 欢迎页：下一季见 / 足球编年史 / 从一场球开始，跟一支球队过赛季。
- 侧栏、移动抽屉、PWA short_name：下一季见。设置、浏览器标题、OG、Twitter、JSON-LD、加载占位与图标无障碍名称使用相应全名/短名。
- 两种语言资源保留中文正式品牌，不创造英文名。普通“宇宙”描述不机械替换。
- Logo 的旧 FLU 字形路径移除，改为年鉴页线；favicon 与 192/512 PNG 同步球场/页线图形。
- 两套 OG SVG/PNG 同步主标题、副标题、宣传语；个人网址和参赛预设审阅标识保留。
- 赛季 Canvas 导出使用中文全名；下载文件技术前缀不变。
- README、当前状态、有效美术规范更新；历史 changelog、旧报告、旧截图与 output 材料不重写。

品牌纯数据集中于 `src/config/brand.ts`，由 Vite 与测试配置注入 `__APP_BRAND__`。这是编译期文案常量，不是新运行时系统：避免新增共享 JS 分块触碰 86 项预缓存上限。

## 保留的技术身份

`football-universe` 包名、仓库 URL、域名、目录、导出前缀、存储/恢复键；`personal` / `contest`、`personal-v1` / `three-shores-v1`；PWA id/scope/start_url/cacheId；所有模拟和存档逻辑均不改。

旧品牌文字允许出现在负向测试/扫描规则、历史文档和原始截图中；不是运行界面。`NEW UNIVERSE` 是新宇宙开局栏目描述，不作为英文游戏名。README 旧截图明确注明版本，后续换用独立新截图，不能覆盖原件。

## 本地验收命令

Node 22.22.2 / pnpm 10.34.5。先按部署文档的腾讯云 origin 与 ENABLE_ICP_FILING=true 构建两版，运行各自 editions:check / budgets:check。构建检查也核对实际 HTML 品牌、manifest 品牌与不变的 PWA 身份，扫描最终文本产物旧品牌。

```sh
pnpm exec tsx scripts/render-contest-share.ts
pnpm typecheck
pnpm lint
pnpm test
pnpm docs:check
pnpm scripts:check
VERIFY_BRAND=true VERIFY_OUTPUT_DIR=output/playwright/brand-v4.61.9 pnpm verify:editions
pnpm exec tsx scripts/verify-brand-saves.ts
```

浏览器脚本使用已运行的 personal 4186 / contest 4185 正式预览，保存新路径截图、档案图片和报告。旧档脚本读取既有腾讯云 QA 导出档（只读），可通过 BRAND_SAVE_FIXTURES 指定同名文件所在目录；不清理任何真实用户站点的浏览器数据。

## 本地结果

- 全量 156 个测试文件 / 1,069 项测试通过；最后语言资源同步后相关 13 项测试再次通过。typecheck、lint、docs:check、scripts:check、changelog:check 通过。
- personal、contest、audit 的生产/PWA 构建、edition/brand 扫描和预算通过；预缓存条目仍为 86 / 84 / 86。未放宽任何门禁。
- 两版各 1280×720、390×844、320×568：欢迎、抽屉、判断、直播、战报、S1档案、图片下载、转会、S2、设置、刷新、离线、版别隔离通过，控制台错误/警告和横向溢出为零。备案单独覆盖 12 个页面状态。均是 Chromium 模拟视口，不是真机测试。
- 读取已有 v4.61.7 两版 QA 存档，在新品牌下刷新后推进 S2 第0到第1窗口，保持 schema 25 和各自 edition/preset，无清档或转换。
- PWA 更新与真实旧包切换通过：从 HEAD 的旧品牌包切换到 v4.61.9，弹窗期间延迟刷新、关闭后仅刷新一次，存档前后保留，新入口加载成功、旧入口不再加载、离线历史可访问，runtimeErrors=[]。
- 两套分享图均 1200×630：个人 468,366 B、参赛 469,115 B；图标 192×192 / 4,050 B，512×512 / 10,752 B。已打开实际 PNG 与导出档案图检查，无旧字形、缺字或裁剪。
- 截图和报告仅写入新目录 `output/playwright/brand-v4.61.9`。未覆盖旧 output 材料。未执行云端部署、系统图标缓存真机刷新、完整性能 smoke 或投稿素材重制。

## 修改文件分组

品牌与元信息：`src/config/brand.ts`、`src/build-env.d.ts`、`index.html`、`vite.config.ts`、`scripts/edition-plugin.ts`、`src/locales/{zh,en}.json`。

界面与图片：Welcome、Layout、Settings、AppErrorBoundary、Logo、season-archive-image；public favicon/192/512/OG 与 contest OG；`scripts/render-contest-share.ts`。

验收：brand/Logo/Welcome/edition/AppErrorBoundary 测试、Vitest 品牌常量、edition 产物检查、verify-editions/brand-saves/mobile-routes/pwa-deployment-transition/icp-filing。发布元信息：package/version、两版新增 changelog、README/current-status/art-direction/build-editions、本记录及 progress。已有腾讯云部署文档修改属于进入任务前的工作区内容，本轮保留而未改动。

## 后续素材清单

需要另行重新导出：README 当前品牌截图、参赛演示录屏、二维码/链接卡、PPT/PDF 中的标题和游戏截图、宣传封面及历史档案样图。`output` 下的旧图片、视频、材料包原件全部保留，不作为新品牌最终提交件。
