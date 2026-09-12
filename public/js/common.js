(function () {
  'use strict';

  let metaCache = null;
  let toastBox = null;

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  async function api(path, options) {
    const resp = await fetch(path, options || {});
    let json = null;
    try {
      json = await resp.json();
    } catch (err) {
      const parseError = new Error(`服务器响应异常（HTTP ${resp.status}）`);
      parseError.status = resp.status;
      throw parseError;
    }
    if (!resp.ok || !json.ok) {
      const error = new Error(json.error || `请求失败（HTTP ${resp.status}）`);
      error.status = resp.status;
      error.data = json;
      throw error;
    }
    return json;
  }

  async function loadMeta() {
    if (!metaCache) {
      metaCache = api('/api/meta').catch((err) => {
        metaCache = null;
        throw err;
      });
    }
    return metaCache;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso || '');
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}(${WEEK[d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatShort(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.getFullYear() === now.getFullYear()) {
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function setSiteHeader(site) {
    if (!site) return;
    const titleNode = $('#siteTitle');
    const descNode = $('#siteDesc');
    if (titleNode) titleNode.textContent = site.siteTitle || '校园匿名版';
    if (descNode) descNode.textContent = site.siteDescription || '';
    document.title = site.siteTitle || '校园匿名版';
  }

  function renderImageBlock(image) {
    if (!image) return null;
    const fig = el('figure', 'post-file');
    const link = el('a');
    link.href = image.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const img = el('img');
    img.src = image.url;
    img.alt = '帖子图片';
    img.loading = 'lazy';
    link.appendChild(img);
    fig.appendChild(link);
    fig.appendChild(el('figcaption', 'post-file-name', `文件: ${image.name}`));
    return fig;
  }

  function nameLine(post) {
    const frag = document.createDocumentFragment();
    frag.appendChild(el('span', 'post-name', '无名氏'));
    frag.appendChild(el('span', 'anon-id', `ID:${post.anonId || '????'}`));
    if (post.isAdmin) frag.appendChild(el('span', 'admin-badge', '管理员'));
    if (post.isSticky && !post.threadId) frag.appendChild(el('span', 'sticky-badge', '置顶'));
    return frag;
  }

  function likeButton(post) {
    const liked = !!post.likedByMe;
    const count = Number(post.likeCount || 0);
    const btn = el('button', `like-btn${liked ? ' liked' : ''}`);
    btn.type = 'button';
    btn.dataset.likeId = String(post.id);
    btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
    btn.title = liked ? '你已经点过赞了' : '给这条帖子点赞';
    btn.appendChild(el('span', 'like-icon', '♥'));
    btn.appendChild(el('span', 'like-label', liked ? '已赞' : '赞'));
    btn.appendChild(el('span', 'like-count', String(count)));
    if (liked) btn.disabled = true;
    return btn;
  }

  function shareButton(post) {
    const btn = el('button', 'reply-btn share-btn', '分享');
    btn.type = 'button';
    btn.dataset.shareId = String(post.id);
    btn.title = '生成这条帖子的分享链接';
    return btn;
  }

  async function sharePost(postId) {
    const url = `${location.origin}/post.html?id=${encodeURIComponent(postId)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: '分享这条帖子', text: '来自校园匿名版的帖子', url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        toast('分享链接已复制，发给其他人即可打开', 'success');
        return;
      }
    } catch (err) {
      // 继续走 prompt 兜底
    }
    window.prompt('复制下面的链接分享给其他人：', url);
  }

  /**
   * 渲染帖子。
   * opts.replyNumber 回复序号；opts.showReply 显示引用按钮；opts.showLike 显示点赞按钮；
   * opts.clampContent 折叠长正文；opts.subjectLink 主题标题链接；
   * opts.footerText 底部左侧文字；opts.footerLink {href,text} 额外链接。
   */
  function renderPost(post, opts) {
    const options = opts || {};
    const isReply = !!post.threadId;
    const wrap = el('article', 'post' + (isReply ? ' reply' : ' is-op') + (post.isSticky && !isReply ? ' sticky-op' : ''));
    wrap.id = `p${post.id}`;
    wrap.dataset.postId = String(post.id);
    wrap.dataset.likeCount = String(post.likeCount || 0);

    const meta = el('div', 'post-meta');
    if (options.replyNumber) meta.appendChild(el('span', 'reply-num', `[${options.replyNumber}]`));
    meta.appendChild(nameLine(post));
    meta.appendChild(el('span', 'post-time', formatTime(post.createdAt)));
    const no = el('span', 'post-no');
    no.appendChild(document.createTextNode('No.'));
    const noLink = el('a', null, String(post.id));
    noLink.href = `#p${post.id}`;
    no.appendChild(noLink);
    meta.appendChild(no);
    wrap.appendChild(meta);

    if (post.subject && !isReply) {
      const subject = el('div', 'post-subject');
      if (options.subjectLink) {
        const link = el('a', null, post.subject);
        link.href = options.subjectLink;
        subject.appendChild(link);
      } else {
        subject.textContent = post.subject;
      }
      wrap.appendChild(subject);
    }

    if (post.content) {
      wrap.appendChild(el('div', `post-content${options.clampContent ? ' clamp' : ''}`, post.content));
    }

    const image = renderImageBlock(post.image);
    if (image) wrap.appendChild(image);

    const needFooter =
      options.showLike || options.showShare || options.showReply ||
      options.footerText || options.footerLink;
    if (needFooter) {
      const footer = el('div', 'post-footer');
      footer.appendChild(el('span', null, options.footerText || ''));
      const actions = el('div', 'post-actions');
      if (options.showLike) actions.appendChild(likeButton(post));
      if (options.showShare) actions.appendChild(shareButton(post));
      if (options.footerLink) {
        const link = el('a', 'reply-btn', options.footerLink.text);
        link.href = options.footerLink.href;
        actions.appendChild(link);
      }
      if (options.showReply) {
        const replyBtn = el('button', 'reply-btn quote-btn', '引用回复');
        replyBtn.type = 'button';
        replyBtn.dataset.quoteId = String(post.id);
        actions.appendChild(replyBtn);
      }
      footer.appendChild(actions);
      wrap.appendChild(footer);
    }
    return wrap;
  }

  function renumberReplies(container) {
    const nodes = Array.from(container.querySelectorAll('.post'));
    nodes.forEach((node, index) => {
      const num = node.querySelector('.reply-num');
      if (num) num.textContent = `[${index + 1}]`;
    });
  }

  function sortRepliesByLikes(container) {
    const nodes = Array.from(container.querySelectorAll(':scope > .post'));
    if (nodes.length < 2) return;
    const before = new Map();
    nodes.forEach((node) => before.set(node, node.getBoundingClientRect()));

    nodes.sort((a, b) => {
      const likeDiff = Number(b.dataset.likeCount || 0) - Number(a.dataset.likeCount || 0);
      if (likeDiff) return likeDiff;
      return Number(a.dataset.postId || 0) - Number(b.dataset.postId || 0);
    });
    nodes.forEach((node) => container.appendChild(node));

    nodes.forEach((node) => {
      const prev = before.get(node);
      const next = node.getBoundingClientRect();
      const dy = prev.top - next.top;
      if (Math.abs(dy) > 1 && node.animate) {
        node.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
          { duration: 260, easing: 'ease-out' }
        );
      }
    });
    renumberReplies(container);
  }

  function toast(message, type) {
    if (!message) return;
    if (!toastBox) toastBox = document.getElementById('toastBox');
    if (!toastBox) {
      toastBox = el('div', 'toast-box');
      toastBox.id = 'toastBox';
      document.body.appendChild(toastBox);
    }
    const item = el('div', `toast ${type || ''}`, message);
    toastBox.appendChild(item);
    requestAnimationFrame(() => item.classList.add('show'));
    const remove = () => {
      item.classList.remove('show');
      setTimeout(() => item.remove(), 220);
    };
    item.addEventListener('click', remove);
    setTimeout(remove, 2800);
  }

  function startCooldown(button, seconds, messageEl, prefix) {
    if (!button || !seconds || seconds <= 0) return;
    const originalText = button.dataset.originalText || button.textContent;
    button.dataset.originalText = originalText;
    let remain = seconds;
    const update = () => {
      button.textContent = `${remain}s 后可再发`;
      if (messageEl) messageEl.textContent = `${prefix || '发布成功'}，${remain} 秒后可再次发帖`;
    };
    button.disabled = true;
    update();
    const timer = setInterval(() => {
      remain -= 1;
      if (remain <= 0) {
        clearInterval(timer);
        button.disabled = false;
        button.textContent = originalText;
        if (messageEl) messageEl.textContent = '';
      } else {
        update();
      }
    }, 1000);
  }

  function setImageHint(meta) {
    const hint = $('#imageHint');
    if (!hint || !meta) return;
    hint.textContent = `支持 JPG / PNG / GIF / WEBP，最大 ${meta.maxUploadMb}MB，并会校验真实文件内容`;
  }

  function validateImageFile(file, meta) {
    if (!file) return null;
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) return '仅支持 JPG / PNG / GIF / WEBP 图片';
    if (meta && file.size > meta.maxUploadMb * 1024 * 1024) {
      return `图片不能超过 ${meta.maxUploadMb}MB`;
    }
    return null;
  }

  window.Forum = {
    $,
    el,
    api,
    loadMeta,
    formatTime,
    formatShort,
    setSiteHeader,
    renderPost,
    renderImageBlock,
    sortRepliesByLikes,
    renumberReplies,
    sharePost,
    toast,
    startCooldown,
    setImageHint,
    validateImageFile
  };
})();
