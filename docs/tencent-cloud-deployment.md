# 腾讯云部署与维护

2026-09-15 11:24（北京时间）已更新，应用版本 **4.61.10**，公开品牌为《下一季见：足球编年史》，两版继续开启 ICP 页脚。本次经作者授权直接发布本地未提交修改的可追溯快照，没有 Git commit/push。

| 用途 | 地址 | 服务器目录 | Nginx 配置 |
| --- | --- | --- | --- |
| 个人版 | https://football.dyp02.vip | `/www/wwwroot/apps/football-personal` | `/www/server/panel/vhost/nginx/football-personal.conf` |
| 参赛版 | https://cup.dyp02.vip | `/www/wwwroot/apps/football-contest` | `/www/server/panel/vhost/nginx/football-contest.conf` |
| 原博客，保留 | https://www.dyp02.vip | 未改博客目录或数据库 | `/www/server/panel/vhost/nginx/www.dyp02.vip.conf`，仅补 ACME 验证路由 |

两个游戏站均为本地构建的静态文件，由宿主机 Nginx 提供。共用 80/443，按域名区分；没有新 Node 进程、Docker 容器或内部端口。原有 3000、3001、8080、8443、8444 未复用。DNS 新增 football、cup 两条 A 记录，指向 82.156.137.232，TTL 600；原 www 记录未改。

## 目录怎么用

每个游戏目录的结构相同：

```text
football-personal/ 或 football-contest/
  current -> releases/当前版本     对外提供网页
  previous -> releases/上次版本    记录切换前的版本
  releases/                       每次发布新增目录，不覆盖旧包
  shared/assets/                  本版历次哈希资源，供旧页面和回滚使用
```

两版的 assets 不共用，不要把个人包混入参赛目录。不要直接编辑 current 内的文件，也不要清空 releases/shared。回滚演练留下的 `-recovery-check` 是同一产物的副本，不是另一套游戏代码。

- 运维脚本、README、上传包、源码补丁：`/www/server/football-deploy`，root 私有，网站不能访问。
- 配置备份和变更前资源记录：`/www/backups/football-deploy`。
- 访问/错误日志：`/www/wwwlogs/football-personal.*.log`、`football-contest.*.log`。
- 游戏 ACME 验证目录：`/www/wwwroot/apps/_acme/.well-known/acme-challenge`。
- 日志轮转：`/etc/logrotate.d/football-static`，每日轮转、保留 14 份，并设 20 MB 阈值。

## 当前发布来源（4.61.10）

- 仓库：`git@github.com:KurtDubain/football-universe.git`；分支 `main`；基线提交 `f0b2d63d8bb3b5d82a94d48d0a94b70af661475c` **加本地修改**。不是该提交的干净构建。修改清单包括 21 个已跟踪文件和 4 个未跟踪源码/测试脚本，均已保存补丁或文件副本；没有读取或打包凭据。
- 构建来源标识：`f0b2d63-local-80c7a776`；完整源码快照 SHA-256 为 `80c7a776bf255e7364e441c294cbb92be19f2f228b180acf4d792ca62d358f25`；tracked patch SHA 为 `35595bfc8f434a91b7b657aa9b6115fbcf2a2ef33bd4f3e1d425bf1912473ae1`。上传前和部署后均确认应用源码未变；本节等验收文档是在构建完成后补写，不属于已部署源码快照。
- 两版 `current`：`v4.61.10-f0b2d63-local-80c7a776-20260915`；`previous`：`v4.61.9-f0b2d63-20260914-brand`。个人版实际切换 11:23:58，参赛版 11:24:00。
- 本机 Node 22.22.2 / pnpm 10.34.5 串行构建；ICP 开启、audit 关闭，各自 HTTPS origin、edition/preset 正确。125 文件/包全部验哈希后原子切换，旧 release 和旧哈希资源保留。
- 发布前资源记录：`/www/backups/football-deploy/20260915-112358-757668-activate-personal`、`20260915-112400-515499-activate-contest`。
- 私有上传目录：`/www/server/football-deploy/incoming/v4.61.10-f0b2d63-local-80c7a776-20260915/`，包含两版产物、来源清单和 `source-snapshot.tar.gz`（源码补丁及未跟踪文件，不通过网站提供）。本地证据：`output/tencent-honors-release-20260915-v46110/`；浏览器证据：`output/playwright/tencent-honors-v46110/`。
- 没有修改应用代码、Nginx、DNS、证书、续签、博客、history-war 或 Vercel，没有新增容器/端口、重载/重启服务或重启整机。腾讯云保持手动更新；用户后续自行提交，Vercel 仍按其原有自动部署配置工作，本轮未另行验收 Vercel。

```text
personal.tar.gz       1a3525f5e08e0577bba3c0b91e4c424ae0b2eb05a69d4cb31e2df38f7a355868
contest.tar.gz        c20b974b20ffdaf6113efd952965efeba3d765df0a7bd0ad90090daa2a629a62
source-snapshot.tar.gz 5d0aa2f6233abae61189a541bc8f539ee719f4e93d510480456b5e473561005b
```

## 上次发布来源（4.61.9 归档）

- 仓库：`git@github.com:KurtDubain/football-universe.git`；分支 `main`；完整提交 `f0b2d63d8bb3b5d82a94d48d0a94b70af661475c`。从干净工作区构建，没有附加源码补丁；本次 review/deploy 没有执行 Git commit/push。
- 当次两版 release：`v4.61.9-f0b2d63-20260914-brand`；当时 `previous` 均为 `v4.61.8-7cd7109-20260914-icp`。编号中的 20260914 是准备日期，实际切换在次日 00:00:23。
- 本机 Node 22.22.2 / pnpm 10.34.5 串行构建，`ENABLE_ICP_FILING=true`、`VITE_ENABLE_AUDIT=false`，各版使用现有 football/cup HTTPS origin、edition、preset。包和每个文件均验证 SHA-256，原子切换 current；没有覆盖旧 release。
- 发布前资源记录：`/www/backups/football-deploy/20260915-000023-014322-activate-personal`、`20260915-000023-639592-activate-contest`。
- 上传目录：`/www/server/football-deploy/incoming/v4.61.9-f0b2d63-20260914-brand/`。本地构建/发布/HTTP/服务器前后记录：`output/tencent-brand-release-20260914-v4619/`；浏览器证据：`output/playwright/tencent-brand-v4619/`。
- 未改 Nginx 配置、DNS、证书、续签、博客、history-war 或 Vercel，没有重载或重启服务。腾讯云仍需手动更新，Vercel 保持原有自动部署配置；本轮未操作 Vercel，也未另行验收其最新状态。

```text
personal.tar.gz  7b4be81326f167ab798b1b95084e1969c45fe1dff850032c51ba59534e1d429a
contest.tar.gz   4d68b268b84c85293841b2d6fbec7cd2396abf4762d4dca831b470fd7fbd4113
```

## 上次发布来源（4.61.8 归档）

- 仓库：`git@github.com:KurtDubain/football-universe.git`；分支 `main`；完整提交 `7cd71097852dcdebaeedafce77cddf440b2b532c`。从干净工作区构建，原域名适配和 ICP 功能均已包含在提交内，没有附加源码补丁。
- 当次两版 release：`v4.61.8-7cd7109-20260914-icp`；当时的 `previous` 均指向下节归档的 4.61.7 原 release。
- 使用 Node 22.22.2、pnpm 10.34.5 在本机串行构建，`ENABLE_ICP_FILING=true`、`VITE_ENABLE_AUDIT=false`；两个站点各自的 origin、edition、preset 已核对。
- 上传后校验归档 SHA、版本及构建清单，再使用现有脚本原子切换。未改 Nginx、DNS、证书、续签任务、博客、history-war 或 Vercel；没有新增服务、监听端口或服务重启。
- 发布前资源记录：`/www/backups/football-deploy/20260914-221421-929942-activate-personal`、`20260914-221422-600936-activate-contest`。
- 本地产物、文件哈希和检查记录：`output/tencent-icp-release-20260914-v4618/`；服务器上传目录：`/www/server/football-deploy/incoming/20260914-v4618-icp/`。包与旧资源均保留。

```text
personal.tar.gz  c37678adf413ec009b512ab779ad1f74da508005753c7febc502332042122506
contest.tar.gz   e0904373e539c46b5c646ac0904a4dfc739f4f32b890c8aee315e88c988ce055
```

本次未修改应用代码，也没有 commit/push。腾讯云仍是**手动构建、校验、上传、切换**；两个 Vercel 项目保持已有的 main 自动部署，推送不会自动更新腾讯云。

## 首次发布来源（4.61.7 归档）

- 仓库：`git@github.com:KurtDubain/football-universe.git`；来源分支 `main`。
- 基线：`4271635371595294c2f32ed98c92213eef9e1f4d`，加当时尚未提交的构建域名补丁；**不是未经修改的 Git 提交构建**。该补丁后来已提交，不是当前版本的额外变更。
- 补丁只修改 `scripts/build-target.ts`、`scripts/edition-plugin.ts`、`src/edition/edition.test.ts`，支持个人站自定义 HTTPS origin，默认 Vercel 行为不变。未改游戏规则、数据、存档或素材。
- 补丁 SHA-256：`92e86c85a80bf3a492928dc53b39749a1e99ea24a53260dcf7e0add662adc4f4`。
- 两版首次 release（仍保留归档）：`v4.61.7-4271635-local-92e86c85-20260914`。
- buildId 分别以 `personal:personal-v1:personal:` / `contest:three-shores-v1:contest:` 开头，尾部为 `4271635371595294c2f32ed98c92213eef9e1f4d-local-92e86c85a80b`。

首次部署没有 commit/push，而是使用保留补丁的本地产物；不能将这条历史记录理解为当前源码仍未提交。

本地完整证据在 `output/tencent-deploy-2026-09-14/`。服务器上传包和补丁在 `/www/server/football-deploy/incoming/20260914/`。两包 SHA-256：

```text
personal.tar.gz  46d4b0eeefc16c84d4aaebcc39bafc617627a604dfdf9f4e8721e7542d08f145
contest.tar.gz   e1132b8bf0152fbd420ca550ad3298e2b826f80383e157a37fa5323046502dc2
```

## 以后怎么更新

### ICP 备案展示（4.61.8 已上线）

仅在腾讯云两版构建时增加 `ENABLE_ICP_FILING=true`。默认未设置或 `false` 不显示任何备案元素，Vercel 不需要新增变量。开启时校验版别对应的 HTTPS origin，个人必须为 `https://football.dyp02.vip`，参赛必须为 `https://cup.dyp02.vip`；其它地址报错，不能用此开关切换版别。

```sh
export PERSONAL_SITE_URL=https://football.dyp02.vip
export CONTEST_SITE_URL=https://cup.dyp02.vip
export ENABLE_ICP_FILING=true
export VITE_ENABLE_AUDIT=false
APP_EDITION=personal APP_PRESET_ID=personal-v1 pnpm build:personal
BUILD_TARGET=personal pnpm editions:check
BUILD_TARGET=personal pnpm budgets:check
APP_EDITION=contest APP_PRESET_ID=three-shores-v1 pnpm build:contest
BUILD_TARGET=contest pnpm editions:check
BUILD_TARGET=contest pnpm budgets:check
```

共用组件只显示 `冀ICP备2023028175号-1`，链接至 `https://beian.miit.gov.cn/`，位于欢迎页与存档首页的正常滚动内容底部。构建清单 `enableIcpFiling` 可核对是否开启。未改存档和模拟逻辑；备案状态由作者核实，不附加认证或合规承诺。

本地启动两版生产预览（4186/4185）后，运行 `pnpm exec tsx scripts/verify-icp-filing.ts`；默认关闭包用 `EXPECT_ICP=false pnpm exec tsx scripts/verify-icp-filing.ts`。检查两版三个视口的链接、样式、恢复存档、遮挡和横向溢出，并保存截图到 `output/playwright/icp-enabled` 或 `icp-disabled`。本次开启包已另外完成公网 HTTPS 的相同 12 状态检查，证据在 `output/playwright/tencent-icp-v4618/online/`。

下次更新应从已包含域名适配和 ICP 功能的确认提交构建；不要从旧 main 重建，也不要把脏工作区冒充某个提交。以下供下次更新使用，本次没有执行任何 Git 发布。

在本机项目目录，用 Node 22、pnpm 10，串行构建两版；失败就停止：

```sh
(
  set -eu
  if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    echo '请先检查并提交待发布源码，保留真实构建身份。'
    exit 1
  fi
  export PERSONAL_SITE_URL=https://football.dyp02.vip
  export CONTEST_SITE_URL=https://cup.dyp02.vip
  export ENABLE_ICP_FILING=true
  export VITE_ENABLE_AUDIT=false
  export VERCEL_GIT_COMMIT_SHA="$(git rev-parse HEAD)"
  pnpm install --frozen-lockfile
  pnpm typecheck
  pnpm lint
  pnpm test
  APP_EDITION=personal APP_PRESET_ID=personal-v1 pnpm build:personal
  BUILD_TARGET=personal pnpm editions:check
  BUILD_TARGET=personal pnpm budgets:check
  APP_EDITION=contest APP_PRESET_ID=three-shores-v1 pnpm build:contest
  BUILD_TARGET=contest pnpm editions:check
  BUILD_TARGET=contest pnpm budgets:check
  football_out="$(mktemp -d /tmp/football-release.XXXXXX)"
  COPYFILE_DISABLE=1 tar -czf "$football_out/personal.tar.gz" -C dist/personal .
  COPYFILE_DISABLE=1 tar -czf "$football_out/contest.tar.gz" -C dist/contest .
  shasum -a 256 "$football_out/personal.tar.gz" "$football_out/contest.tar.gz"
  echo "$football_out"
)
```

还需用两版生产包做浏览器试玩后再上传。选择一个从未用过的发布编号，例如 `v版本-提交短号-日期时间`；以下大写占位符须替换，不能原样执行：

```sh
ssh -i /Users/mutu/.ssh/personal_space_deploy_ed25519 root@82.156.137.232 'mkdir -m 700 /www/server/football-deploy/incoming/RELEASE_ID'
scp -i /Users/mutu/.ssh/personal_space_deploy_ed25519 LOCAL_PACKAGE_DIR/personal.tar.gz LOCAL_PACKAGE_DIR/contest.tar.gz root@82.156.137.232:/www/server/football-deploy/incoming/RELEASE_ID/
```

在服务器上逐版发布，每版后检查网页、版别和资源：

```sh
python3 /www/server/football-deploy/bin/manage-static.py publish personal RELEASE_ID /www/server/football-deploy/incoming/RELEASE_ID/personal.tar.gz PERSONAL_SHA256
curl --fail https://football.dyp02.vip/healthz
curl --fail https://football.dyp02.vip/version.json
python3 /www/server/football-deploy/bin/manage-static.py publish contest RELEASE_ID /www/server/football-deploy/incoming/RELEASE_ID/contest.tar.gz CONTEST_SHA256
curl --fail https://cup.dyp02.vip/healthz
curl --fail https://cup.dyp02.vip/version.json
```

脚本检查归档 SHA、解压路径、版别、preset、域名、正式包无审计入口和哈希资源冲突，记录资源状态后原子切换 current。普通更新不改 Nginx 配置，不需要重启服务。发布后检查失败时，执行下节回滚；脚本不会凭 HTTP 健康结果自动回滚。

## 怎么回滚

以下是将当前 4.61.10 回滚到上一版 4.61.9 的实际命令，在服务器执行。上一版保留 ICP 页脚和新游戏名，但没有本轮冠军归档修复；恢复当前版本可将版本名换为 `v4.61.10-f0b2d63-local-80c7a776-20260915`。

```sh
python3 /www/server/football-deploy/bin/manage-static.py rollback personal v4.61.9-f0b2d63-20260914-brand
python3 /www/server/football-deploy/bin/manage-static.py rollback contest v4.61.9-f0b2d63-20260914-brand
curl --fail https://football.dyp02.vip/version.json
curl --fail https://cup.dyp02.vip/version.json
```

首次 4.61.7 部署时已分别发布同产物演练副本，再回滚原 release，检查前后健康和版别均通过；本次没有为演练将线上 4.61.10 降回旧版。这验证了服务端发布/回滚机制，不是跨游戏版本存档降级测试。已打开的 PWA 可能仍持有旧页面，需在游戏内检查更新；回滚操作本身不会删除玩家浏览器存档。

## HTTPS 与自动续签

以下是实际线上证书的到期时间，均为北京时间：

| 域名 | 到期时间 | 续签任务 |
| --- | --- | --- |
| www.dyp02.vip | 2026-12-13 19:00:55 | 保留原宝塔每日 03:49 任务 |
| football.dyp02.vip | 2026-12-13 19:06:48 | 新增每日 04:17 检查 |
| cup.dyp02.vip | 2026-12-13 19:07:12 | 同上 |

博客原自动续签确实存在，但验证文件写入目录与代理路由不一致，先前已失败两次。首次部署时先备份并通过 nginx -t，再加专用 HTTP 验证 location，指向原 `/www/wwwroot/html/dist`；没有改博客代理或内容。随后用宝塔现有 ACME 客户端完成续签并验证线上证书。4.61.8 部署只复核公开证书到期时间，未重新签发或修改配置。

两个游戏站各自签发证书，保存于 `/www/server/panel/vhost/cert/对应域名/`。不依赖它们是否出现在宝塔“网站”列表中：`/etc/cron.d/football-cert-renew` 每日运行独立脚本，30 天内尝试续签，只处理两个游戏域名；仍复用已安装的宝塔 ACME 客户端。任务使用 flock 防重入，日志为 `/www/server/football-deploy/logs/cert-renew.log`。自动续签不是永不失败的保证；更换 DNS、验证路由或升级宝塔后需复验。

每轮任务会比较磁盘公开证书与本机 443 对应 SNI 实际加载的证书，发现不一致才通过 nginx -t 后 reload，并检查是否真正生效。这样上次重载失败或宝塔其他任务更新证书后，下次仍会重试加载，不会仅因“这次没有新签发”而跳过。7 项本地 mock 测试覆盖配置检查失败、重载失败、外部续签、假成功和下轮恢复；服务器已运行到期检查及实际指纹一致性检查。尚未人为损坏生产证书或等待未来真实续期。

手动检查续签（未到期时跳过签发），以及查看公开证书信息：

```sh
/usr/bin/flock -n /www/server/football-deploy/renew.lock /www/server/football-deploy/bin/renew-game-certs.sh
openssl s_client -connect football.dyp02.vip:443 -servername football.dyp02.vip < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
openssl s_client -connect cup.dyp02.vip:443 -servername cup.dyp02.vip < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

如需修改 Nginx，先另存配置备份、记录 docker ps / ss -lntp / df -h / free -h，并执行 `/www/server/nginx/sbin/nginx -t`；修改后再次测试通过才允许 `nginx -s reload`。不要重启整机，不要直接覆盖博客配置，也不要打印或复制私钥、Token、数据库密码或 .env。

## 当前版本验收（4.61.10）

- 两路只读 review 未发现阻断问题。低级别联赛冠军升班后的球队奖杯、教练奖杯和退休归档已修复；旧档依据保留记录幂等补齐，历史教练证据不足或冲突时不猜测归属。分享图旧网址和“待审阅”已移除；内部人工内容审阅仍待作者确认，不宣称获得授权。
- 首轮全量 157 文件 / 1,084 测试及 typecheck/lint/docs/scripts/changelog 通过。独立基线 `f0b2d63` 与当前源码以种子 20260709 运行五季：20 个模拟/状态字段、100 项逐季比较全部相同，包含 RNG；未修改阈值或模拟代码。
- 两版正式构建、版别扫描、冻结预算通过。initial JS gzip 个人 159,994 B / 160,000 B，参赛 159,557 B；个人仅余 6 B，后续不同提交身份重新构建必须重新检查，不得放宽预算。PWA 预缓存 86 / 84 项。
- 本地和公网各完成两版 × 1280/390/320 的六组正常 UI 流程至 S2，覆盖判断、直播、战报、档案图片、转会、深链、刷新、离线和参赛隔离；应用错误/警告及横向溢出均为 0。备案另做本地 12 状态检查通过。标准 Web Game 客户端首次欢迎按钮等待稳定超时，原样重跑成功并检查了打开后的截图。
- 本地及真实参赛 HTTPS 专项验证新档晨光 S1 乙冠升班、教练履历，以及 S5 旧档晨光 S1/S3 两冠；旧档共有 8 个缺失球队奖杯补回，不更改比赛/经营/随机状态，重复加载不重复计数。已目视复核公网奖杯柜、历史记录和教练履历截图。
- 真实 HTTPS 两版另用自己的旧 QA 档验证：页面与导出均为修复后的数据，离线刷新可正常查看；正常推进一个窗口后，直接读取浏览器存储确认球队/教练奖杯已写回，刷新及再次导出完全一致。错误/警告为 0，证据在 `persistence-online-verified/`。读取时修复先用于内存，下一次正常保存才写回，是既有存储时序，不需要清除玩家存档。
- 原跨发布 PWA 探针在两版旧页面/SW 已激活后保留到实际部署，个人新页面已到 4.61.10，但错误地要求“加载即写回 raw localStorage”导致断言失败；后续断言未执行，不记为完整跨版通过。若干探针设置失败（SW 激活等待、浏览器回调序列化/调用、补验脚本误解码明文 JSON）均保留记录；只修测试调用，没有改应用、手动补写荣誉或回滚生产来制造通过。上述公网正常操作持久化是独立补验，不冒称原探针重新成功。
- HTTP→HTTPS、严格 TLS、每版 124 个公开文件逐一 SHA-256、SPA 刷新、缓存/MIME、缺失/私有资源 404 和参赛个人编辑器资源阻断通过；博客及 history-war 两站 HTTPS 200。`.vite/manifest.json` 按配置不公开。
- Nginx/vhost 配置、运维脚本、Nginx 进程、监听端口、博客容器和 history-war release 指向前后一致；公开证书的域名、可信状态及到期时间一致，未做证书文件字节比较。Nginx/crond active 且开机启用，发布后磁盘可用约 21 GB、可用内存约 1.1 GB。没有中断现有服务。
- Web Game / Playwright 技能用于隔离浏览器测试与截图复核，没有访问真实用户存档或开放正式包审计入口。未做实体手机/全国网络测试、整机重启恢复、跨版本存档降级、完整性能 smoke 或材料重新制作。提交前建议手机流量冷启动参赛链接；旧页面使用设置内检查更新，不要清除站点数据。

## 上次版本验收（4.61.9 归档）

- 两路独立只读 review 未发现本次更名引入的阻断问题；存档键、schema、edition/preset、PWA id/缓存身份和模拟逻辑未改。156 个测试文件 / 1,069 项测试、typecheck/lint/docs/scripts/changelog、两版正式构建/产物扫描/冻结预算均通过，预缓存仍为 86 / 84 项。
- 本地和公网分别完成两版 × 1280/390/320 三视口的 6 组正常 UI 流程：开局、判断、直播、战报、S1 档案/图片下载、转会、S2、深链接、设置、版别隔离、刷新和离线；应用错误/警告及横向溢出均为 0。新截图、图标及档案导出已目视复核。备案另做本地 12 状态检查通过。
- 公网 HTTP→HTTPS、严格证书校验、每版 124 个公开文件 SHA-256、SPA 刷新、缓存/MIME、缺失与隐藏资源 404、参赛个人编辑器资源阻断、博客及 history-war 两站 HTTP 200：通过。归档各含 125 文件，额外一份 `.vite/manifest.json` 不公开提供。
- 实际发布期间保留的个人版 4.61.8 页面正常更新到 4.61.9，前后及离线存档 SHA 完全相同。参赛页面已更新到 4.61.9/f0b2d63、无错误/请求失败，但原脚本用全页面出现远端版本号作为切版信号，第二次点击遇到刷新，等待“已是最新版”超时。失败记录保留；该轮参赛哈希/离线断言未执行，不能算作完整通过。
- 补验没有改应用、放宽断言或回滚生产：用两版实际新旧发布包在隔离本地 HTTP 环境重放，等待新文档标题和本地构建再检查，两版升级前后/离线存档 SHA 均一致。另在真实 HTTPS 两站加载自己的 v4.61.7 QA 旧档，检查最新版、刷新/离线原样保留，并离线推进 S2 窗口 0→1。报告分别在 `replay-upgrade/`、`online-old-saves/`；不把本地重放冒称真实公网重新切版。
- 主 Nginx 和所有 vhost 配置 SHA、Nginx PID/启动时间、博客容器状态、history-war release 指向和公开证书均与发布前一致；Nginx/crond active 且开机启用。没有服务重启、整机重启、生产回滚演练或完整性能 smoke。
- 本轮只更新发布记录，没有修改应用源码、旧素材或用户存档。首次本地参赛 preview 因调用时漏传 CONTEST_SITE_URL 未启动，标准客户端随即连接失败；补上启动参数后原样重跑通过。这是验收环境调用错误，不是构建/游戏故障。
- 仍保留的既有问题：个人分享图旧网址、参赛分享图“待审阅”；之前已确认的低级别冠军升班后奖杯归档问题也不在本次更名修复范围。参赛材料需另行使用新名称导出。本轮不是实体手机或全国网络测试，提交前建议手机流量冷启动；看到旧名称时用设置内检查更新，不要清除站点数据。

## 上次版本验收（4.61.8 归档）

- 本地 3 个测试文件 / 11 项测试、typecheck、lint、docs、scripts，以及两版构建、产物扫描和冻结预算通过。两版按正常 UI 开局并结算 16 场结果，刷新后保留第 2 轮；参赛导入和编辑器仍隔离。
- 公网 HTTP 跳转 HTTPS、每版 124 个公开文件逐一 SHA-256、SPA 深链接刷新、静态文件 MIME/缓存、丢失资源与隐藏文件 404、参赛站个人编辑器资源 404：通过。完整结果见 `output/tencent-icp-release-20260914-v4618/http-online-report.json`。
- 首次 HTTP 批量检查在个人站 `/settings` 的 HTTP 请求上超时；失败报告另存为 `http-online-first-attempt.json`。随后同路径直连 curl 返回 301，HTTPS 返回 200；未改代码、超时阈值或断言的整轮重跑通过。此单次超时原因未确定，不应据此保证所有网络均稳定。
- 两版 320×568 / 390×844 / 1280×720 的欢迎页与刷新存档首页共 12 状态通过，全部页脚截图已目视复核：备案号完整、12px 常规字重、普通滚动排布，无新增横向溢出或操作遮挡。分别实点备案链接，新开工信部页面，原游戏页保留。
- 发布前保留的真实 4.61.7 页面和已激活 Service Worker，发布后通过应用正常更新路径进入 4.61.8。两版升级前后及离线刷新后的整段存档 SHA-256 完全相同；未清缓存、注销 SW 或修改存档。应用控制台错误/警告及浏览器请求失败均为 0。浏览器报告、截图见 `output/playwright/tencent-icp-v4618/online/`。
- 主 Nginx、博客和两个足球 vhost 的配置 SHA 与发布前完全一致，`nginx -t` 通过；没有重载或重启服务。原博客三个容器仍健康且持续运行 2 个月；history-war 两个 current 指向保持不变，其两站及博客均返回 HTTPS 200。Nginx/crond 仍 active、开机启用；磁盘剩余约 22 GB，可用内存约 1.1 GB。
- Web Game 和 Playwright 技能用于独立浏览器操作、真实更新流程及截图复核，没有修改正式包以开放审计入口。这是桌面 Chromium 的视口模拟，不是实体手机或全国运营商测试；建议提交前再用手机流量打开参赛链接。
- 本轮没有重跑完整长赛季/性能 smoke、跨版本存档降级或整机重启测试，也没有改参赛素材。已打开旧页面可在设置中检查更新，**不要为了显示备案号清除浏览器站点数据**。

## 首次部署验收与持续边界（4.61.7 归档）

- HTTP 转 HTTPS、严格 HTTPS、各版 124 个公开静态文件逐个 SHA-256、资源 MIME/缓存、SPA片段刷新、丢失资源 404、隐藏文件阻断、参赛站个人编辑器资源 404：通过。
- 两版各 1280×720 / 390×844，真实 HTTPS 玩到 S2，覆盖判断、直播、战报、档案、转会、导出、刷新、深链、离线、更新、参赛隔离；应用 error/warning 与横向溢出均为 0。另验证参赛移动视口断网后实际推进一轮生成战报。Playwright/web-game 技能用于实际操作与截图复核，没有打开正式包审计后门。
- 同产物发布/回滚、Nginx 平滑重载后健康检查：通过；Nginx/crond 已启用开机启动。**未停止 Nginx 或重启服务器做断电恢复测试**，以免中断博客。
- 博客仍返回 HTTPS 200，原三个容器持续健康、未重启。没有修改数据库或 `/www/wwwroot/personal-space`。最终磁盘剩余约 22 GB、可用内存约 1.1 GB。
- 首轮出现过市场页按钮、参赛首页各一次 30 秒超时，另一次 HTTP 批量探测超时；失败记录保留，未改游戏或放宽断言的后续检查通过，原因尚未确定。不是全国运营商测试，也不是实体手机或独立确认关闭 VPN 的网络认证；提交前仍建议手机流量冷启动试玩。
- 新域名不会自动取得旧 Vercel 存档；个人版可手动导出/导入，参赛版仍按现有规则关闭手动导入。没有清除旧站存档。
- 个人分享图片内仍有旧网址，参赛分享图“待审阅”和稳定旧 ID 的既有内容审阅边界未在此轮更改。部署成功不等于素材/内容审阅已完成；本次也没有重新制作参赛材料或改其中的旧链接。
- 本轮针对性测试/类型/代码规范/构建扫描/预算通过；未重跑整套性能 smoke，既有性能待办仍保留。[CentOS 7 已结束维护](https://www.centos.org/centos-linux/)，系统迁移应单独安排，不在参赛上线时顺手升级服务器。
