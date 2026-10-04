# 🧩 豆包 URL 参数调用 (Raycast 友好)

> 通过 URL 参数一键调用 [豆包](https://www.doubao.com/)，自动填入提示词并发送。
> 兼容 **Raycast / Alfred / 浏览器书签** 等一切支持打开 URL 的场景。

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ 功能特性

- **URL 一键调用**：`?type=提示词类型&content=内容`，打开豆包网页即自动填入并发送
- **可视化配置**：右下角 ⚙ 按钮，弹窗内增删改查提示词模板，无需改代码
- **内置 4 种模板**：英文翻译、英文润色、内容总结、概念解释，开箱即用
- **自动发送**：填入后自动点击发送，可选关闭（只填不发送）
- **URL 自动清理**：发送后移除地址栏参数，避免刷新重复发送
- **适配新版输入框**：兼容豆包新版 ProseMirror/TipTap 富文本输入框，同时兼容旧版 textarea
- **Raycast / Alfred 友好**：配合快捷键 / 脚本调用 URL，秒开即用

---

## 📦 安装

1. 安装油猴脚本管理器（任选其一）：
   - [Tampermonkey](https://www.tampermonkey.net/)（推荐）
   - [Violentmonkey](https://violentmonkey.github.io/)
2. 打开 [doubao-helper.js](./doubao-helper.js)，点击 **Raw** 或复制全部代码
3. 油猴面板 → **新建脚本** → 粘贴代码 → **保存**（或直接拖入脚本文件）

> 脚本只在 `https://www.doubao.com/chat*` 下运行，不会影响其他网站。

---

## 🚀 快速开始

在浏览器地址栏打开以下 URL（`content` 建议做 **URL 编码**）：

```
https://www.doubao.com/chat/?type=translate&content=Hello%20world
```

豆包页面加载后会自动完成：**填入翻译提示词 → 点击发送**。

### 只填不发送

```
https://www.doubao.com/chat/?type=polish&content=your%20text%20here
```

配合配置面板关闭「自动发送」即可。

### 省略 type

未指定 `type` 时默认使用 `translate`：

```
https://www.doubao.com/chat/?content=some%20text
```

---

## 🧠 内置提示词类型

| type | 说明 | 提示词模板 |
|------|------|-----------|
| `translate` | 英文翻译 | 将英文翻译成中文，仅输出译文 |
| `polish` | 英文润色 | 润色文本使其更地道，并说明修改点 |
| `summarize` | 内容总结 | 用简洁中文总结核心要点（项目符号） |
| `explain` | 概念解释 | 用通俗易懂的中文解释内容 |

> 模板中的 `{content}` 会被替换为 URL 传入的内容，你可以在配置面板中随意增删改。

---

## ⚙️ 配置面板

点击豆包页面**右下角悬浮按钮 ⚙** 打开配置面板：

- **提示词模板管理**：新增 / 编辑 / 删除 / 重置模板
  - `type` 键名：仅允许字母、数字、下划线、短横线（如 `translate`）
  - 提示词必须包含 `{content}` 占位符
- **运行设置**：
  - `自动发送`：填入后是否自动点击发送
  - `发送后清理 URL 参数`：避免刷新重复发送
  - `显示右下角配置按钮`：是否显示 ⚙ 悬浮按钮
  - `发送延迟`：自动发送前的等待毫秒数（默认 300ms）
- **调用方式**：实时生成每个模板的可复制调用 URL

---

## 🔗 Raycast / Alfred 集成

### Raycast

添加一个 **Hotkey** 或 **Script Command**，内容为打开带参数的豆包 URL：

```bash
open "https://www.doubao.com/chat/?type=translate&content=Hello%20world"
```

配合 Raycast 的 **剪贴板变量** 可实现「选中文本 → 快捷键 → 翻译」：

```bash
open "https://www.doubao.com/chat/?type=translate&content=$(pbpaste | python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read()))')"
```

### Alfred

新建 **Universal Action / Hotkey**，用 bash 脚本：

```bash
open "https://www.doubao.com/chat/?type=summarize&content=$(pbpaste)"
```

> macOS 下 `pbpaste` 取剪贴板内容；Windows 可改用 PowerShell：
> `(Get-Clipboard)` 编码后拼接 URL 再 `Start-Process`。

---

## 🔖 浏览器书签

把下面的地址存为书签，选中文本粘贴到 `content` 后访问即可（也可配合收藏夹栏实现一键调用）：

```
https://www.doubao.com/chat/?type=translate&content=PASTE_TEXT_HERE
```

---

## 📖 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `type` | 否 | 提示词类型键名，省略时默认 `translate` |
| `content` | 是 | 要传递给豆包的内容，建议 URL 编码 |

未传 `content` 时会弹出 Toast 提示「缺少 content 参数」。

---

## 🧪 兼容性

- 豆包新版（ProseMirror/TipTap 富文本输入框）✅
- 豆包旧版（textarea 输入框）✅
- 自动发送失败时依次回退：点击发送按钮 → React `onSubmit` → 模拟 Enter 键

---

## ❓ 常见问题

**Q：打开 URL 后没有自动发送？**
检查配置面板中「自动发送」是否开启；若发送按钮未生效，脚本会自动回退其他方案，也可手动点击发送。

**Q：发送的内容会重复？**
「发送后清理 URL 参数」默认开启，刷新页面不会重复发送。

**Q：自定义模板不见了？**
模板保存在油猴本地存储中，卸载脚本或清除站点数据会丢失；内置模板在配置面板中可一键「重置为默认」。

---

## 📝 更新日志

### v2.0.0

- 适配豆包新版 ProseMirror/TipTap 输入框
- 重写内容写入与发送逻辑，多层回退保证可靠性
- 新增可视化配置面板（模板管理 + 运行设置）
- 新增 Toast 提示反馈

---

## 📄 License

[MIT](./LICENSE)

## 🙏 致谢

感谢 [豆包](https://www.doubao.com/) 提供优质 AI 服务。
