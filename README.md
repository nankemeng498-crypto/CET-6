# CET-6 Words

原生 HTML / CSS / JavaScript 的个人背词 PWA，无构建步骤、无 npm 依赖、无业务后端。

## 本地启动

在 PowerShell 中运行：

```powershell
cd D:\CET-6
python -m http.server 8000 --bind 0.0.0.0
```

电脑打开 http://localhost:8000 。不要直接双击 index.html；示例词库读取与 PWA 需要 HTTP/HTTPS 环境。这里的服务器仅提供静态文件，不处理或上传学习数据。关闭窗口或 Ctrl+C 可停止。

## 手机 / iPad 测试与安装

1. 电脑与手机 / iPad 连接同一个 Wi-Fi。
2. 用 `ipconfig` 查看电脑的局域网 IPv4 地址，在设备浏览器打开 `http://电脑IPv4地址:8000`。如无法连接，检查电脑防火墙是否允许该端口。
3. 测试竖屏、横屏和底部按钮。局域网普通 HTTP 可测试学习功能，但通常不能启用 service worker，不能用于验证离线 PWA。
4. 完整安装与离线测试需要把相同静态文件放在可信 HTTPS 地址。项目无需改代码，也无需业务后端。
5. iPhone / iPad 使用 Safari「分享 → 添加到主屏幕」；支持安装的 Android / 电脑浏览器使用菜单中的安装入口。
6. 首次联网打开并等待缓存完成，再从主屏幕启动、断网测试。第一次没有缓存时无法离线打开。

## GitHub Pages 部署

仓库命名为 `CET-6` 时，可将本项目根目录直接作为 Pages 发布目录，无需构建。预计地址为 `https://用户名.github.io/CET-6/`，请使用带结尾斜杠的项目地址。根目录已有 `.nojekyll`。

HTML 资源、示例词库读取和 Service Worker 注册均使用相对路径；manifest 的 `start_url`、`scope` 为 `./`，图标也相对于 manifest。Service Worker 按实际注册 scope 生成缓存 URL，因此根目录和 `/CET-6/` 子目录都可使用。`node tools/test-service-worker.cjs` 覆盖这两种部署路径及离线资源解析。

部署后先联网打开正式地址，确认示例词库和图标加载、离线缓存安装完成，再测试断网刷新及主屏幕启动。原本 localhost 的学习数据不会自动出现在新域名；已有数据请先导出，再在正式地址恢复。以后修改静态资源时仍须更新 Service Worker 缓存版本。

## 数据与备份

- IndexedDB 数据库 `cet6-words`：`words` 保存词典与进度，`days` 保存每日记录，`meta` 保存初始化标记和可续学的当天队列。
- localStorage 的 `cet6-settings` 仅保存每日新词数、自动发音和手势开关。
- Cache Storage 的 `cet6-shell-v9` 保存离线静态资源。
- 不同设备、浏览器及网站地址（协议 / 主机 / 端口）各有独立数据。切换地址前先导出 JSON，再在新地址恢复。
- 「我的 → 导出完整学习数据」备份词库、进度、每日记录、队列、设置和连续学习数据。连续天数按每日记录计算。
- 导出在同一个只读事务里读取完整快照；恢复前检查有效日期、每日统计、队列和可选字段。确认后在一个 IndexedDB 事务中覆盖词库、统计与队列；设置不可写时取消恢复，事务失败时回滚设置。清空进度需要两次确认，保留词库和收藏。
- 浏览器清理站点数据可能删除进度，建议定期导出。私人浏览模式不适合长期保存。

## 导入与学习规则

JSON 词库是数组，参考 `sample-words.json`。CSV 表头为 `word,phonetic,meaning,example,exampleZh`；CSV / JSON 均支持 UTF-8 BOM，CSV 支持带引号的逗号及跨行例句，并拒绝重复表头、多余列和错误引号。`word` 与 `meaning` 必填，其他字段可空。英文单词按去除首尾空白后的小写去重。重复导入保留原有词典内容与全部进度，仅补齐空缺信息；例句中文只在能确认英文对应时补齐，避免错配。

文件导入会严格检查 UTF-8 编码，避免把 GBK 等编码静默读成乱码。Excel 导出的 CSV 请选择「CSV UTF-8」格式。

CSV / JSON 还支持三个可选字段：`frequency`（非负数字，缺失或空白为 `null`）、`level`、`source`（文本，缺失为 `""`）。CSV 中的词频数字会转为数值，`0` 是有效值。旧词库和旧备份无需补字段，也无需升级 IndexedDB。新字段参与导出 / 恢复；重复导入只补空值，不覆盖已有元数据或学习进度。当前 UI 和背词规则不使用这三个字段。

### 外部词库转换

独立脚本仅使用 Python 标准库，不参与 App 运行：

```powershell
python tools/convert_cet_vocab.py external.json cet6-words.json --level CET-6 --source "词库名称"
```

支持 UTF-8 / UTF-8 BOM JSON 词条数组、`words` / `data` 数组包装或单个词条。可读取 App 原字段，常见的 `translation` / `translations`、`freq`、`usphone` / `ukphone`、`examples`（`en` / `zh`），以及有道结构的 `headWord`、`content.word.content.trans` 和 `sentence.sentences`。未列出的外部结构可能需要再补映射。

输出固定为 `word, phonetic, meaning, example, exampleZh, frequency, level, source`。英文忽略大小写去重，重复词保留已有内容，仅补空值。缺少音标或例句保持空字符串，不生成内容；缺少词频为 `null`，不会把词条序号 `wordRank` 当成词频。`--level` / `--source` 仅填补缺失字段，不传则为空。缺少单词或释义时明确报错，不写输出；输入与输出不能是同一文件。

每日队列依次加入到期复习词、以前学习过且今天尚未完成的低掌握单词、新词。默认新词上限 40，示例词库仅有 20 词。手动设置掌握等级的词遵循其复习时间，不再当作全新词。设置变更在下一轮生成队列时生效。每天统计按不同单词计数，重复练习不重复计入完成量。刷新可续学；跨午夜或回到前台会重新读取日期与数据，拒绝提交昨日卡片。首页进度会计入本轮仍待重复的词。

认识：掌握等级加一，上限 4；不认识：减一，下限 0。新词首次遗忘在最多 5 个后续词之后重现；之后再次遗忘则放到队尾，防止前几个词反复循环、后面的新词永远轮不到。最后只剩这个词时安排 10 分钟后再练，避免立即连续重复。模糊：当前 0–2 级保持，3–4 级调到 2。复习间隔为 0 级 10 分钟、1 级 1 天、2 级 3 天、3 级 7 天、4 级 15 天；不认识一律安排 10 分钟后复习。到期时会刷新今日任务。

手势默认关闭。开启并显示答案后，在英文单词区域左滑 / 右滑 / 上滑进行回答。水平至少 90px，上滑至少 110px，且需要明显方向及较短时间。释义区域仍可正常滚动，按钮始终可用。

## 验证

```powershell
node tests.cjs
node --check app.js
node --check service-worker.js
node tools/test-service-worker.cjs
python -B -m unittest discover -s tools -p 'test_*.py'
```

`tests.cjs` 使用内存事务替身检查学习队列、当天重复、复习间隔、每日去重、CSV / JSON 解析、重复导入、导出内容与恢复往返、无效备份拒绝及进度重置。`tools/test-service-worker.cjs` 检查版本缓存的一致性、安装绕过 HTTP 旧缓存、离线资源、失败更新保护、缓存隔离及图标规格。Python 的 11 项测试包含 5000 词转换、例句对应、重复词元数据、异常输入及输出失败保护。

真实 IndexedDB 集成检查使用单独测试地址：

```powershell
python -m http.server 8011 --bind 127.0.0.1
```

打开 `http://localhost:8011/tools/browser-audit.html` 并点击运行。**该工具会清空 8011 测试地址的数据，不要在此地址保存个人词库；它不会修改 8000 地址的数据。** 检查覆盖真实事务回滚、其他连接写入后的进度保护、过期提交拒绝、并发导出一致性、5000 词 JSON / CSV 导入、备份往返、损坏备份、设置失败、跨午夜、连续天数和尾部重复。发音错误与触摸取消的逻辑用模拟事件验证。

已在浏览器检查 375×812、430×932、812×375、768×1024、1024×768、1440×900，学习页无横向溢出，操作按钮位于导航上方。停止静态服务器后，已缓存页面可刷新、显示答案并继续使用。内置浏览器的文件下载事件未成功回传，因此普通浏览器的下载落盘、真机安装、系统语音声音和触摸手势仍需设备端验证。

本次桌面浏览器真实 IndexedDB 检查中，5000 词 JSON 首次导入约 0.42 秒、重复导入约 0.10 秒，CSV 解析与重复导入约 0.11 秒；完整备份恢复和事务回滚检查通过。这些结果用于发现明显性能问题，不代表 iPad / iPhone 的实际速度。停止服务器后的检查还确认了刷新续学、离线回答保存和每日统计更新。

## 已知限制与后续同步

仅有 20 个示例词；无账号、云同步或完整六级词库。发音使用系统 SpeechSynthesis，英文语音可用性、自动发音权限和离线声音取决于设备。会保留已经生成的学习队列，不因中途修改每日数量而删除任务。

今后接云同步时，从 `transaction()` 的成功保存之后及 `reload()` 的读入处接入同步层。保持 `words` / `days` / `meta` 的清晰边界，新增用户 ID、记录 ID、更新时间和冲突策略，再实现登录与双向同步。当前没有接入 Supabase。

修改静态资源后，发布时更新 service-worker.js 的缓存版本。每次启动主动调用 `registration.update()` 检查更新。每个版本安装时缓存完整资源集，使用 `cache: reload` 绕过 HTTP 旧缓存，激活后仅删除本 App 的旧版本缓存。页面与核心资源使用同一版本缓存，离线和弱网无需等待网络超时；更新成功后提示刷新，不在学习中强制刷新。HTTPS 托管时建议 `service-worker.js` 使用 `Cache-Control: no-cache`，App 也已设置 `updateViaCache: none`。

Safari 与主屏幕独立 App 的安装、存储迁移、自动发音权限、真实滑动和系统安全区域仍需在 iPhone / iPad 验证。浏览器本地存储不能替代外部备份，系统清理或存储压力仍可能删除数据；参见 [WebKit 存储策略](https://webkit.org/blog/14403/updates-to-storage-policy/)。
