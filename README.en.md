# Inazuma

[简体中文](README.md) | **English**

A manga screen translator for Windows. Select the manga you are reading, recognize its text locally, and translate it using your chosen AI provider. Translations appear over the original bubbles or as draggable notes, without importing an entire book or switching reading apps.

- **Region translation:** Recognize Japanese, English, Chinese, and Korean text, with translations displayed as they arrive.
- **Two display modes:** Fit translations over the original bubbles, or preserve the artwork and use numbered notes.
- **Enhanced Japanese recognition:** Optionally use MangaOCR to refine saved images of detected speech bubbles.
- **AI configuration:** Supports OpenAI, Gemini, and DeepSeek, with account model discovery and custom model names.
- **Reading and corrections:** Compare source text, edit individual bubbles, adjust font sizes, detect page changes, and switch between Chinese and English UI.

## Installation

For Windows x64. The installers include the required runtime: you do not need Node.js, Python, or a separately started backend. AI translation requires an internet connection and your own provider API key.

| Edition | Best for | Included | Built v1.2.1 installer |
| --- | --- | --- | --- |
| Standard | A smaller installation with standard OCR | Python runtime, standard OCR, and its models | `Inazuma-Setup-1.2.1-x64.exe`, approximately 210 MiB |
| MangaOCR | Enhanced recognition of Japanese manga dialogue | Everything in Standard, plus MangaOCR, its CPU runtime, and model | `Inazuma-MangaOCR-Setup-1.2.1-x64.exe`, approximately 761 MiB; extracted payload approximately 1.79 GiB |

Run the installer for your chosen edition, then open **Inazuma** or **Inazuma MangaOCR** from your desktop or Start menu. The installers are not code-signed, so Windows may display an unknown publisher warning.

**What's new in v1.2.1:** Both installers include local backend authentication, Electron window protections, window movement and capture fixes, and removal of unused translation dependencies. The MangaOCR edition uses an updated PyTorch / Transformers CPU runtime. Installers and SHA-256 checksums are available on [GitHub Releases](https://github.com/pazmiller/live-manga-translator-inazuma/releases). The older v1.1.0 installers do not include these subsequent changes.

To run from source or build an installer, see the [development guide (Chinese)](docs/DEVELOPMENT.md).

## Getting started

1. Open **Translation AI** and select OpenAI, Gemini, or DeepSeek.
2. Choose a model, enter the provider's API key, and click **Save & use**. The API endpoint is set automatically; there is no need to edit `.env`.
3. Drag the selection border and its corners to frame the manga. Move the toolbar separately using its heading area.
4. Choose the source and target languages, then click **Translate region** or press `Ctrl+Shift+T`.
5. Detected regions first appear as dashed outlines. Each translation appears when it is ready. Click the main button again to cancel the current task.

The app remembers a separate model and key for each provider. When you reopen settings, the key field is blank: **saving with the field blank keeps the saved key**, so changing models does not require entering it again.

Model presets do not continuously update themselves. **Sync models** fetches the model list returned for your provider account; you can also choose **Enter a model name…**. A successful sync does not guarantee access or sufficient quota for every listed model.

## Reading and corrections

**Smart fit** places translations over the original text when the background is suitable and the translation fits; complex backgrounds or longer text use numbered notes instead. **Notes** preserves the original manga text and works well for complex artwork or longer translations.

| Control | What it does |
| --- | --- |
| **A− / A+** | Adjust the translation font size; text that no longer fits switches to a note |
| **Original** / `Ctrl+Shift+O` | Temporarily hide translations; use it again to restore them |
| Drag a translation | Move it; an overlaid translation becomes a note |
| Double-click a translation / source-text control | Switch between recognized source text and its translation |
| **Edit** | View the saved bubble crop, correct its text, then translate and save |
| **Clear** / `Ctrl+Shift+C` | Cancel the task and remove translations |
| **Retry remaining / Restore previous** | Recover from partial failures; retries use the original task's screenshot and configuration |
| **Fixed / Page watch** | Detect page changes and hide old translations; confirm translation of the new page once the image settles |
| **Lock region** | Toggle whether the empty selection area intercepts clicks; the toolbar and translations remain interactive |
| **Clear / Soft** appearance | Adjust the panel appearance; Soft improves contrast over busy backgrounds |
| **EN / 中文** | Switch the UI language without changing manga text, translations, or translation languages |

Long translations scroll inside their cards. Use the × in a card's upper-right corner to close that result. Quitting requires clicking the quit button twice within three seconds. The app remembers UI language, translation languages, font size, and display preferences.

### Enhance OCR and MangaOCR

After translating a Japanese region with standard OCR, click **Enhance OCR** on the toolbar. MangaOCR refines the detected bubbles that are still displayed, using the saved screenshot. Bubbles whose source text changes are translated again, and results are updated together only when the entire operation succeeds. A failure leaves the existing results intact.

To correct a single bubble, open its editor and use the MangaOCR recognition button. The result fills the source-text field; check it before translating and saving. If you change the source, the previous translation is marked as not yet updated.

MangaOCR supports Japanese only and requires the full edition or an additional development environment. It reuses bubble positions found by standard OCR and **cannot recover bubbles that standard OCR missed entirely**. The model warms up in the background at startup and stays loaded; loading and recognition times depend on your computer.

## Privacy and data

- OCR runs locally. For translation, extracted text is sent to your chosen AI provider, which may charge for requests.
- API keys are stored using Windows DPAPI encryption and are not filled back into the settings window as plaintext. Regular users do not need a `.env` file.
- Screenshots of up to three recent selections are kept in application memory for bubble corrections. Clearing results or quitting releases them. If an older screenshot has expired, select the region again.
- Legacy development `.env` files and installed-version `settings.env.txt` files can still be read. Saving through the new settings window does not delete those files; remove any plaintext keys before sharing them.

For details on local communication authentication and window isolation, see the [security boundaries in the development guide (Chinese)](docs/DEVELOPMENT.md#安全边界).

## FAQ

- **Why do the windows briefly disappear when I translate?** The app hides the toolbar, selection, and previous translations before capturing the screen, then restores them after capture processing. This keeps the UI out of the image used for OCR.
- **Does Enhance OCR change bubble positions?** No. It recognizes text within the existing boxes. It may improve the text, but it cannot fix an incorrectly detected bubble boundary.
- **Why can Page watch make scrolling less smooth?** It periodically captures and compares the selected region to detect page changes. Screen capture and image processing add overhead; slower captures may affect scrolling, although not every computer will show noticeable stutter. If reading feels sluggish, switch to **Fixed**, then manually clear old results and click **Translate region** after changing pages. Page watch requires Windows 10 version 2004 or later. It prompts you to translate the new page and does not automatically make paid translation requests.

## Development and feedback

[Development setup, builds, and tests (Chinese)](docs/DEVELOPMENT.md)

After changing code, run `npm run validate`. It checks the UI, backend, window security, native window movement, and responsiveness, but does not replace manual testing with real manga, paid translation services, or multiple monitors.
