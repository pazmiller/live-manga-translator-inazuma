# Inazuma 开发文档

[返回 README](../README.md)

此文档描述当前源码。两个 1.2.1 安装包包含认证、Electron 加固、窗口修复与依赖更新。发布文件和校验和见 [GitHub Releases](https://github.com/pazmiller/live-manga-translator-inazuma/releases)。

## 环境与启动

Windows x64，安装 Node.js/npm 和 Python 3.13，在仓库根目录运行：

```powershell
npm ci
py -3.13 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
npm start
```

启动器清除 `ELECTRON_RUN_AS_NODE`，Electron 自动启动自己的 Python 后端，无需另开服务。普通 OCR 使用 RapidOCR，首次使用某种语言可能下载模型，默认预热日文。翻译配置通过界面完成，`.env.example` 仅供可选的开发配置。

模型预设和 API 端点集中于 [`backend/provider-catalog.json`](../backend/provider-catalog.json)。该文件记录的核对日期为 2026-09-29，近期窗口起点为 2026-06-29；这是一份静态快照，不保证始终最新。同步模型从服务商接口读取，有创建日期时筛选近期模型，没有日期时明确标注，不推断发布时间；可手动输入未列出的模型名。

更新预设时核对服务商资料：[OpenAI](https://developers.openai.com/api/docs/changelog)、[Gemini](https://ai.google.dev/gemini-api/docs/changelog)、[DeepSeek](https://api-docs.deepseek.com/updates/)。不要在配置目录或测试中写入真实密钥。

## 可选 Manga OCR

依赖版本以 [`backend/requirements-manga-ocr.txt`](../backend/requirements-manga-ocr.txt) 为准，默认开发及打包均使用 `.manga-ocr-venv`。发行版使用 CPU 推理，不需要独立显卡。

使用独立 Python 3.10 环境：

```powershell
py -3.10 -m venv .manga-ocr-venv
.manga-ocr-venv/Scripts/python.exe -m pip install -r backend/requirements-manga-ocr.txt
.manga-ocr-venv/Scripts/python.exe -c "from manga_ocr import MangaOcr; MangaOcr()"
npm start
```

也可用 `MWT_MANGA_OCR_PYTHON` 指向已安装 Manga OCR 的 Python。两种 OCR 启动后分别预热，Manga OCR 常驻独立工作进程，退出时清理。预热可能暂时占用较多 CPU 和内存。此前本机开发环境约 1.6 GiB、模型缓存约 0.85 GiB，不能直接等同于压缩安装包体积。

真实气泡对照脚本为 `tests/manga-ocr-live.py`，需要本机测试素材 `.qa/real-01.jpg`、`real-02.jpg` 及对应 JSON；这些文件不随 Git 分发。

## 验证

首次生成本地测试素材，再运行统一入口：

```powershell
backend/.venv/Scripts/python.exe tests/make_fixture.py
npm run validate
```

默认按顺序运行九个阶段：

1. Node 基础测试。
2. Python 后端接口与认证。
3. UI 功能与布局。
4. AI 配置、模型切换、加密密钥及中英文切换。
5. 真实父子进程、管道、HTTP 和 IPC 的认证后翻译/编辑流程，OCR 和翻译结果使用固定数据。
6. Electron 来源/角色校验、CSP、权限、导航及弹窗拦截。
7. Windows 原生命中区域与按钮输入。
8. Windows 原生移动、尺寸稳定性、截图排除标记及失败恢复。
9. 默认 GPU 模式的响应性能。

默认验证不调用真实 OCR 或付费翻译。基础测试限时 30 秒，其余每阶段 60 秒；失败后继续其他阶段，最终以非零退出码报告失败。结果保存在 `.qa/validation/latest.json` 和同目录日志中；运行中为 `RUNNING`，每次运行覆盖上一份报告。

测试使用隔离窗口/配置和受控数据，不代替人工操作、真实漫画、网络服务和混合 DPI 双屏验收。部分测试会短暂显示或移动测试窗口；不要同时运行多份 Electron 验证。

常用单项验证：

```powershell
npm test
npm run test:ui
npm run test:settings
npm run test:input
npm run test:responsive
backend/.venv/Scripts/python.exe -m unittest discover -s tests -p "test_*.py" -v
node tests/backend-auth-live.cjs
```

最后一项使用真实本地 OCR 和认证通道，不调用付费 API。实验截图折射另用 `npm run validate:glass`，结果位于 `.qa/validation/glass/`，不能替代默认验证。也可单独运行 `npm run test:glass` 和 `npm run test:glass:app`。

以下测试会调用真实翻译服务，需有效密钥并可能产生费用，不属于默认验证：

```powershell
backend/.venv/Scripts/python.exe tests/benchmark.py --live
npm run test:app:live
```

## 构建 Windows 安装包

先完成上述依赖安装及测试素材生成。标准版：

```powershell
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-build.txt
npm run dist:win
npm run test:packaged
```

构建会预热并收集普通 OCR 各源语言模型；首次可能下载模型、Electron 和 NSIS。输出为 `dist/Inazuma-Setup-1.2.1-x64.exe`（版本号随 package.json 更新）。也可运行 `dist/win-unpacked/Inazuma.exe`，但必须保留整个 `win-unpacked` 目录，不能只分发里面的 exe。

MangaOCR 完整版需先准备 `.manga-ocr-venv`，并缓存固定模型版本：

```powershell
.manga-ocr-venv/Scripts/python.exe -m pip install -r backend/requirements-build.txt
.manga-ocr-venv/Scripts/python.exe -c "from huggingface_hub import snapshot_download; snapshot_download('kha-white/manga-ocr-base', revision='aa6573bd10b0d446cbf622e29c3e084914df9741')"
npm run dist:win:manga
node tests/packaged-smoke.cjs "dist/mangaocr/win-unpacked/Inazuma MangaOCR.exe" --manga
```

输出为 `dist/mangaocr/Inazuma-MangaOCR-Setup-1.2.1-x64.exe`。安装版使用独立安装标识、内置模型、CPU 推理与 Hugging Face 离线模式；无需用户 Python 或联网获取模型。模型来自 [kha-white/manga-ocr-base](https://huggingface.co/kha-white/manga-ocr-base)，发行包保留第三方许可证信息。

`test:packaged` 检查实际 exe、内置 OCR、配置与语言切换及退出清理，不调用翻译服务。`--manga` 还使用空缓存与无系统 Python 的 PATH 验证内置 Manga OCR。修改源码后必须重新构建再测试，不能用旧 exe 的结果替代。

发布时上传对应 **Setup 安装 exe**，可附 `.sha256` 校验文件。`.build/` 和 `dist/` 不入 Git。`.build/backend/inazuma-backend/inazuma-backend.exe` 只是内部后端，不能作为完整应用单独分发。当前构建未代码签名。

## 安全边界

API Key 使用 Electron `safeStorage` / Windows DPAPI 加密，保存在应用用户数据目录的 `ai-settings.json`，不向 renderer 回填明文。旧 `.env` 或 `settings.env.txt` 的迁移不会修改或删除原明文文件。

每次启动生成独立的 256 位临时秘密，通过 stdin 管道交给 Python，不写入文件、命令行或环境变量。默认使用随机本地端口并启动自己的后端。每条新连接先验证随机挑战 HMAC，再仅在同一 TCP 连接发送业务凭证、截图和翻译密钥；所有业务接口认证在读取请求体前完成。浏览器 Origin 请求拒绝。`MWT_BACKEND_PORT` 仅指定端口，不是认证开关；不要裸请求服务或单独启动无父进程认证的 server.py。

所有窗口明确启用沙箱、上下文隔离和 Web 安全，阻止导航、弹窗和不需要的设备权限。IPC 核对登记窗口、主 frame、精确 URL、角色与参数。CSP 禁止内联脚本和 renderer 直接联网，服务商访问经主进程完成；动态布局所需的内联样式仅在相应页面保留。

这些保护不承诺防御已经控制同一 Windows 用户或管理员权限的恶意软件，也不等于所有依赖均无漏洞。发行前仍需检查依赖、许可证、密钥排除和实际安装包。

## 截图与实验玻璃效果

默认使用透明背景、动态高光和较实的文字底色，不持续截图模拟折射，不生成光学位移贴图。此前本机桌面采样曾约 451–526 ms/次，因输入响应问题退出默认路径；该历史数值不是所有电脑的性能指标。

普通翻译目前仍隐藏窗口，等待 80 ms 并完成截图处理，然后在 finally 恢复显示；尚未改为可见窗口采样。连续阅读预览只在采样期间临时调用 setContentProtection，成功或失败后恢复系统截图可见性。正常状态允许用户截取 UI。

实验模式设置 `MWT_GLASS_CAPTURE=1`，需要 Windows 10 2004 或更新版本，可能严重卡顿。它持续排除应用窗口以免镜像反馈，因此外部截图/录屏可能看不到 UI。背景仅在本机内存处理，只把玻璃覆盖区域交给 renderer，不写磁盘、不发给 OCR/翻译；跨显示器或截图失败时回退。此模式不是 Apple 原生 Liquid Glass。

## 后续工作与验收边界

- 扩充真实竖排、注音、小字和低清漫画样本，评估普通 OCR 漏检气泡和 MangaOCR 的识别效果；少量截图测试不能代表整体准确率。
- 测量低性能 CPU 上的冷启动、常驻内存和连续识别耗时，优化翻页检测的截图开销。流式翻译和启动预热已实现，不再列为待开发功能。
- 补充干净 Windows 环境的安装、覆盖升级、卸载和混合 DPI 多屏验收；自动化接口及窗口测试不能代替人工鼠标、滚轮和系统截图体验。
- 排查 UI 截图测试偶发的 `UnknownVizError`。v1.2.1 已执行实际 exe 冒烟测试，但未重跑完整 `npm run validate`，不能把旧报告当作当前完整回归结果。
- 评估安装包代码签名与发行版 Electron fuses；继续核查依赖、模型来源及打包后的内容。

当前译文固定在屏幕坐标上，翻页检测会隐藏旧结果，不会自动跟踪滚动后的气泡位置。图像背景处理也不等同于内容修复（inpainting）；如需增加这两项能力，应独立设计和验证。
