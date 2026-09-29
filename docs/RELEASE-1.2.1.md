# v1.2.1 本地构建验证

日期：2026-09-29。两个 Windows x64 安装包已构建，尚未上传或发布。

| 版本 | 本地路径 | 字节数 |
| --- | --- | --- |
| 标准版 | `dist/Inazuma-Setup-1.2.1-x64.exe` | 219941104 |
| MangaOCR 完整版 | `dist/mangaocr/Inazuma-MangaOCR-Setup-1.2.1-x64.exe` | 797584908 |

SHA-256：

```text
96ea7dec6063b2b16c82e21356f4932b10fa7207f76b38bff585da662dce2c1b  Inazuma-Setup-1.2.1-x64.exe
961b6a60b8cae7af9bbff07ce4ca679121826f76617af60ef1b65a797b12e2c4  Inazuma-MangaOCR-Setup-1.2.1-x64.exe
```

## 实际验证

- `npm audit`：0 个已知漏洞；Node 测试 29 项、Python 后端测试 47 项通过。
- 普通环境及正式 MangaOCR 环境 `pip check` 通过。正式 MangaOCR 的 53 个包
  PyPI 版本公告查询均成功、无命中；普通环境 47 个包在此次晋升前的清理验证中无命中。
- 两个真实应用 exe 均通过 `tests/packaged-smoke.cjs`：内置日、英、中、韩 OCR，
  未认证请求拒绝，配置窗口及三家 provider，中文/英文切换，清除及退出后的后端清理。
- 完整版在空 Hugging Face 缓存、离线模式和不含 Python 的 PATH 下通过 MangaOCR。
  合成日文气泡连续两次识别成功，耗时 155 ms、128 ms；这是小样本热识别，不是启动耗时。
- 直接检查冻结 worker 中的版本常量：PyTorch `2.14.0+cpu`、Transformers `5.17.0`。
  正式 `.manga-ocr-venv` 已重新创建，默认开发与构建路径无需改动即可使用新版。

## 载荷和密钥检查

- 从安装程序解出的标准版 629 个文件、完整版 5663 个文件，与对应 `win-unpacked`
  构建目录逐文件 SHA-256 一致。解包载荷分别为 673893363、1923718058 字节。
- 两个 app.asar 各 27 个应用文件；没有 `.env`、`ai-settings.json` 或
  `settings.env.txt` 等本地配置文件混入安装载荷。
- 对 Git 可达对象、工作文件、解包载荷及 app.asar 执行已知本地密钥精确比对；
  文本文件另查常见密钥格式，未发现命中。扫描报告不记录密钥明文。
- 三份 PyInstaller 归档另行解压扫描：两份普通后端各 3408 项，MangaOCR worker
  7326 项，未检出已知本地密钥或所检查的常见密钥格式。应用模块与当前源码相符。
- 内置 `pytorch_model.bin` 对照官方固定 revision 的 LFS SHA-256 验证一致：
  revision `aa6573bd10b0d446cbf622e29c3e084914df9741`，
  SHA-256 `c63e0bb5b3ff798c5991de18a8e0956c7ee6d1563aca6729029815eda6f5c2eb`。

## 边界

两个安装包均未代码签名。检查不能保证没有未知漏洞、任意编码的秘密或所有原生库问题。
本次没有付费翻译调用，也没有覆盖现有安装的升级、安装向导、卸载向导或混合 DPI 人工验收。
执行的是实际 exe 自动化和安装载荷解包比对；没有覆盖用户当前安装来测试安装流程。

完整桌面 `npm run validate` 未重跑，之前暂停处理的 UI 截图测试问题不在本次修复范围。
本地构建、冒烟及扫描证据位于 `.qa/build-1.2.1-*.log`、`.qa/smoke-1.2.1-*.log`
及 `.qa/release-1.2.1/`，这些测试产物不随 Git 分发。
