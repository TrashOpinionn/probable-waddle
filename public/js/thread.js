(function () {
  'use strict';

  const F = window.Forum;
  const id = Number(new URLSearchParams(location.search).get('id'));
  let meta = null;

  function replyContainer() {
    return F.$('#replyList');
  }

  function quoteReply(postId) {
    const textarea = F.$('#replyForm textarea');
    if (!textarea) return;
    const quote = `>>No.${postId}\n`;
    if (textarea.value && !textarea.value.endsWith('\n')) textarea.value += '\n';
    textarea.value += quote;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  async function handleLike(button) {
    if (button.disabled) return;
    const postId = button.dataset.likeId;
    button.disabled = true;
    try {
      const data = await F.api(`/api/posts/${postId}/like`, { method: 'POST' });
      const node = button.closest('.post');
      if (node) node.dataset.likeCount = String(data.likeCount);
      const countNode = button.querySelector('.like-count');
      const labelNode = button.querySelector('.like-label');
      if (countNode) countNode.textContent = String(data.likeCount);
      if (labelNode) labelNode.textContent = '已赞';
      button.classList.add('liked', 'like-pop');
      button.setAttribute('aria-pressed', 'true');
      setTimeout(() => button.classList.remove('like-pop'), 420);
      F.sortRepliesByLikes(replyContainer());
      F.toast(data.added ? '点赞成功' : '你已经赞过这条回复了', data.added ? 'success' : '');
    } catch (err) {
      button.disabled = false;
      F.toast(err.message, 'error');
    }
  }

  async function loadThread() {
    const opBox = F.$('#opBox');
    const replyBox = replyContainer();
    const subjectNode = F.$('#threadSubject');
    const metaNode = F.$('#threadMeta');

    try {
      const data = await F.api(`/api/threads/${id}`);
      F.setSiteHeader(data.site);

      const boardLink = F.$('#boardCrumb');
      if (boardLink) {
        boardLink.textContent = data.thread.boardName || data.thread.boardCode || '分区';
        boardLink.href = `/board.html?b=${encodeURIComponent(data.thread.boardCode || '')}`;
      }

      subjectNode.textContent = data.thread.subject || `主题 No.${data.thread.id}`;
      metaNode.textContent = `${data.thread.boardName || ''} · ${F.formatTime(data.thread.createdAt)} · 匿名 ID:${data.thread.anonId}`;
      document.title = subjectNode.textContent;

      opBox.textContent = '';
      opBox.appendChild(F.renderPost(data.thread, {
        showReply: true,
        showLike: true,
        showShare: true
      }));

      replyBox.textContent = '';
      F.$('#replyCountLabel').textContent = `${data.replies.length} 条回复 · 按点赞数排序`;
      if (!data.replies.length) {
        replyBox.appendChild(F.el('p', 'empty-state', '暂无回复，来抢沙发。'));
      } else {
        data.replies.forEach((reply, index) => {
          replyBox.appendChild(F.renderPost(reply, {
            replyNumber: index + 1,
            showLike: true,
            showReply: true,
            showShare: true
          }));
        });
      }

      const hash = location.hash ? location.hash.replace('#', '') : '';
      if (hash) {
        const target = document.getElementById(hash);
        if (target) {
          setTimeout(() => {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('post-highlight');
            setTimeout(() => target.classList.remove('post-highlight'), 2600);
          }, 80);
        }
      }
    } catch (err) {
      opBox.textContent = '';
      replyBox.textContent = '';
      opBox.appendChild(F.el('p', 'empty-state', `加载失败：${err.message}`));
      subjectNode.textContent = '主题不存在';
      metaNode.textContent = '';
    }
  }

  async function submitReply(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const errorBox = F.$('#formError');
    const btn = form.querySelector('button[type="submit"]');
    errorBox.textContent = '';

    const content = F.$('#content').value.trim();
    const file = F.$('#image').files[0];
    if (!content && !file) {
      errorBox.textContent = '正文和图片至少填写一项';
      return;
    }
    const fileError = F.validateImageFile(file, meta);
    if (fileError) {
      errorBox.textContent = fileError;
      return;
    }

    let cooling = false;
    btn.disabled = true;
    try {
      const result = await F.api(`/api/threads/${id}/replies`, {
        method: 'POST',
        body: new FormData(form)
      });
      form.reset();
      F.toast('回复成功', 'success');
      if (result.retryAfter > 0) {
        cooling = true;
        F.startCooldown(btn, result.retryAfter, errorBox, '回复成功');
      }
      await loadThread();
      const node = document.getElementById(`p${result.post.id}`);
      if (node) {
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        node.animate(
          [{ boxShadow: '0 0 0 0 rgba(224,36,94,0.45)' }, { boxShadow: '0 0 0 8px rgba(224,36,94,0)' }],
          { duration: 900, easing: 'ease-out' }
        );
      }
    } catch (err) {
      errorBox.textContent = err.message;
      if (err.status === 429) {
        cooling = true;
        F.startCooldown(btn, (err.data && err.data.retryAfter) || 10, errorBox, '发帖太频繁');
      }
    } finally {
      if (!cooling) btn.disabled = false;
    }
  }

  function bindEvents() {
    document.addEventListener('click', (event) => {
      const quoteBtn = event.target.closest('.quote-btn');
      if (quoteBtn) {
        const postNode = quoteBtn.closest('.post');
        const postId = quoteBtn.dataset.quoteId || (postNode ? postNode.dataset.postId : '');
        if (postId) quoteReply(postId);
        return;
      }
      const likeBtn = event.target.closest('.like-btn');
      if (likeBtn) {
        handleLike(likeBtn);
        return;
      }
      const shareBtn = event.target.closest('.share-btn');
      if (shareBtn) {
        const postNode = shareBtn.closest('.post');
        const postId = shareBtn.dataset.shareId || (postNode ? postNode.dataset.postId : '');
        if (postId) F.sharePost(postId);
      }
    });
  }

  async function init() {
    if (!Number.isInteger(id) || id <= 0) {
      F.$('#opBox').appendChild(F.el('p', 'empty-state', '缺少主题参数'));
      return;
    }
    try {
      meta = await F.loadMeta();
      F.setImageHint(meta);
    } catch (err) {
      meta = null;
    }
    bindEvents();
    F.$('#replyForm').addEventListener('submit', submitReply);
    loadThread();
  }

  init();
})();
