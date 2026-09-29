# Python 依赖清理与 MangaOCR 升级记录

核对日期：2026-09-29。新版依赖已用于 v1.2.1 正式环境。

## 普通环境

当前配置界面只提供 OpenAI、Gemini、DeepSeek。后端旧 Google/MyMemory
和 Claude 路径已删除，旧 provider 请求返回 422，不会自动改用另一家服务。
普通 OCR 引擎保持 RapidOCR 3.9.2、ONNX Runtime 1.30.0。

从 requirements 及本机 `backend/.venv` 移除了 `deep-translator`、`anthropic`。
核对依赖关系后，还卸载了没有其他使用者的 `beautifulsoup4`、`soupsieve`、
`docstring-parser`。`requests` 仍被 RapidOCR 使用，`jiter`、`sniffio`
仍被 OpenAI 客户端使用，因此保留。

`deep-translator` 的 [PYSEC-2022-252 原始公告](https://raw.githubusercontent.com/pypa/advisory-database/main/vulns/deep-translator/PYSEC-2022-252.yaml)
列出被攻击版本 1.8.5，但范围未给出修复终点，导致 1.11.4 也被匹配。
卸载前下载 PyPI 官方 1.11.4 wheel、验证其 SHA-256，并比对本机 21 个
Python 源文件，全部一致。这不是完整恶意代码审计，也不能证明历史上从未受影响。
移除的直接原因是这些服务已不在产品支持范围内。

其他已有开发环境不会因修改 requirements 自动卸载旧包。确认与上述依赖图一致后，可执行：

```powershell
backend/.venv/Scripts/python.exe -m pip uninstall deep-translator anthropic beautifulsoup4 soupsieve docstring-parser
backend/.venv/Scripts/python.exe -m pip check
```

## MangaOCR 正式环境

已验证的候选依赖晋升至 [正式清单](../backend/requirements-manga-ocr.txt)，
默认开发和构建均使用重新创建的 `.manga-ocr-venv`。不再需要候选清单或环境变量切换。
以下表格保留升级前后的对照记录：

| 依赖 | 升级前 | v1.2.1 正式环境 |
| --- | --- | --- |
| Python | 3.10.11 | 3.10.11 |
| PyTorch | 2.6.0 | 2.14.0（实际 wheel 为 CPU 构建） |
| Transformers | 4.57.6 | 5.17.0 |
| setuptools | 65.5.0 | 84.0.0 |
| manga-ocr | 0.1.16 | 0.1.16 |

创建正式开发及构建环境：

```powershell
py -3.10 -m venv .manga-ocr-venv
.manga-ocr-venv/Scripts/python.exe -m pip install --index-url https://pypi.org/simple --upgrade pip==26.2.1 setuptools==84.0.0
.manga-ocr-venv/Scripts/python.exe -m pip install --index-url https://pypi.org/simple -r backend/requirements-manga-ocr.txt -r backend/requirements-build.txt
.manga-ocr-venv/Scripts/python.exe -m pip check
```

正式清单固定主要模型依赖和关键配套版本；尚未锁定完整间接依赖及 wheel 哈希；后续重新解析可能产生不同的间接版本。
本次主要配套版本：tokenizers 0.23.2、huggingface-hub 1.33.0、safetensors 0.8.0、
numpy 2.2.6、Pillow 12.3.0、PyInstaller 6.22.0。

若之前在终端设置了候选解释器，启动前清除旧覆盖值：

```powershell
Remove-Item Env:MWT_MANGA_OCR_PYTHON -ErrorAction SilentlyContinue
npm start
```

## 晋升前的对照结果与边界

- 普通环境 47 个包、候选环境 53 个包的 PyPI 版本漏洞公告查询均成功，未命中公告。
  这不覆盖未知漏洞、所有原生 DLL 或现有安装包，也不代表原 MangaOCR 环境已修复。
- 两个环境 `pip check` 均通过；Python 后端回归 47 项、Node 测试 29 项通过。
- 使用固定模型 revision `aa6573bd10b0d446cbf622e29c3e084914df9741`，离线、CPU，
  对两个保存气泡各重复三次，新旧输出逐字一致。
- 原环境单次识别 0.282–0.597 秒，候选 0.224–0.346 秒。
  单次进程内导入、加载及内置预热合计分别为 9.778 秒和 7.801 秒。
  样本和启动轮数有限，存在系统文件缓存影响，不能推断所有漫画的精度和速度。
- 通过实际后端 `/bubble/ocr` 和 `/bubble/manga-ocr` 验证两个截图，均返回非空结果；
  四次 MangaOCR 请求复用同一 worker。候选 worker 启动约 7.233 秒，
  接口耗时 0.258–1.558 秒，区别于直接模型推理的计时。
- Transformers 提示缺少 torchvision 时使用 PIL 图像处理后端；识别成功，
  不为消除提示额外安装无必要的视觉依赖。
- 未执行付费翻译请求、完整桌面 UI 验收、PyInstaller 冻结或安装包验收。

对照脚本需要本机 `.qa/real-01.jpg`、`real-02.jpg` 及 `live-real-*.json`，不随仓库分发：

```powershell
.manga-ocr-venv/Scripts/python.exe tests/manga-dependency-check.py
```

v1.2.1 的冻结程序及安装载荷验收结果另见 [发布验证记录](RELEASE-1.2.1.md)。
这些小样本不能代替更多竖排、注音和低清漫画的识别精度评估。
