# site-shot · Puppeteer + node-schedule + Nodemailer

> 定时给网站截图（PC + 移动端），自动整理成报告并发到邮箱。
> Schedule **Puppeteer** screenshots of your websites (desktop & mobile), build a report and **email** it automatically with **Nodemailer**.
>
> 典型用途：网站改版留档、运营/广告素材留痕、竞品首页监控、每日站点可用性巡检。
> Use cases: website redesign archive, ad/operation screenshots, competitor homepage monitoring, daily visual uptime check.

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green?logo=node.js)](https://nodejs.org/)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-24.x-40B5A4?logo=puppeteer)](https://pptr.dev/)
[![Nodemailer](https://img.shields.io/badge/Nodemailer-10.x-30B980?logo=minutemailer)](https://nodemailer.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**关键词 / Keywords**：`puppeteer screenshot` · `node cron job` · `scheduled screenshot email` · `website screenshot automation` · `nodemailer smtp` · `headless chrome` · `express dashboard` · `smtp troubleshoot` · `网站定时截图` · `自动截图发邮件` · `网站监控` · `Node 定时任务` · `可视化配置` · `SMTP 自检`

---

## 目录 / Table of Contents

- [功能特性 / Features](#功能特性--features)
- [项目结构 / Project structure](#项目结构--project-structure)
- [快速开始 / Quick start](#快速开始--quick-start)
- [Web 控制台 / Web dashboard](#web-控制台--web-dashboard)
- [配置说明 / Configuration](#配置说明--configuration)
- [自定义站点 / Customize targets](#自定义站点--customize-targets)
- [命令行 / CLI](#命令行--cli)
- [可靠性设计：超时 / 失败 / 打不开怎么办](#可靠性设计超时--失败--打不开怎么办)
- [部署方式 / Deployment](#部署方式--deployment)
- [常见问题 / FAQ & Troubleshooting](#常见问题--faq--troubleshooting)
- [从 v1（pup.js）迁移 / Migrating from v1](#从-v1pupjs-迁移--migrating-from-v1)
- [更新日志 / Changelog](#更新日志--changelog)
- [赞助支持 / Sponsor](#赞助支持--sponsor)
- [License](#license)

---

## 功能特性 / Features

| # | 能力 | 说明 |
|---|------|------|
| 1 | 定时执行 / Scheduling | `node-schedule` 常驻进程按 cron 触发，或交给系统 `crontab` 用 `--once` 跑 |
| 2 | 多站点多视口 / Multi-viewport | 每个站点可单独配置 PC / 移动端视口与 UA，一次跑完 |
| 3 | 整页截图 / Full page | 自动滚动触发懒加载，减少“截出来是空白”的情况 |
| 4 | 超时控制 / Timeouts | 浏览器启动、页面导航、SMTP 连接全部有硬超时，绝不会卡死 |
| 5 | 失败重试 / Retry | 导航失败按指数退避重试，站点偶发抖动可自愈 |
| 6 | 自动降级 / Graceful degradation | 整页过大或截图失败时自动降级为首屏；附件过大时只发文字报告 |
| 7 | 失败也不丢数据 / Never lose data | 发信失败时截图仍保存在磁盘；截图失败仍会发出“失败清单”邮件 |
| 8 | 并发控制 / Concurrency | 可配置并发数，默认 2；上一轮没跑完时自动跳过，避免任务叠加 |
| 9 | 资源释放 / No leaks | 页面用完必关，浏览器退出时兜底杀进程，不会留下僵尸 Chromium |
| 10 | 历史留档 + 自动清理 | 截图按 `screenshots/日期_时间/` 归档，超过 `RETENTION_DAYS` 自动清理 |
| 11 | 邮件内嵌报告 / Inline report | 邮件正文直接展示截图 + 状态表格（站点、耗时、失败原因） |
| 12 | 零配置也能跑 / Works without SMTP | 未配置邮箱时只截图保存本地，不报错退出 |
| 13 | Web 控制台 / Web dashboard | 浏览器里配置邮箱、站点与尺寸、cron、截图参数；支持立即执行、历史回看、日志查看、SMTP 自检 |
| 14 | 字段级校验 / Field validation | 前后端共用同一套规则（`public/validate.js`），邮箱类字段强制邮箱格式，出错处标红并滚动定位 |
| 15 | SMTP 自检 / Mail doctor | `npm run doctor:mail` 或界面「诊断 SMTP 连接」：DNS → 端口 → SMTP 握手 → 登录，逐层定位发信故障 |

---

## 项目结构 / Project structure

```
.
├── src/
│   ├── index.js      # CLI 入口：参数、配置校验、定时任务、优雅退出
│   ├── server.js     # Web 控制台服务：REST API + 静态页面
│   ├── scheduler.js  # 调度器：cron 注册、去重、热重载
│   ├── store.js      # 界面配置的读取/校验/持久化（data/config.json）
│   ├── history.js    # 运行历史读取
│   ├── task.js       # 单次任务编排：截图 → 报告 → 发信 → 清理
│   ├── capture.js    # 单站点截图：超时/重试/空白检测/降级
│   ├── browser.js    # 浏览器会话：懒启动、断线重连、必关闭
│   ├── mailer.js     # Nodemailer：SMTP 校验、重试、附件处理
│   ├── diagnose.js   # SMTP 自检（npm run doctor:mail）：DNS/端口/握手/登录
│   ├── logger.js     # 分级日志（控制台 + 可选落盘）
│   └── utils.js      # 通用工具：重试、超时、并发、清理、邮箱/URL/时区校验
├── config/
│   ├── index.js      # 统一配置（全部支持环境变量覆盖）+ 启动校验
│   ├── sites.js      # 默认截图站点清单
│   └── sites.local.js（可选，已被 git 忽略，用于本地覆盖站点）
├── public/           # Web 控制台前端（原生 HTML/CSS/JS，无需打包）
│   ├── index.html    # 页面结构（概览/定时/站点/截图/邮件/历史/日志）
│   ├── style.css     # 样式（含字段校验标红样式）
│   ├── app.js        # 交互逻辑：加载配置、即时校验、执行、历史、日志
│   └── validate.js   # 表单校验规则（前后端共用）
├── data/config.json  # 界面保存的配置（自动生成，已 git 忽略）
├── .env.example      # 所有可配置项及说明
└── screenshots/      # 运行产物（已 git 忽略）
```

---

## 快速开始 / Quick start

**中文**

```bash
# 1. 安装依赖（Node >= 20）
npm install

# 2. 复制并编辑配置
cp .env.example .env      # Windows: copy .env.example .env

# 3. 校验配置（只检查不发信）
npm run check

# 4. 先演练一次：只截图不邮件，确认图片没问题
npm run dry-run

# 5. 常驻启动（按 SCHEDULE_CRON 定时执行）
npm start

# 6. 想可视化配置？启动 Web 控制台，浏览器打开 http://127.0.0.1:3000
npm run web

# 7. 邮件发不出去？跑 SMTP 自检，会告诉你具体哪一层的锅
npm run doctor:mail
```

**English**

```bash
npm install                 # Node >= 20 required
cp .env.example .env        # then edit it
npm run check               # validate config only
npm run dry-run             # capture once, no email
npm start                   # run as a scheduled daemon
npm run web                 # web dashboard at http://127.0.0.1:3000
npm run doctor:mail         # SMTP self-check (why email fails)
```

> 首次安装若 Chromium 下载失败，见 [常见问题](#常见问题--faq--troubleshooting)。
> If the bundled Chromium download fails, see [FAQ](#常见问题--faq--troubleshooting).

---

## 配置说明 / Configuration

所有配置都通过 `.env`（环境变量）完成，完整清单见 [`.env.example`](./.env.example)。常用项：

All settings live in `.env`; full list in [`.env.example`](./.env.example).

| 变量 / Env | 默认值 / Default | 说明 / Description |
|---|---|---|
| `SCHEDULE_CRON` | `30 9 * * *` | 5 段 cron（分 时 日 月 周）/ 5-field cron |
| `SCHEDULE_TIMEZONE` | `Asia/Shanghai` | 时区 / timezone |
| `RUN_ON_START` | `false` | 启动进程时是否立即先跑一次 / run once on boot |
| `CHROME_PATH` | 空 | 指定系统 Chrome/Edge 路径，留空用自带 Chromium / custom browser path |
| `HEADLESS` | `true` | 无头模式 / headless mode |
| `MAX_CONCURRENCY` | `2` | 并发截图数 / concurrent pages |
| `NAVIGATION_TIMEOUT` | `30000` | 单页导航超时(ms) / navigation timeout |
| `WAIT_UNTIL` | `networkidle2` | `networkidle2` / `load` / `domcontentloaded` |
| `EXTRA_WAIT` | `1500` | 截图前额外等待(ms) / extra wait before shot |
| `FULL_PAGE` | `true` | 是否整页截图 / full page screenshot |
| `CAPTURE_RETRIES` | `2` | 失败重试次数 / retries per site |
| `MAX_IMAGE_MB` | `10` | 单图超过该值自动降级为首屏 / degrade to viewport if larger |
| `SCREENSHOT_DIR` | `screenshots` | 输出目录 / output dir |
| `RETENTION_DAYS` | `7` | 历史保留天数，0 = 不清理 / retention days |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | - / `465` / 自动 | SMTP 服务器 / SMTP server |
| `SMTP_USER` / `SMTP_PASS` | - | 账号与**授权码**（不是登录密码）/ user & app password |
| `MAIL_TO` / `MAIL_CC` | - | 收件人，多个用逗号分隔 / recipients, comma separated |
| `MAIL_FROM` | `SMTP_USER` | 发件人显示名 / sender |
| `MAIL_SUBJECT_PREFIX` | `网站截图日报` | 邮件标题前缀 / subject prefix |
| `MAX_ATTACHMENT_MB` | `15` | 附件总上限，超出只发文字报告 / max attachment size |
| `MAIL_RETRIES` / `SMTP_TIMEOUT` | `3` / `20000` | 发信重试次数与 SMTP 超时(ms) / mail retries & SMTP timeout |
| `MIN_CONTENT_LENGTH` | `50` | 页面文本少于该字符数判定为“疑似空白” / blank page threshold |
| `AUTO_SCROLL` | `true` | 截图前滚动页面触发懒加载 / scroll before shooting |
| `WEB_PORT` / `WEB_HOST` | `3000` / `127.0.0.1` | 控制台端口与监听地址 / dashboard port & bind host |
| `WEB_USER` / `WEB_PASS` | 空 | 设置 `WEB_USER` 后开启 Basic 认证 / enable HTTP basic auth |
| `LOG_LEVEL` / `LOG_FILE` | `info` / `logs/run.log` | 日志级别与落盘路径 / logging |

> 邮箱未配置完整时程序**不会报错退出**，只截图存本地，方便先跑通再配邮件。
> Without full SMTP config the tool still saves screenshots locally instead of failing.

cron 示例 / cron examples：

```bash
30 9 * * *     # 每天 09:30 / every day at 09:30
0 9 * * 1-5    # 工作日 09:00 / weekdays at 09:00
0 */6 * * *    # 每 6 小时 / every 6 hours
*/10 * * * *   # 每 10 分钟 / every 10 minutes
```

---

## 自定义站点 / Customize targets

编辑 `config/sites.js`；或复制成 `config/sites.local.js`（已 git 忽略）后再改，避免和上游冲突。

Edit `config/sites.js`, or copy it to `config/sites.local.js` (git-ignored) to avoid conflicts.

```js
module.exports = [
  {
    key: 'home-pc',                 // 唯一标识，决定文件名 / unique id
    name: '官网首页 PC',             // 报告展示名 / display name
    url: 'https://example.com',
    viewport: { width: 1600, height: 900 },
    // userAgent: '...',            // 可选：模拟移动端 UA / optional UA
    // fullPage: false,             // 可选：覆盖全局整页设置 / override full page
    // waitForSelector: '.banner'   // 可选：等某元素出现再截图 / wait for selector
  },
  {
    key: 'home-mobile',
    name: '官网首页 移动端',
    url: 'https://m.example.com',
    viewport: { width: 414, height: 736 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ... Mobile/15E148 Safari/604.1'
  }
]
```

---

## Web 控制台 / Web dashboard

**中文**

```bash
npm run web
# 浏览器打开 / open http://127.0.0.1:3000
```

日常配置基本都能在界面里完成：

| 页面 | 能做什么 / What it does |
|---|---|
| 概览 / Overview | 顶部状态徽章（是否执行中、下次执行、邮件是否开启）、统计卡片、一键「立即执行」「发送测试邮件」「重新加载」、最近一次运行结果 |
| 定时任务 / Schedule | cron（带常用预设按钮）、时区、启动时是否先跑一次 |
| 站点与尺寸 / Sites | 增删改站点：名称、URL、宽/高、User-Agent、整页或首屏、等待元素；一键追加移动端副本（414×736 + iPhone UA） |
| 截图参数 / Capture | 并发数、超时、等待策略、重试次数、单图上限、自动滚动、历史保留天数、浏览器路径 |
| 邮件配置 / Mail | SMTP 主机/端口/SSL、账号与授权码、发件人、收件人、标题前缀；「发送测试邮件」+「诊断 SMTP 连接」 |
| 历史记录 / History | 每次运行的成功/失败清单 + 截图缩略图（点击运行记录展开详情） |
| 运行日志 / Logs | 查看最近 300 行日志，支持自动刷新 |

- **保存即生效**：配置写入 `data/config.json`（优先级高于 `.env`），保存后立即重新加载 cron。
- **密码处理**：邮箱密码只存本地文件，界面回显为掩码，留空表示不修改。
- **局域网/公网访问**：设置 `WEB_HOST=0.0.0.0`，并**务必**同时设置 `WEB_USER` / `WEB_PASS` 开启 Basic 认证。
- **两种模式**：`npm start` 纯命令行常驻；`npm run web` 带界面常驻（同样按 cron 自动执行）。
- **配置有错时**：控制台仍可打开，但不会注册定时任务，方便你在界面里改好后保存即恢复。

**字段校验规则 / Validation rules**

界面保存前先逐字段校验（出错位置标红 + 自动滚动定位），后端用同一份规则文件 `public/validate.js` 再校验一次（直接发 PUT 也躲不过）。命令行 `npm run check` 同样会校验。

| 字段 | 规则 / Rule |
|---|---|
| 收件人 / 抄送 | 必须是合法邮箱；一旦填了邮件信息，收件人至少 1 个且必须是邮箱 |
| SMTP 账号 | 必须是完整邮箱地址 |
| 发件人 | 邮箱，或「名称 <邮箱>」形式 |
| SMTP 服务器 / 端口 | 主机名形如 `smtp.xxx.com`（不能带 `http://`）、端口 1~65535 |
| 密码 / 授权码 | 未保存过密码时必须填写；已保存时留空表示不修改 |
| 站点 URL / 名称 | URL 必须 `http(s)://` 且含域名；名称必填 |
| 站点视口 | 宽 320~3840、高 320~4320；站点列表不能为空；标识不可重复 |
| cron / 时区 | 5 段 cron；IANA 时区（如 `Asia/Shanghai`） |
| 数值类 | 并发 1~8、导航超时 3000~180000ms、额外等待 0~30000ms、重试 0~5、单图/附件 1~50MB、保留天数 0~365 |

**内置 REST API**（界面就是基于它实现的，想二次开发可直接调用）

| 方法 | 路径 | 作用 / Purpose |
|---|---|---|
| `GET` | `/api/status` | 运行状态、下次执行时间、上次结果 / runtime status |
| `GET` `PUT` | `/api/config` | 读取 / 保存配置（带字段级校验） |
| `POST` | `/api/run` | 后台立即执行一次（运行中返回 409） |
| `POST` | `/api/test-mail` | 发送测试邮件 / send a test email |
| `POST` | `/api/mail/diagnose` | SMTP 逐层自检，返回报告文本 |
| `GET` | `/api/history`、`/api/history/:id`、`/api/history/:id/file/:name` | 运行列表、详情、截图文件 |
| `GET` | `/api/logs?lines=300` | 最近日志行 / tail logs |

**English**

`npm run web` → open <http://127.0.0.1:3000>: edit sites, viewports, SMTP and cron from the browser, trigger a run, browse history and tail logs. Settings persist to `data/config.json` (overrides `.env`) and the cron job reloads instantly; field-level validation highlights invalid inputs (emails must be real addresses) both in the UI and on the server side. For LAN/public exposure set `WEB_HOST=0.0.0.0` **together with** `WEB_USER`/`WEB_PASS`.

---

## 命令行 / CLI

```bash
node src/index.js             # 常驻定时执行 / run as daemon
node src/index.js --once      # 立即跑一次后退出（配合系统 crontab）/ run once and exit
node src/index.js --dry-run   # 只截图不发邮件（调试）/ capture, no email
node src/index.js --check     # 只校验配置 / validate config only
node src/index.js --help      # 帮助 / help

node src/server.js            # 启动 Web 控制台（含定时调度）
node src/diagnose.js          # SMTP 自检，输出逐层诊断报告
```

对应 npm 脚本：

| 命令 | 作用 / Purpose |
|---|---|
| `npm start` | 常驻定时执行（纯命令行）/ scheduled daemon |
| `npm run once` | 立即执行一次后退出 / run once |
| `npm run dry-run` | 只截图不邮件 / capture without email |
| `npm run check` | 校验配置 / validate config |
| `npm run web` | Web 控制台 / web dashboard |
| `npm run doctor:mail` | SMTP 自检 / SMTP diagnosis |

退出码 / Exit codes（`--once` 模式，便于 crontab 或监控告警识别）：

| 退出码 | 含义 / Meaning |
|---|---|
| `0` | 全部站点截图成功 / all succeeded |
| `1` | 至少一个站点失败，或配置/浏览器致命错误 / partial or total failure |

---

## 可靠性设计：超时 / 失败 / 打不开怎么办

这是本项目相对“脚本堆砌”最大的改进点。每种异常都有明确归宿，**不会静默失败，也不会卡死**。

This is where the project differs from a naive script: every failure mode has an explicit path — nothing hangs, nothing fails silently.

| 场景 / Scenario | 处理方式 / Handling |
|---|---|
| 页面加载慢 / Slow page | `NAVIGATION_TIMEOUT` 硬超时，超时即放弃该次尝试 |
| 站点偶发 502 / 抖动 | 指数退避重试 `CAPTURE_RETRIES` 次（3s → 6s → 12s…） |
| 站点彻底打不开 / DNS 失败 | 记为失败，邮件正文列出 `net::ERR_NAME_NOT_RESOLVED` 等具体原因 |
| HTTP 4xx/5xx | 读取 `response.status()`，非 2xx 直接判定失败并重试 |
| 截图空白 / SPA 未渲染完 | 自动滚动 + 检测正文字符数，过少则多等 3s 再截，并在报告中标注“疑似空白页” |
| 整页太大截不动 | 自动降级为**首屏截图**，报告里注明已降级 |
| 浏览器崩溃 / 断开 | 下次取用浏览器时自动重启 Chromium |
| 浏览器根本起不来 | 预检失败 → 立刻结束本轮，全部记失败（不会逐个站点空转重试） |
| 附件超过邮箱上限 | 只发文字报告 + 状态表格，保证邮件一定能发出 |
| SMTP 连不上 / 登录失败 | 先 `verify()` 快速失败，再重试 `MAIL_RETRIES` 次；仍失败则记录带错误码和排查建议的日志，**截图保留在磁盘**；可用 `npm run doctor:mail` 逐层自检 |
| 上一轮还没跑完 | 跳过本轮触发，避免任务叠加拖垮机器 |
| 页面/浏览器泄漏 | `try/finally` 必关页面与浏览器，退出时兜底 `SIGKILL` |
| 进程被 Ctrl+C / kill | 捕获 `SIGINT`/`SIGTERM`，取消定时任务并等待当前轮次收尾 |
| 磁盘被历史截图塞满 | `RETENTION_DAYS` 天前的目录自动清理 |
| 未捕获异常 | 记录日志但**不退出**常驻进程，保证第二天还能跑 |

日志示例 / Sample log：

```
2026-09-20T01:30:00.012Z [WARN] [home-pc] 第 1 次截图失败：net::ERR_CONNECTION_TIMED_OUT，3000ms 后重试
2026-09-20T01:30:05.884Z [INFO] [home-pc] 截图成功 812KB，耗时 5872ms
2026-09-20T01:30:06.001Z [INFO] 任务完成：成功 4/4，输出目录 .../screenshots/2026-09-20_09-30-00
```

---

## 部署方式 / Deployment

**中文**

```bash
# 方式一：进程常驻（推荐，配合 pm2 自动重启）
npm i -g pm2
pm2 start src/index.js --name site-shot --time    # 纯命令行
pm2 start src/server.js --name site-shot-web --time  # 带 Web 控制台
pm2 save && pm2 startup

# 方式二：系统 crontab 每天 09:30 跑一次（程序跑完即退出，最省资源）
30 9 * * * cd /path/to/project && /usr/bin/node src/index.js --once >> logs/cron.log 2>&1

# 方式三：Docker / 服务器无 Chromium 时，指向系统 Chrome
CHROME_PATH=/usr/bin/google-chrome node src/index.js
```

**English**

```bash
# Option 1: daemon via pm2 (auto restart)
pm2 start src/index.js --name site-shot --time

# Option 2: system crontab, one-shot at 09:30 (lightest)
30 9 * * * cd /path/to/project && /usr/bin/node src/index.js --once >> logs/cron.log 2>&1

# Option 3: no bundled Chromium? point to system Chrome
CHROME_PATH=/usr/bin/google-chrome node src/index.js
```

> 注意：进程没运行时定时任务不会补跑。需要“必定执行”请用 crontab 或 systemd timer。
> Note: a stopped daemon does not catch up on missed runs — use crontab/systemd timers for guaranteed execution.

---

## 常见问题 / FAQ & Troubleshooting

**1. Chromium 下载不下来（npm install 卡住/报错）**
Download of Chromium fails

```bash
# 方案 A：跳过下载，用系统 Chrome / Edge
PUPPETEER_SKIP_DOWNLOAD=true npm install
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"   # Windows
CHROME_PATH=/usr/bin/google-chrome                                    # Linux

# 方案 B：手动下载（国内可用镜像）
npm config set puppeteer_download_host=https://cdn.npmmirror.com/binaries/chrome-for-testing
npx puppeteer browsers install chrome
```

**2. 服务器上 Chromium 启动失败 / 报 sandbox 错误**
Chromium fails to start on a server

已默认加上 `--no-sandbox --disable-dev-shm-usage`。若仍失败，检查是否缺少系统库（CentOS: `yum install -y libatk nss atk at-spi2 cups-libs libxkbcommon libXcomposite libXdamage libXrandr mesa-libgbm pango`）。
Args `--no-sandbox --disable-dev-shm-usage` are already set; also verify system libs are installed.

**3. 截图是空白 / 只截到一半**
Blank or partial screenshot

- 调大 `EXTRA_WAIT`（如 `3000`）或把 `WAIT_UNTIL` 改成 `load`；
- 给该站点加 `waitForSelector` 等目标元素出现；
- 关闭整页截图（`FULL_PAGE=false`）看首屏是否正常，用于定位是否为懒加载问题。

**4. 邮件发不出去**
Email not sent

- 465 端口配 `SMTP_SECURE=true`，587 端口配 `false`（STARTTLS）；
- 腾讯企业邮/QQ 邮箱要用**授权码**而不是登录密码；
- 先看日志里 `SMTP 连接验证通过` 是否出现，再检查 `MAIL_TO` 是否填写；
- 附件过大时会自动只发文字报告，可调大 `MAX_ATTACHMENT_MB`；
- 现在的错误日志会带上 SMTP 地址、端口、错误码和排查建议，按提示改即可；
- 字段本身不合法（收件人不是邮箱、SMTP 账号不是邮箱等）会在**保存配置时**就拦截，见[字段校验规则](#web-控制台--web-dashboard)。

**5. 报 `SMTP 连接/登录超时 (timeout 20000ms)` 怎么办**
"SMTP connection/login timeout" — how to debug

跑内置自检（也可以在 Web 控制台点「诊断 SMTP 连接」）：

```bash
npm run doctor:mail
```

它会逐层排查：**DNS 解析 → TCP/SSL 连通 → SMTP 握手(EHLO/能力) → 账号登录**，并在当前配置连不通时自动试同域名的其它常用端口（含补 `smtp.` 前缀），最后给出可用组合。常见结论：

| 自检结果 | 原因 | 处理 |
|---|---|---|
| DNS 解析失败 | SMTP 地址写错 | 例如 QQ 邮箱应为 `smtp.qq.com`，腾讯企业邮为 `smtp.exmail.qq.com` |
| `ETIMEDOUT`（当前组合超时，换 `smtp.` 前缀后连通） | 地址漏了 `smtp.` 前缀 | 把 host 改成 `smtp.xxx.com` |
| `ETIMEDOUT`（所有端口都不通） | 本机/服务器防火墙、云厂商安全组、公司网络封了出口 25/465/587 | 放行出口端口，或改用 465/587 |
| `ECONNREFUSED` | 端口没开放 | 换端口 / 换 SMTP 地址 |
| `SSL wrong version number` | 加密方式不匹配 | 465 勾选 SSL，587 取消勾选 |
| 登录返回 `535` | 账号或密码错误 | QQ/163/Gmail 必须用**授权码/应用专用密码**，账号写完整邮箱地址 |
| 登录返回 `530` | 要先加密再登录 | 开启 SSL/STARTTLS |
| 发信报 `No recipients defined` | 收件人不是合法邮箱（例如填了昵称） | 收件人填真实地址，如 `name@example.com`；保存配置时就会拦截非法地址 |

> 提示：`exmail.qq.com`（网页地址）和 `smtp.exmail.qq.com`（发信地址）不是一回事，前者连 465 必然超时。

**6. 想先本地调试不想发邮件**
Debug without sending email

`npm run dry-run`：只截图、写 `report.txt`，不发信。

**7. 邮件里的图片看不到**
Images not visible in the mail

图片以 `cid` 内嵌，部分邮件客户端（如某些 Exchange/OWA）会拦截；此时附件里仍有 `report.txt` 与原始 PNG 可下载。

**8. Web 控制台打不开 / 端口被占用**
Web dashboard won't open / port in use

改端口：`WEB_PORT=4000 npm run web`（或写入 `.env`）。端口被占用时换一个即可。
局域网访问需 `WEB_HOST=0.0.0.0`；暴露到公网请设置 `WEB_USER` / `WEB_PASS`。

**9. 界面改了配置没生效？**
Changes from the UI don't apply

界面配置保存在 `data/config.json` 且优先级高于 `.env`：若 `.env` 里也写了同一项，以界面为准；删掉 `data/config.json` 即回到 `.env` 配置。

**10. 之前的 `pup.js` 去哪了？**
Where is `pup.js`?

v2 已重构为模块化结构，入口改为 `src/index.js`，用法见[迁移说明](#从-v1pupjs-迁移--migrating-from-v1)。

---

## 从 v1（pup.js）迁移 / Migrating from v1

| v1 | v2 |
|---|---|
| 单文件 `pup.js`，配置硬编码 | `src/` 模块化，配置全部走 `.env` |
| 失败即抛错，浏览器不关闭 | 超时/重试/降级/必关浏览器 |
| 截图路径固定、覆盖旧图 | `screenshots/日期_时间/` 归档 + 自动清理 |
| 邮件失败无感知 | 失败清单进邮件正文 + 日志 + 退出码 + `npm run doctor:mail` 自检 |
| 启动即定时，无法单次执行 | `--once` / `--dry-run` / `--check` |
| 只能改代码改配置 | Web 控制台可视化配置 + 字段级校验 + 立即执行/历史/日志 |
| SMTP 地址写错只能靠猜 | 启动校验告警 + 逐层自检直接给出可用组合 |

旧命令 `node pup.js` 已移除，等价命令为 `npm start`（常驻）或 `npm run once`（单次）。

---

## 更新日志 / Changelog

### 2026-09-20 · v2.1（Web 控制台 + 校验 + 自检）

- 新增 **Web 控制台**（`npm run web`）：概览、定时任务、站点与尺寸、截图参数、邮件配置、历史记录、运行日志七个页面，配置写完即生效并热重载 cron。
- 新增 **立即执行** 按钮与后台任务去重：上一轮没跑完会自动跳过，实时显示“执行中/空闲”状态。
- 新增 **历史记录**：按运行批次查看成功/失败清单与截图缩略图；**运行日志**页可直接 tail 日志文件并自动刷新。
- 新增 **字段级校验**：前后端共用 `public/validate.js`，邮箱类字段强制邮箱格式（收件人、SMTP 账号、发件人），出错处标红、自动滚动定位，后端 PUT 同样校验。
- 新增 **SMTP 自检**（`npm run doctor:mail` / 界面「诊断 SMTP 连接」）：DNS → TCP/SSL → SMTP 握手 → `AUTH LOGIN` 逐层定位，并自动尝试其它端口与缺失的 `smtp.` 前缀。
- 邮件错误日志增强：附带 `host:port secure=`、错误码（`ETIMEDOUT`/`EAUTH`/`EENVELOPE`…）和对应处理建议。
- 新增可选 Basic 认证（`WEB_USER` / `WEB_PASS`）与 `WEB_HOST` / `WEB_PORT` 配置。

### 2026-09-20 · v2.0（架构重构）

- 由单文件 `pup.js` 重构为 `src/` 模块化结构，配置全部环境变量化，新增 CLI（`--once` / `--dry-run` / `--check`）与退出码。
- 截图链路补齐：超时、重试、失败降级、空白页检测、并发控制、资源释放、历史归档与自动清理。

---

## 赞助支持 / Sponsor

如果这个项目帮到了你，欢迎请作者喝杯咖啡 ☕ 每一笔支持都会用于项目的持续维护与新功能开发。
If this project saved you some time, consider buying me a coffee ☕ Every contribution goes towards maintenance and new features.

<p align="center">
  <img src="assets/alipay-qr.jpg" alt="支付宝收款码 / Alipay QR code" width="300">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="assets/wechat-qr.jpg" alt="微信收款码 / WeChat Pay QR code" width="300">
</p>

<p align="center"><b>支付宝 Alipay</b> &nbsp;·&nbsp; <b>微信支付 WeChat Pay</b></p>

> 点个 ⭐ Star 也是很大的鼓励。
> A ⭐ star is equally appreciated.

## License

[MIT](./LICENSE) © woxiaofa

相关依赖 / Built with: [Puppeteer](https://github.com/puppeteer/puppeteer) · [node-schedule](https://github.com/node-schedule/node-schedule) · [Nodemailer](https://nodemailer.com/about/) · [dotenv](https://github.com/motdotla/dotenv)
