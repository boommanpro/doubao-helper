// ==UserScript==
// @name         豆包 URL 参数调用 (Raycast 友好)
// @namespace    https://www.doubao.com/
// @version      2.0.0
// @description  通过 URL 参数 type 和 content 调用豆包，支持页面可视化配置提示词模板。type 为提示词类型（可在页面弹窗中配置），content 为传递的内容。兼容 Raycast / Alfred / 浏览器书签等 URL 调用方式。v2.0 适配豆包新版 ProseMirror/TipTap 输入框。
// @author       boommanpro
// @match        https://www.doubao.com/chat*
// @match        https://www.doubao.com/chat/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    /* ====================== 配置存储 ====================== */
    const STORAGE_KEY = 'doubao_url_prompt_templates';
    const SETTINGS_KEY = 'doubao_url_prompt_settings';

    // 默认提示词模板：{type: {label, prompt}}，prompt 中 {content} 会被替换为实际内容
    const DEFAULT_TEMPLATES = {
        translate: {
            label: '英文翻译',
            prompt: '请将以下英文翻译成中文，仅输出译文，不要附加任何解释：\n\n{content}'
        },
        polish: {
            label: '英文润色',
            prompt: '请润色以下英文文本，使其更地道自然，并简要说明修改点：\n\n{content}'
        },
        summarize: {
            label: '内容总结',
            prompt: '请用简洁的中文总结以下内容的核心要点（用项目符号列出）：\n\n{content}'
        },
        explain: {
            label: '概念解释',
            prompt: '请用通俗易懂的中文解释以下内容：\n\n{content}'
        }
    };

    const DEFAULT_SETTINGS = {
        autoSend: true,        // 组装好提示词后是否自动点击发送
        cleanUrl: true,        // 发送后是否清理 URL 参数（避免刷新重复发送）
        sendDelay: 300,        // 自动发送前等待毫秒数（确保 input 事件被 React 处理）
        showConfigButton: true // 显示右下角配置按钮
    };

    function loadTemplates() {
        const stored = GM_getValue(STORAGE_KEY, null);
        if (!stored || typeof stored !== 'object') {
            GM_setValue(STORAGE_KEY, DEFAULT_TEMPLATES);
            return JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
        }
        // 合并默认模板（保证 translate 等内置类型始终存在）
        const merged = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
        for (const k of Object.keys(stored)) {
            merged[k] = stored[k];
        }
        return merged;
    }

    function saveTemplates(tpls) {
        GM_setValue(STORAGE_KEY, tpls);
    }

    function loadSettings() {
        const s = GM_getValue(SETTINGS_KEY, null);
        return Object.assign({}, DEFAULT_SETTINGS, s && typeof s === 'object' ? s : {});
    }

    function saveSettings(s) {
        GM_setValue(SETTINGS_KEY, s);
    }

    /* ====================== URL 参数解析 ====================== */
    // 在脚本启动时（document-start）立即捕获原始 URL 参数，
    // 因为豆包 SPA 路由会在加载后重定向到 /chat/{id}，清除 query string。
    const RAW_PARAMS = (() => {
        try {
            const u = new URL(location.href);
            return {
                type: (u.searchParams.get('type') || '').trim(),
                content: (u.searchParams.get('content') || '').trim()
            };
        } catch (e) {
            return { type: '', content: '' };
        }
    })();

    function getParams() {
        return RAW_PARAMS;
    }

    function cleanUrlParams() {
        const url = location.pathname + location.hash;
        history.replaceState({}, '', url);
    }

    /* ====================== 豆包输入框操作（适配新版 ProseMirror/TipTap） ====================== */
    // 新版豆包已不再使用 textarea，而是改成了 TipTap 富文本编辑器：
    //   输入框 = div.tiptap.ProseMirror[contenteditable]（位于 .guidance-input-content 内）
    //   发送按钮 = button#flow-end-msg-send（或 [data-testid="chat_input_send_button"]）
    // 为了兼容改版前后，以下定位同时兼容旧版 textarea.semi-input-textarea 与新版 ProseMirror。

    // 兼容旧版：textarea.semi-input-textarea
    function getTextarea() {
        return document.querySelector('textarea.semi-input-textarea');
    }

    // 新版：返回可见的 ProseMirror 编辑器
    function getEditor() {
        const all = Array.from(document.querySelectorAll('.ProseMirror'))
            .filter(el => el.isContentEditable || el.getAttribute('contenteditable') === 'true');
        if (!all.length) return null;
        // 优先返回输入区容器内的编辑器
        for (const el of all) {
            if (el.closest('.guidance-input-content')) return el;
        }
        // 其次返回第一个可见的编辑器
        for (const el of all) {
            const r = el.getBoundingClientRect();
            if (r.width > 50 && r.height > 20) return el;
        }
        return all[0];
    }

    // 统一的"输入框"入口：旧版 textarea 优先，否则用新版编辑器
    function getInput() {
        return getTextarea() || getEditor();
    }

    // 判断内容是否已经真正进入编辑器状态：
    // TipTap 的 MutationObserver 是异步同步 DOM → state 的，
    // 刚写入后 state 可能为空，必须等它同步完再发送。
    function editorSynced(expectedText) {
        const ed = getEditor();
        if (!ed) return false;
        const domText = (ed.innerText || '').trim();
        if (!domText) return false;
        // 有 TipTap 实例时以 state 为准
        if (ed.editor && ed.editor.state && ed.editor.state.doc) {
            const stateText = ed.editor.state.doc.textContent || '';
            if (!stateText) return false;
            if (expectedText != null) {
                // 允许 TipTap 对换行做规范化处理，比较时忽略空白差异
                const norm = s => s.replace(/\s+/g, '');
                return norm(stateText) === norm(expectedText);
            }
            return true;
        }
        // 没有 editor 实例（如旧版 textarea）时，检查 DOM
        if (expectedText != null) {
            return domText.includes(expectedText) || domText === expectedText;
        }
        return true;
    }

    // 向输入框写入内容（旧版 textarea / 新版 ProseMirror 通用）
    // 新版关键：必须在聚焦的 ProseMirror 上用 execCommand('insertText') 写入，
    // 它会触发真实的 beforeinput/input 事件，TipTap 才能同步内部 state 并驱动发送按钮/发送逻辑。
    function setInputValue(text) {
        const ta = getTextarea();
        if (ta) {
            // ---- 旧版 textarea：native setter + input 事件 ----
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(ta, '');
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.focus();
            ta.click();
            try { ta.setSelectionRange(0, 0); } catch (e) { /* ignore */ }
            let inserted = false;
            try { inserted = document.execCommand('insertText', false, text); } catch (e) { inserted = false; }
            if (!inserted || ta.value !== text) {
                setter.call(ta, text);
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return ta.value === text;
        }

        // ---- 新版 ProseMirror ----
        const ed = getEditor();
        if (!ed) return false;
        ed.focus();
        try { ed.click(); } catch (e) { /* ignore */ }

        // 全选编辑器内容后插入文本
        const sel = window.getSelection();
        const range = document.createRange();
        try {
            range.selectNodeContents(ed);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) { /* ignore */ }

        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }

        if (!ok) {
            // 兜底：直接操作 TipTap 实例或 DOM，并派发 input 事件
            try {
                if (ed.editor && ed.editor.commands && typeof ed.editor.commands.setContent === 'function') {
                    ed.editor.commands.setContent(text);
                } else {
                    ed.innerHTML = '';
                    const p = document.createElement('p');
                    p.textContent = text;
                    ed.appendChild(p);
                }
                ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
                ed.dispatchEvent(new Event('change', { bubbles: true }));
                ok = true;
            } catch (e) {
                ok = false;
            }
        }
        return ok;
    }

    // 查找发送按钮：
    //   新版 1：#flow-end-msg-send（稳定 id）
    //   新版 2：[data-testid="chat_input_send_button"]
    //   新版 3：输入区内 SVG path 以 "M4.93934" 开头的圆形发送按钮
    //   旧版  ：button[type="submit"] 且 SVG path 以 "M12.0005" 开头（向上箭头）
    function findSendButton() {
        const byId = document.querySelector('#flow-end-msg-send');
        if (byId) return byId;
        const byTestId = document.querySelector('[data-testid="chat_input_send_button"]');
        if (byTestId) return byTestId;
        const composerBtns = document.querySelectorAll('.guidance-input-content button');
        for (const b of composerBtns) {
            const path = b.querySelector('svg path');
            if (path && (path.getAttribute('d') || '').startsWith('M4.93934')) return b;
        }
        const all = document.querySelectorAll('button[type="submit"]');
        for (const b of all) {
            const path = b.querySelector('svg path');
            if (path && (path.getAttribute('d') || '').startsWith('M12.0005')) return b;
        }
        return all[all.length - 1] || null;
    }

    // 通过 React fiber 找到豆包真正的发送函数 onSubmit（轻量兜底）
    // 直接调用它最可靠，不受 isTrusted 检查、事件委托等影响。
    function findReactOnSubmit() {
        const input = getInput();
        if (!input) return null;
        const fiberKey = Object.keys(input).find(k => k.startsWith('__reactFiber'));
        if (!fiberKey) return null;
        let fiber = input[fiberKey];
        let depth = 0;
        while (fiber && depth < 40) {
            const props = fiber.memoizedProps || (fiber.stateNode && fiber.stateNode.props);
            if (props && typeof props === 'object' &&
                typeof props.onSubmit === 'function' &&
                'allowEmptySubmit' in props) {
                return { onSubmit: props.onSubmit, hasAllowEmpty: props.allowEmptySubmit };
            }
            fiber = fiber.return;
            depth++;
        }
        fiber = input[fiberKey];
        depth = 0;
        while (fiber && depth < 40) {
            const props = fiber.memoizedProps || (fiber.stateNode && fiber.stateNode.props);
            if (props && typeof props === 'object' && typeof props.onSubmit === 'function') {
                return { onSubmit: props.onSubmit, hasAllowEmpty: null };
            }
            fiber = fiber.return;
            depth++;
        }
        return null;
    }

    // 兜底1：直接调用豆包组件的 onSubmit 函数
    function sendViaReactOnSubmit() {
        try {
            const handler = findReactOnSubmit();
            if (!handler || typeof handler.onSubmit !== 'function') return false;
            const input = getInput();
            input && input.focus();
            handler.onSubmit();
            return true;
        } catch (e) {
            console.warn('[豆包URL调用] React onSubmit 调用失败:', e);
            return false;
        }
    }

    // 兜底2：模拟 Enter 键（新版 TipTap 一般不响应合成事件，仅作最后手段）
    function sendViaEnter() {
        const input = getInput();
        if (!input) return false;
        input.focus();
        const opts = {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
            isComposing: false, shiftKey: false, altKey: false,
            ctrlKey: false, metaKey: false
        };
        input.dispatchEvent(new KeyboardEvent('keydown', opts));
        input.dispatchEvent(new KeyboardEvent('keyup', opts));
        return true;
    }

    // 主发送方案：点击发送按钮（新版最可靠）
    function clickSendButton() {
        const btn = findSendButton();
        if (!btn || btn.disabled) return false;
        try {
            btn.click();
        } catch (e) {
            // 兜底：派发完整鼠标事件序列
            try {
                const rect = btn.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                const popts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 };
                btn.dispatchEvent(new PointerEvent('pointerdown', popts));
                btn.dispatchEvent(new MouseEvent('mousedown', popts));
                btn.dispatchEvent(new PointerEvent('pointerup', popts));
                btn.dispatchEvent(new MouseEvent('mouseup', popts));
                btn.dispatchEvent(new MouseEvent('click', popts));
            } catch (e2) {
                return false;
            }
        }
        return true;
    }

    // 判断输入框是否已清空（发送成功后 ProseMirror 会重置为空的 <p>）
    function inputIsEmpty() {
        const ta = getTextarea();
        if (ta) return ta.value === '';
        const ed = getEditor();
        if (!ed) return true;
        return (ed.innerText || '').trim() === '';
    }

    function send() {
        // 优先：点击发送按钮（新版 UI 已验证最可靠）
        if (clickSendButton()) return true;
        // 兜底1：直接调用 React onSubmit
        if (sendViaReactOnSubmit()) return true;
        // 兜底2：模拟 Enter 键
        return sendViaEnter();
    }

    /* ====================== 等待元素出现 ====================== */
    function waitForInput(timeout = 20000) {
        return new Promise((resolve) => {
            const start = Date.now();
            const check = () => {
                const input = getInput();
                if (input) return resolve(input);
                if (Date.now() - start > timeout) return resolve(null);
                setTimeout(check, 300);
            };
            check();
        });
    }

    // 等待编辑器内容同步到 TipTap state（异步 MutationObserver），并确认发送按钮可用
    async function waitEditorReady(expectedText, timeout = 4000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const btn = findSendButton();
            if (btn && !btn.disabled && editorSynced(expectedText)) return true;
            await sleep(150);
        }
        return false;
    }

    /* ====================== 主流程：处理 URL 调用 ====================== */
    async function handleUrlCall() {
        const { type, content } = getParams();
        if (!type && !content) return; // 无参数，不处理

        // 只有 content 没有 type 时，默认用 translate
        const effectiveType = type || 'translate';
        if (!content) {
            console.warn('[豆包URL调用] 缺少 content 参数');
            showToast('缺少 content 参数', 'warn');
            return;
        }

        const templates = loadTemplates();
        const tpl = templates[effectiveType];
        if (!tpl) {
            console.warn(`[豆包URL调用] 未找到类型 "${effectiveType}"，可用类型:`, Object.keys(templates));
            showToast(`未找到提示词类型: ${effectiveType}`, 'error');
            return;
        }

        const finalPrompt = tpl.prompt.replace(/\{content\}/g, content);
        const settings = loadSettings();

        const input = await waitForInput();
        if (!input) {
            console.error('[豆包URL调用] 未找到输入框');
            showToast('未找到输入框', 'error');
            return;
        }

        // 等待输入框可用（有时刚加载会被禁用）
        await sleep(300);
        input.focus();
        let writeOk = setInputValue(finalPrompt);
        // 确认写入成功，最多重试 3 次
        for (let i = 0; i < 3 && !writeOk; i++) {
            await sleep(200);
            writeOk = setInputValue(finalPrompt);
        }
        if (!writeOk) {
            console.error('[豆包URL调用] 写入输入框失败');
            showToast('写入输入框失败', 'error');
            return;
        }

        showToast(`已填入 [${tpl.label || effectiveType}]${settings.autoSend ? '，正在发送...' : ''}`, 'info');

        if (settings.autoSend) {
            await sleep(settings.sendDelay);
            // 等待 TipTap 异步同步内容到内部 state，并确认发送按钮可用
            let ready = await waitEditorReady(finalPrompt, 5000);
            if (!ready) {
                // 首次写入后状态未同步（页面可能仍在初始化）：重新写入一次再等
                console.warn('[豆包URL调用] 内容未同步，重新写入一次');
                setInputValue(finalPrompt);
                ready = await waitEditorReady(finalPrompt, 6000);
            }
            let sent = false;
            if (ready) {
                clickSendButton();
                // 验证是否发送成功：输入框应在数秒内清空
                for (let i = 0; i < 8; i++) {
                    await sleep(300);
                    if (inputIsEmpty()) { sent = true; break; }
                }
            }
            if (!sent) {
                // 回退1：尝试直接调用 React onSubmit
                console.warn('[豆包URL调用] 发送按钮未生效，尝试 React onSubmit');
                if (sendViaReactOnSubmit()) {
                    await sleep(800);
                    sent = inputIsEmpty();
                }
            }
            if (!sent) {
                // 回退2：模拟 Enter 键
                console.warn('[豆包URL调用] onSubmit 未生效，尝试 Enter 键');
                sendViaEnter();
                await sleep(600);
                sent = inputIsEmpty();
            }
            if (!sent) {
                console.warn('[豆包URL调用] 自动发送未成功，请手动发送');
                showToast('自动发送未成功，请手动点击发送', 'warn');
            }
        } else {
            showToast('已填入输入框（自动发送已关闭）', 'info');
        }

        if (settings.cleanUrl) {
            // 延迟清理（豆包会重定向到 /chat/{id}，2 秒后兜底清理残留参数）
            setTimeout(() => {
                const u = new URL(location.href);
                if (u.searchParams.get('type') || u.searchParams.get('content')) {
                    cleanUrlParams();
                }
            }, 2000);
        }
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    /* ====================== Toast 提示 ====================== */
    function showToast(msg, type = 'info') {
        const colors = {
            info: '#3b82f6',
            success: '#22c55e',
            warn: '#f59e0b',
            error: '#ef4444'
        };
        const el = document.createElement('div');
        el.className = 'dbx-toast';
        el.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: ${colors[type] || colors.info}; color: #fff;
            padding: 10px 18px; border-radius: 8px; font-size: 14px;
            z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            opacity: 0; transition: opacity 0.25s; font-family: -apple-system, sans-serif;
        `;
        el.textContent = msg;
        document.body.appendChild(el);
        requestAnimationFrame(() => { el.style.opacity = '1'; });
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }, 2500);
    }

    /* ====================== 配置面板 UI ====================== */
    GM_addStyle(`
        .dbx-config-fab {
            position: fixed; right: 24px; bottom: 96px; z-index: 999998;
            width: 44px; height: 44px; border-radius: 50%;
            background: #6366f1; color: #fff; border: none; cursor: pointer;
            box-shadow: 0 4px 12px rgba(99,102,241,0.4);
            display: flex; align-items: center; justify-content: center;
            font-size: 20px; transition: transform 0.2s, background 0.2s;
        }
        .dbx-config-fab:hover { transform: scale(1.1); background: #4f46e5; }
        .dbx-mask {
            position: fixed; inset: 0; z-index: 999999;
            background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;
            font-family: -apple-system, "PingFang SC", sans-serif;
        }
        .dbx-modal {
            background: #fff; border-radius: 12px; width: 640px; max-width: 92vw;
            max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .dbx-modal-header {
            padding: 16px 20px; border-bottom: 1px solid #eee; font-size: 16px;
            font-weight: 600; color: #111; display: flex; justify-content: space-between; align-items: center;
        }
        .dbx-modal-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #999; line-height: 1; }
        .dbx-modal-close:hover { color: #333; }
        .dbx-modal-body { padding: 16px 20px; overflow-y: auto; flex: 1; }
        .dbx-section-title { font-size: 13px; color: #666; margin: 12px 0 8px; font-weight: 600; }
        .dbx-tpl-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
        .dbx-tpl-item {
            border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px;
            display: flex; flex-direction: column; gap: 6px; background: #fafafa;
        }
        .dbx-tpl-row { display: flex; gap: 8px; align-items: center; }
        .dbx-tpl-key {
            font-family: monospace; font-size: 12px; background: #eef2ff; color: #4338ca;
            padding: 2px 8px; border-radius: 4px; font-weight: 600;
        }
        .dbx-tpl-label { font-size: 13px; color: #333; flex: 1; }
        .dbx-tpl-actions { display: flex; gap: 6px; }
        .dbx-btn {
            border: 1px solid #ddd; background: #fff; border-radius: 6px;
            padding: 4px 10px; font-size: 12px; cursor: pointer; color: #333;
        }
        .dbx-btn:hover { background: #f3f4f6; }
        .dbx-btn-danger { color: #dc2626; border-color: #fecaca; }
        .dbx-btn-danger:hover { background: #fef2f2; }
        .dbx-btn-primary { background: #6366f1; color: #fff; border-color: #6366f1; }
        .dbx-btn-primary:hover { background: #4f46e5; }
        .dbx-tpl-prompt {
            font-size: 12px; color: #666; font-family: monospace; white-space: pre-wrap;
            background: #fff; padding: 6px 8px; border-radius: 4px; border: 1px solid #eee;
            max-height: 60px; overflow-y: auto;
        }
        .dbx-form { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px dashed #d1d5db; border-radius: 8px; margin-top: 8px; background: #fff; }
        .dbx-form-row { display: flex; gap: 8px; }
        .dbx-form input, .dbx-form textarea {
            border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; font-size: 13px;
            font-family: inherit;
        }
        .dbx-form input { width: 140px; }
        .dbx-form textarea { width: 100%; min-height: 60px; font-family: monospace; resize: vertical; }
        .dbx-form input:focus, .dbx-form textarea:focus { outline: none; border-color: #6366f1; }
        .dbx-settings-row { display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-top: 1px solid #eee; }
        .dbx-setting-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #333; }
        .dbx-setting-item input[type="checkbox"] { width: 16px; height: 16px; }
        .dbx-setting-item input[type="number"] { width: 80px; }
        .dbx-hint { font-size: 11px; color: #999; margin-top: 4px; line-height: 1.5; }
        .dbx-url-preview {
            font-family: monospace; font-size: 11px; background: #f9fafb; border: 1px solid #eee;
            padding: 8px; border-radius: 6px; color: #555; word-break: break-all; margin-top: 8px;
        }
        .dbx-modal-footer {
            padding: 12px 20px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;
        }
        .dbx-call-url {
            font-family: monospace; font-size: 11px; color: #4338ca; background: #eef2ff;
            padding: 4px 8px; border-radius: 4px; word-break: break-all; cursor: pointer;
        }
    `);

    function openConfigPanel() {
        // 移除已存在
        document.querySelector('.dbx-mask')?.remove();

        const templates = loadTemplates();
        const settings = loadSettings();

        const mask = document.createElement('div');
        mask.className = 'dbx-mask';

        const modal = document.createElement('div');
        modal.className = 'dbx-modal';

        modal.innerHTML = `
            <div class="dbx-modal-header">
                <span>豆包 URL 调用配置</span>
                <button class="dbx-modal-close" data-act="close">×</button>
            </div>
            <div class="dbx-modal-body">
                <div class="dbx-section-title">提示词模板（type 与 prompt 模板，{content} 会被替换为传入内容）</div>
                <div class="dbx-tpl-list" id="dbx-tpl-list"></div>

                <div class="dbx-section-title">新增 / 编辑模板</div>
                <div class="dbx-form" id="dbx-form">
                    <div class="dbx-form-row">
                        <input id="dbx-f-key" placeholder="type 键名（如 translate）" />
                        <input id="dbx-f-label" placeholder="显示名称（如 英文翻译）" style="flex:1" />
                    </div>
                    <textarea id="dbx-f-prompt" placeholder="提示词模板，必须包含 {content}，例如：&#10;请将以下英文翻译成中文：&#10;&#10;{content}"></textarea>
                    <div class="dbx-form-row">
                        <button class="dbx-btn dbx-btn-primary" data-act="save">保存模板</button>
                        <button class="dbx-btn" data-act="reset">重置为默认</button>
                    </div>
                </div>

                <div class="dbx-settings-row">
                    <div class="dbx-section-title" style="margin-top:0">运行设置</div>
                    <label class="dbx-setting-item">
                        <input type="checkbox" id="dbx-s-auto" ${settings.autoSend ? 'checked' : ''}/>
                        自动发送（填入后自动点击发送按钮）
                    </label>
                    <label class="dbx-setting-item">
                        <input type="checkbox" id="dbx-s-clean" ${settings.cleanUrl ? 'checked' : ''}/>
                        发送后清理 URL 参数（避免刷新重复发送）
                    </label>
                    <label class="dbx-setting-item">
                        <input type="checkbox" id="dbx-s-showfab" ${settings.showConfigButton ? 'checked' : ''}/>
                        显示右下角配置按钮
                    </label>
                    <label class="dbx-setting-item">
                        发送延迟
                        <input type="number" id="dbx-s-delay" value="${settings.sendDelay}" min="0" step="100"/>
                        毫秒
                    </label>
                </div>

                <div class="dbx-section-title">调用方式</div>
                <div class="dbx-hint">
                    通过 URL 传递参数：<code>?type=类型&amp;content=内容</code>。content 建议 URL 编码。
                </div>
                <div class="dbx-url-preview" id="dbx-url-preview"></div>
            </div>
            <div class="dbx-modal-footer">
                <span class="dbx-hint">点击预览 URL 可复制</span>
                <button class="dbx-btn dbx-btn-primary" data-act="close">完成</button>
            </div>
        `;

        mask.appendChild(modal);
        document.body.appendChild(mask);

        const listEl = modal.querySelector('#dbx-tpl-list');
        const previewEl = modal.querySelector('#dbx-url-preview');

        function renderList() {
            const tpls = loadTemplates();
            listEl.innerHTML = '';
            for (const key of Object.keys(tpls)) {
                const t = tpls[key];
                const item = document.createElement('div');
                item.className = 'dbx-tpl-item';
                const hasContent = t.prompt.includes('{content}');
                item.innerHTML = `
                    <div class="dbx-tpl-row">
                        <span class="dbx-tpl-key">${escapeHtml(key)}</span>
                        <span class="dbx-tpl-label">${escapeHtml(t.label || '')}</span>
                        <div class="dbx-tpl-actions">
                            <button class="dbx-btn" data-edit="${escapeHtml(key)}">编辑</button>
                            <button class="dbx-btn dbx-btn-danger" data-del="${escapeHtml(key)}">删除</button>
                        </div>
                    </div>
                    <div class="dbx-tpl-prompt">${escapeHtml(t.prompt)}${hasContent ? '' : '<span style="color:#dc2626"> ⚠ 缺少 {content}</span>'}</div>
                `;
                listEl.appendChild(item);
            }
            updatePreview();
        }

        function updatePreview() {
            const tpls = loadTemplates();
            const sample = encodeURIComponent('hello world');
            const lines = Object.keys(tpls).map(k =>
                `https://www.doubao.com/chat/?type=${encodeURIComponent(k)}&content=${sample}`
            );
            previewEl.innerHTML = lines.map(l => `<div class="dbx-call-url" data-url="${escapeHtml(l)}">${escapeHtml(l)}</div>`).join('');
        }

        function escapeHtml(s) {
            return String(s).replace(/[&<>"']/g, c => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            }[c]));
        }

        // 事件委托
        modal.addEventListener('click', async (e) => {
            const act = e.target.dataset.act;
            const editKey = e.target.dataset.edit;
            const delKey = e.target.dataset.del;
            const url = e.target.dataset.url;

            if (act === 'close' || e.target === mask) {
                mask.remove();
                return;
            }
            if (delKey) {
                if (!confirm(`确认删除模板 "${delKey}"？`)) return;
                const tpls = loadTemplates();
                if (DEFAULT_TEMPLATES[delKey]) {
                    if (!confirm(`"${delKey}" 是内置模板，删除后将无法恢复内置默认值。继续？`)) return;
                }
                delete tpls[delKey];
                saveTemplates(tpls);
                renderList();
                showToast('已删除', 'success');
                return;
            }
            if (editKey) {
                const tpls = loadTemplates();
                const t = tpls[editKey];
                modal.querySelector('#dbx-f-key').value = editKey;
                modal.querySelector('#dbx-f-label').value = t.label || '';
                modal.querySelector('#dbx-f-prompt').value = t.prompt;
                return;
            }
            if (act === 'save') {
                const key = modal.querySelector('#dbx-f-key').value.trim();
                const label = modal.querySelector('#dbx-f-label').value.trim();
                const prompt = modal.querySelector('#dbx-f-prompt').value;
                if (!key) { showToast('请填写 type 键名', 'error'); return; }
                if (!/^[a-zA-Z0-9_-]+$/.test(key)) { showToast('键名只允许字母数字、下划线、短横线', 'error'); return; }
                if (!prompt.includes('{content}')) { showToast('提示词必须包含 {content}', 'error'); return; }
                const tpls = loadTemplates();
                tpls[key] = { label: label || key, prompt };
                saveTemplates(tpls);
                modal.querySelector('#dbx-f-key').value = '';
                modal.querySelector('#dbx-f-label').value = '';
                modal.querySelector('#dbx-f-prompt').value = '';
                renderList();
                showToast('已保存', 'success');
                return;
            }
            if (act === 'reset') {
                if (!confirm('重置所有模板为默认值？现有自定义模板将丢失。')) return;
                saveTemplates(JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)));
                renderList();
                showToast('已重置', 'success');
                return;
            }
            if (url) {
                try {
                    await navigator.clipboard.writeText(url);
                    showToast('URL 已复制', 'success');
                } catch {
                    showToast('复制失败，请手动选择', 'warn');
                }
            }
        });

        // 设置变更实时保存
        modal.querySelector('#dbx-s-auto').addEventListener('change', (e) => {
            const s = loadSettings(); s.autoSend = e.target.checked; saveSettings(s);
        });
        modal.querySelector('#dbx-s-clean').addEventListener('change', (e) => {
            const s = loadSettings(); s.cleanUrl = e.target.checked; saveSettings(s);
        });
        modal.querySelector('#dbx-s-showfab').addEventListener('change', (e) => {
            const s = loadSettings(); s.showConfigButton = e.target.checked; saveSettings(s);
            toggleFab(s.showConfigButton);
        });
        modal.querySelector('#dbx-s-delay').addEventListener('change', (e) => {
            const s = loadSettings(); s.sendDelay = Math.max(0, parseInt(e.target.value) || 0); saveSettings(s);
        });

        renderList();
    }

    function toggleFab(show) {
        let fab = document.querySelector('.dbx-config-fab');
        if (show) {
            if (!fab) {
                fab = document.createElement('button');
                fab.className = 'dbx-config-fab';
                fab.innerHTML = '⚙';
                fab.title = '豆包 URL 调用配置';
                fab.addEventListener('click', openConfigPanel);
                document.body.appendChild(fab);
            }
            fab.style.display = 'flex';
        } else if (fab) {
            fab.style.display = 'none';
        }
    }

    /* ====================== 启动 ====================== */
    function init() {
        const settings = loadSettings();
        toggleFab(settings.showConfigButton);

        // 处理 URL 调用
        handleUrlCall();
    }

    // 等待 DOM 就绪后启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
