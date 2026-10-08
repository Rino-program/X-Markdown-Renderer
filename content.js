(() => {
  'use strict';

  const TWEET_SEL = '[data-testid="tweetText"]';
  const settings = { enabled: true, forceAll: false };
  const showRaw = new WeakMap();
  const tweetButtons = new WeakMap();
  const tweetRoots = new WeakMap();

  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  const addText = (parent, s) => {
    s.split('\n').forEach((p, i) => {
      if (i > 0) parent.appendChild(document.createElement('br'));
      if (p) parent.appendChild(document.createTextNode(p));
    });
  };

  /* ---------- インライン ---------- */

  const INLINE_RE = new RegExp(
    [
      '\\\\(?<esc>[\\\\`*_{}\\[\\]()#+\\-.!~>|])',
      '(?<fence>`+)(?<code>[\\s\\S]*?[^`])\\k<fence>(?!`)',
      '\\[(?<ltext>[^\\]\\n]+)\\]\\((?<lurl>https?:\\/\\/[^\\s)]+)\\)',
      '\\*\\*(?=\\S)(?<b1>[\\s\\S]*?\\S)\\*\\*',
      '__(?=\\S)(?<b2>[\\s\\S]*?\\S)__',
      '~~(?=\\S)(?<del>[\\s\\S]*?\\S)~~',
      '\\*(?=[^\\s*])(?<i1>[^*\\n]*?[^\\s*])\\*',
      '(?<!\\w)_(?=[^\\s_])(?<i2>[^_\\n]*?[^\\s_])_(?!\\w)',
      "(?<url>https?:\\/\\/[\\w\\-._~:/?#\\[\\]@!$&'*+,;=%]+)",
      '(?<![\\w@])(?<mention>@\\w{1,15})(?!\\w)',
      '(?<![\\w&])(?<tag>#[\\p{L}\\p{N}_]+)',
    ].join('|'),
    'gu'
  );

  function makeLink(href, label) {
    const a = el('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    if (label instanceof Node) a.appendChild(label);
    else a.textContent = label;
    return a;
  }

  function inline(text, parent) {
    let last = 0, m;
    const re = new RegExp(INLINE_RE.source, INLINE_RE.flags);
    while ((m = re.exec(text))) {
      if (m.index > last) addText(parent, text.slice(last, m.index));
      last = re.lastIndex;
      const g = m.groups;
      if (g.esc !== undefined) parent.appendChild(document.createTextNode(g.esc));
      else if (g.code !== undefined) {
        const c = el('code'); c.textContent = g.code.replace(/\n/g, ' ').trim(); parent.appendChild(c);
      } else if (g.ltext !== undefined) {
        const a = makeLink(g.lurl, ''); inline(g.ltext, a); parent.appendChild(a);
      } else if (g.b1 !== undefined || g.b2 !== undefined) {
        const s = el('strong'); inline(g.b1 ?? g.b2, s); parent.appendChild(s);
      } else if (g.del !== undefined) {
        const d = el('del'); inline(g.del, d); parent.appendChild(d);
      } else if (g.i1 !== undefined || g.i2 !== undefined) {
        const i = el('em'); inline(g.i1 ?? g.i2, i); parent.appendChild(i);
      } else if (g.url !== undefined) {
        let url = g.url, tail = '';
        while (/[.,;:!?'*]$/.test(url)) { tail = url.slice(-1) + tail; url = url.slice(0, -1); }
        parent.appendChild(makeLink(url, url));
        if (tail) parent.appendChild(document.createTextNode(tail));
      } else if (g.mention !== undefined) {
        parent.appendChild(makeLink('https://x.com/' + g.mention.slice(1), g.mention));
      } else if (g.tag !== undefined) {
        parent.appendChild(makeLink('https://x.com/hashtag/' + encodeURIComponent(g.tag.slice(1)), g.tag));
      }
    }
    if (last < text.length) addText(parent, text.slice(last));
  }

  /* ---------- ブロック ---------- */

  const RE_FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  const RE_QUOTE = /^\s{0,3}>\s?/;
  const RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const RE_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

  const splitRow = (line) => {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  };

  const isTableStart = (lines, i) =>
    i + 1 < lines.length && lines[i].includes('|') && lines[i + 1].includes('-') &&
    RE_TABLE_SEP.test(lines[i + 1]) && splitRow(lines[i]).length >= 2;

  const isBlockStart = (lines, i) =>
    RE_FENCE.test(lines[i]) || RE_HEADING.test(lines[i]) || RE_HR.test(lines[i]) ||
    RE_QUOTE.test(lines[i]) || RE_LIST.test(lines[i]) || isTableStart(lines, i);

  function buildList(items, parent) {
    const stack = [];
    for (const it of items) {
      while (stack.length && it.indent < stack[stack.length - 1].indent) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || it.indent > top.indent) {
        const list = el(it.ordered ? 'ol' : 'ul');
        if (it.ordered && it.start !== 1) list.start = it.start;
        (top && top.lastLi ? top.lastLi : parent).appendChild(list);
        top = { indent: it.indent, list, lastLi: null };
        stack.push(top);
      }
      const li = el('li');
      let body = it.text;
      const task = body.match(/^\[([ xX])\]\s+/);
      if (task) {
        li.className = 'xmd-task';
        const cb = el('input'); cb.type = 'checkbox'; cb.disabled = true; cb.checked = task[1] !== ' ';
        li.appendChild(cb);
        body = body.slice(task[0].length);
      }
      inline(body, li);
      top.list.appendChild(li);
      top.lastLi = li;
    }
  }

  function blocks(lines, parent) {
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if ((m = line.match(RE_FENCE))) {
        const fence = m[1], buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        const pre = el('pre'), code = el('code');
        code.textContent = buf.join('\n');
        pre.appendChild(code);
        parent.appendChild(pre);
      } else if ((m = line.match(RE_HEADING))) {
        const h = el('h' + m[1].length);
        inline(m[2], h);
        parent.appendChild(h);
        i++;
      } else if (RE_HR.test(line)) {
        parent.appendChild(el('hr'));
        i++;
      } else if (RE_QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) buf.push(lines[i++].replace(RE_QUOTE, ''));
        const bq = el('blockquote');
        blocks(buf, bq);
        parent.appendChild(bq);
      } else if (RE_LIST.test(line)) {
        const items = [];
        while (i < lines.length) {
          const lm = lines[i].match(RE_LIST);
          if (lm) {
            const ord = /\d/.test(lm[2]);
            items.push({ indent: lm[1].replace(/\t/g, '    ').length, ordered: ord, start: ord ? parseInt(lm[2], 10) : 1, text: lm[3] });
            i++;
          } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length && !isBlockStart(lines, i)) {
            items[items.length - 1].text += '\n' + lines[i].trim();
            i++;
          } else break;
        }
        buildList(items, parent);
      } else if (isTableStart(lines, i)) {
        const head = splitRow(lines[i]);
        const aligns = splitRow(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
        i += 2;
        const wrap = el('div', 'xmd-table-wrap'), table = el('table'), thead = el('thead'), trh = el('tr');
        head.forEach((c, k) => { const th = el('th'); if (aligns[k]) th.style.textAlign = aligns[k]; inline(c, th); trh.appendChild(th); });
        thead.appendChild(trh); table.appendChild(thead);
        const tbody = el('tbody');
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const tr = el('tr'), cells = splitRow(lines[i]);
          head.forEach((_, k) => { const td = el('td'); if (aligns[k]) td.style.textAlign = aligns[k]; inline(cells[k] ?? '', td); tr.appendChild(td); });
          tbody.appendChild(tr); i++;
        }
        table.appendChild(tbody); wrap.appendChild(table); parent.appendChild(wrap);
      } else {
        const buf = [line];
        i++;
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines, i)) buf.push(lines[i++]);
        const p = el('p');
        inline(buf.join('\n'), p);
        parent.appendChild(p);
      }
    }
  }

  function renderMarkdown(src) {
    const root = el('div', 'xmd-root');
    blocks(src.replace(/\r\n?/g, '\n').split('\n'), root);
    return root;
  }

  /* ---------- Markdown判定 ---------- */

  const MD_HINTS = [
    /^\s{0,3}#{1,6}\s+\S/m, /^\s*(```|~~~)/m, /\*\*[^\s*][^*]*\*\*/, /~~[^\s~][^~]*~~/,
    /\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/, /^\s*[-*+]\s+\S/m, /^\s*\d+[.)]\s+\S/m,
    /^\s{0,3}>\s?\S/m, /`[^`\n]+`/, /^\s*\|.+\|\s*$/m, /^\s{0,3}([-*_])(\s*\1){2,}\s*$/m,
  ];
  const looksLikeMarkdown = (text) => MD_HINTS.some((re) => re.test(text));

  function extractText(node) {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) out += c.data;
      else if (c.nodeType === Node.ELEMENT_NODE) {
        if (c.tagName === 'IMG') out += c.alt || '';
        else if (c.tagName === 'BR') out += '\n';
        else if (c.tagName === 'A') {
          const t = c.getAttribute('title') || '';
          out += /^https?:\/\//.test(t) ? t : c.textContent.replace(/…$/, '');
        } else out += extractText(c);
      }
    }
    return out;
  }

  /* ---------- 判定ヘルパー ---------- */

  // 本物の投稿入力欄（コンポーザー）の中だけを除外（詳細画面などは除外しない）
  function isInsideComposer(tweet) {
    return Boolean(
      tweet.closest('[data-testid="tweetTextarea_0"]') ||
      tweet.closest('[data-testid="tweetTextarea_0_label"]') ||
      tweet.closest('div[data-testid="Drafts"]')
    );
  }

  // 引用ポストの中にいるかどうかの判定
  function isInsideQuote(tweet) {
    let cur = tweet.parentElement;
    while (cur && cur.tagName !== 'ARTICLE' && cur !== document.body) {
      if (cur.getAttribute('role') === 'link' || cur.dataset.testid === 'quoteTweet') {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  // 画面の種類（タイムライン・詳細・スレッド等）を問わずコンテナを取得
  function getPostContainer(tweet) {
    return (
      tweet.closest('article') ||
      tweet.closest('[data-testid="tweet"]') ||
      tweet.closest('[role="article"]') ||
      tweet.closest('[data-testid="cellInnerDiv"]') ||
      tweet.parentElement?.parentElement?.parentElement ||
      tweet.parentElement
    );
  }

  function findGrokButton(container) {
    const buttons = [...container.querySelectorAll('button, [role="button"]')];
    return buttons.find((el) => {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const testId = (el.getAttribute('data-testid') || '').toLowerCase();
      return label.includes('grok') || testId.includes('grok');
    });
  }

  /* ---------- ボタンの配置処理 ---------- */

  function attachButton(tweet, root, btn) {
    // 1. 引用ポストの場合：枠内の右上に配置
    if (isInsideQuote(tweet)) {
      btn.className = 'xmd-toggle xmd-toggle-quote';
      (showRaw.get(tweet) ? tweet : root).prepend(btn);
      return;
    }

    const container = getPostContainer(tweet);
    if (container) {
      btn.className = 'xmd-toggle xmd-toggle-header';

      // 1. Grokボタンを探す
      const grokBtn = findGrokButton(container);
      if (grokBtn) {
        grokBtn.before(btn);
        return;
      }

      // 2. caret (…ボタン) を探す
      const caret = container.querySelector('[data-testid="caret"]');
      if (caret) {
        const caretBtn = caret.closest('button, [role="button"]') || caret;
        caretBtn.before(btn);
        return;
      }
    }

    // ★ 絶対保証フォールバック：ヘッダーが見つからない場合でも絶対に消さず右上に配置！
    btn.className = 'xmd-toggle xmd-toggle-quote';
    (showRaw.get(tweet) ? tweet : root).prepend(btn);
  }

  /* ---------- 適用 ---------- */

  function unrender(tweet) {
    const root = tweetRoots.get(tweet);
    if (root) {
      root.remove();
      tweetRoots.delete(tweet);
    }
    const parent = tweet.parentElement;
    if (parent) {
      parent.querySelectorAll('.xmd-root').forEach((r) => r.remove());
    }
    const btn = tweetButtons.get(tweet);
    if (btn) {
      btn.remove();
      tweetButtons.delete(tweet);
    }
    tweet.classList.remove('xmd-hidden');
    delete tweet.dataset.xmdSig;
  }

  function applyToggle(tweet, root, btn) {
    const raw = showRaw.get(tweet) === true;
    tweet.classList.toggle('xmd-hidden', !raw);
    root.classList.toggle('xmd-hidden', raw);
    btn.textContent = raw ? 'MD' : '原文';
    btn.title = raw ? 'Markdown表示に切り替え' : '原文表示に切り替え';

    if (btn.classList.contains('xmd-toggle-quote')) {
      (raw ? tweet : root).prepend(btn);
    }
  }

  function process(tweet) {
    if (!settings.enabled) {
      if (tweet.dataset.xmdSig !== undefined) unrender(tweet);
      return;
    }

    // 投稿作成画面の中の入力要素のみスキップ
    if (isInsideComposer(tweet)) {
      return;
    }

    const raw = extractText(tweet);
    const sig = String(raw.length) + ':' + raw.slice(0, 30);
    const existing = tweetRoots.get(tweet);
    const existingBtn = tweetButtons.get(tweet);

    // 正常に表示中ならスキップ
    if (tweet.dataset.xmdSig === sig && existing && existing.isConnected && existingBtn && existingBtn.isConnected) {
      // Grokが遅れて生えてボタンが右側に回っていないかだけ補正
      if (!isInsideQuote(tweet)) {
        const container = getPostContainer(tweet);
        if (container) {
          const grok = findGrokButton(container);
          if (grok && (existingBtn.compareDocumentPosition(grok) & Node.DOCUMENT_POSITION_PRECEDING)) {
            grok.before(existingBtn);
          }
        }
      }
      return;
    }

    unrender(tweet);

    if (!settings.forceAll && !looksLikeMarkdown(raw)) {
      tweet.classList.remove('xmd-hidden');
      tweet.dataset.xmdSig = sig;
      return;
    }

    const root = renderMarkdown(raw);
    try {
      const cs = window.getComputedStyle(tweet);
      if (cs) {
        root.style.fontFamily = cs.fontFamily || 'inherit';
        root.style.fontSize = cs.fontSize || 'inherit';
        root.style.lineHeight = cs.lineHeight || 'inherit';
        root.style.letterSpacing = cs.letterSpacing || 'normal';
        root.style.color = cs.color || 'inherit';
      }
    } catch {}

    const btn = el('button', 'xmd-toggle');
    btn.type = 'button';

    root.addEventListener('click', (e) => {
      if (e.target.closest('a, button, input')) e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showRaw.set(tweet, !(showRaw.get(tweet) === true));
      applyToggle(tweet, root, btn);
    });

    tweet.after(root);
    tweetRoots.set(tweet, root);
    attachButton(tweet, root, btn);

    tweetButtons.set(tweet, btn);
    tweet.dataset.xmdSig = sig;
    applyToggle(tweet, root, btn);
  }

  function scan() {
    document.querySelectorAll(TWEET_SEL).forEach((t) => {
      try { process(t); } catch (e) { console.warn('[X-MD]', e); }
    });
  }

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; scan(); }, 100);
  }

  function clearAll() {
    document.querySelectorAll(TWEET_SEL).forEach(unrender);
  }

  /* ---------- 初期化 ---------- */

  function loadSettings(cb) {
    try {
      chrome.storage.sync.get(settings, (v) => {
        Object.assign(settings, v);
        cb();
      });
    } catch { cb(); }
  }

  loadSettings(() => {
    scan();
    new MutationObserver(schedule).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(settings)) {
        if (changes[k]) settings[k] = changes[k].newValue;
      }
      clearAll();
      scan();
    });
  } catch {}
})();