# 腾讯云部署与维护

2026-09-14 已上线，应用版本 4.61.7。

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

## 本次发布来源

- 仓库：`git@github.com:KurtDubain/football-universe.git`；来源分支 `main`。
- 基线：`4271635371595294c2f32ed98c92213eef9e1f4d`，加本次尚未提交的构建域名补丁；**不是未经修改的 Git 提交构建**。
- 补丁只修改 `scripts/build-target.ts`、`scripts/edition-plugin.ts`、`src/edition/edition.test.ts`，支持个人站自定义 HTTPS origin，默认 Vercel 行为不变。未改游戏规则、数据、存档或素材。
- 补丁 SHA-256：`92e86c85a80bf3a492928dc53b39749a1e99ea24a53260dcf7e0add662adc4f4`。
- 两版当前 release：`v4.61.7-4271635-local-92e86c85-20260914`。
- buildId 分别以 `personal:personal-v1:personal:` / `contest:three-shores-v1:contest:` 开头，尾部为 `4271635371595294c2f32ed98c92213eef9e1f4d-local-92e86c85a80b`。

本次没有 commit/push。腾讯云目前是**手动构建、校验、上传、切换**，尚未配置 Git 自动部署。已有两个 Vercel 项目继续同 main 自动部署，设置未改；推送不会自动更新腾讯云。

本地完整证据在 `output/tencent-deploy-2026-09-14/`。服务器上传包和补丁在 `/www/server/football-deploy/incoming/20260914/`。两包 SHA-256：

```text
personal.tar.gz  46d4b0eeefc16c84d4aaebcc39bafc617627a604dfdf9f4e8721e7542d08f145
contest.tar.gz   e1132b8bf0152fbd420ca550ad3298e2b826f80383e157a37fa5323046502dc2
```

## 以后怎么更新

### ICP 备案展示（本地实现，待部署确认）

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

本地启动两版生产预览（4186/4185）后，运行 `pnpm exec tsx scripts/verify-icp-filing.ts`；默认关闭包用 `EXPECT_ICP=false pnpm exec tsx scripts/verify-icp-filing.ts`。检查两版三个视口的链接、样式、恢复存档、遮挡和横向溢出，并保存截图到 `output/playwright/icp-enabled` 或 `icp-disabled`。此项仅完成本地实现不代表线上已展示，重建上传需另行确认。

先由作者确认并提交本次域名补丁；不要直接从未包含补丁的旧 main 重建，也不要把脏工作区冒充某个提交。以下供下次更新使用，本次没有执行任何 Git 发布。

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

以下是回到本次验收版本的实际命令，在服务器执行。以后也可换成 releases 下经过确认的其他版本名：

```sh
python3 /www/server/football-deploy/bin/manage-static.py rollback personal v4.61.7-4271635-local-92e86c85-20260914
python3 /www/server/football-deploy/bin/manage-static.py rollback contest v4.61.7-4271635-local-92e86c85-20260914
curl --fail https://football.dyp02.vip/version.json
curl --fail https://cup.dyp02.vip/version.json
```

本次已分别发布同产物演练副本，再回滚原 release，检查前后健康和版别均通过。这验证了服务端发布/回滚机制，不是跨游戏版本存档降级测试。已打开的 PWA 可能仍持有旧页面，需在游戏内检查更新；回滚不会删除玩家浏览器存档。

## HTTPS 与自动续签

以下是实际线上证书的到期时间，均为北京时间：

| 域名 | 到期时间 | 续签任务 |
| --- | --- | --- |
| www.dyp02.vip | 2026-12-13 19:00:55 | 保留原宝塔每日 03:49 任务 |
| football.dyp02.vip | 2026-12-13 19:06:48 | 新增每日 04:17 检查 |
| cup.dyp02.vip | 2026-12-13 19:07:12 | 同上 |

博客原自动续签确实存在，但验证文件写入目录与代理路由不一致，先前已失败两次。本次先备份并通过 nginx -t，再加专用 HTTP 验证 location，指向原 `/www/wwwroot/html/dist`；没有改博客代理或内容。随后用宝塔现有 ACME 客户端完成续签并验证线上证书。

两个游戏站各自签发证书，保存于 `/www/server/panel/vhost/cert/对应域名/`。不依赖它们是否出现在宝塔“网站”列表中：`/etc/cron.d/football-cert-renew` 每日运行独立脚本，30 天内尝试续签，只处理两个游戏域名；仍复用已安装的宝塔 ACME 客户端。任务使用 flock 防重入，日志为 `/www/server/football-deploy/logs/cert-renew.log`。自动续签不是永不失败的保证；更换 DNS、验证路由或升级宝塔后需复验。

每轮任务会比较磁盘公开证书与本机 443 对应 SNI 实际加载的证书，发现不一致才通过 nginx -t 后 reload，并检查是否真正生效。这样上次重载失败或宝塔其他任务更新证书后，下次仍会重试加载，不会仅因“这次没有新签发”而跳过。7 项本地 mock 测试覆盖配置检查失败、重载失败、外部续签、假成功和下轮恢复；服务器已运行到期检查及实际指纹一致性检查。尚未人为损坏生产证书或等待未来真实续期。

手动检查续签（未到期时跳过签发），以及查看公开证书信息：

```sh
/usr/bin/flock -n /www/server/football-deploy/renew.lock /www/server/football-deploy/bin/renew-game-certs.sh
openssl s_client -connect football.dyp02.vip:443 -servername football.dyp02.vip < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
openssl s_client -connect cup.dyp02.vip:443 -servername cup.dyp02.vip < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

如需修改 Nginx，先另存配置备份、记录 docker ps / ss -lntp / df -h / free -h，并执行 `/www/server/nginx/sbin/nginx -t`；修改后再次测试通过才允许 `nginx -s reload`。不要重启整机，不要直接覆盖博客配置，也不要打印或复制私钥、Token、数据库密码或 .env。

## 验收与剩余边界

- HTTP 转 HTTPS、严格 HTTPS、各版 124 个公开静态文件逐个 SHA-256、资源 MIME/缓存、SPA片段刷新、丢失资源 404、隐藏文件阻断、参赛站个人编辑器资源 404：通过。
- 两版各 1280×720 / 390×844，真实 HTTPS 玩到 S2，覆盖判断、直播、战报、档案、转会、导出、刷新、深链、离线、更新、参赛隔离；应用 error/warning 与横向溢出均为 0。另验证参赛移动视口断网后实际推进一轮生成战报。Playwright/web-game 技能用于实际操作与截图复核，没有打开正式包审计后门。
- 同产物发布/回滚、Nginx 平滑重载后健康检查：通过；Nginx/crond 已启用开机启动。**未停止 Nginx 或重启服务器做断电恢复测试**，以免中断博客。
- 博客仍返回 HTTPS 200，原三个容器持续健康、未重启。没有修改数据库或 `/www/wwwroot/personal-space`。最终磁盘剩余约 22 GB、可用内存约 1.1 GB。
- 首轮出现过市场页按钮、参赛首页各一次 30 秒超时，另一次 HTTP 批量探测超时；失败记录保留，未改游戏或放宽断言的后续检查通过，原因尚未确定。不是全国运营商测试，也不是实体手机或独立确认关闭 VPN 的网络认证；提交前仍建议手机流量冷启动试玩。
- 新域名不会自动取得旧 Vercel 存档；个人版可手动导出/导入，参赛版仍按现有规则关闭手动导入。没有清除旧站存档。
- 个人分享图片内仍有旧网址，参赛分享图“待审阅”和稳定旧 ID 的既有内容审阅边界未在此轮更改。部署成功不等于素材/内容审阅已完成；本次也没有重新制作参赛材料或改其中的旧链接。
- 本轮针对性测试/类型/代码规范/构建扫描/预算通过；未重跑整套性能 smoke，既有性能待办仍保留。[CentOS 7 已结束维护](https://www.centos.org/centos-linux/)，系统迁移应单独安排，不在参赛上线时顺手升级服务器。
