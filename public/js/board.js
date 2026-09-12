(function () {
  'use strict';

  const F = window.Forum;
  const code = new URLSearchParams(location.search).get('b') || '';
  let meta = null;

  function threadLink(id) {
    return `/thread.html?id=${encodeURIComponent(id)}`;
  }

  function loadBoard() {
    const titleNode = F.$('#boardTitle');
    const descNode = F.$('#boardDesc');
    const listBox = F.$('#threadList');
    const countLabel = F.$('#threadCountLabel');

    return F.api(`/api/boards/${encodeURIComponent(code)}`).then((data) => {
      F.setSiteHeader(data.site);
      titleNode.textContent = `/${data.board.code}/ ${data.board.name}`;
      descNode.textContent = data.board.description || '';
      document.title = `/${data.board.code}/ ${data.board.name}`;

      listBox.textContent = '';
      countLabel.textContent = `${data.threads.length} 个主题`;
      if (!data.threads.length) {
        listBox.appendChild(F.el('p', 'empty-state', '这里还很安静，来发第一个主题吧。'));
        return;
      }

      for (const thread of data.threads) {
        const stats = `${thread.replyCount || 0} 回复` +
          (thread.likeCount ? ` · ${thread.likeCount} 赞` : '') +
          (thread.lastReplyAt ? ` · 最后回复 ${F.formatShort(thread.lastReplyAt)}` : '');
        listBox.appendChild(F.renderPost(thread, {
          clampContent: true,
          subjectLink: threadLink(thread.id),
          footerText: stats,
          footerLink: { href: threadLink(thread.id), text: '进入主题' },
          showShare: true
        }));
      }
    }).catch((err) => {
      listBox.textContent = '';
      listBox.appendChild(F.el('p', 'empty-state', `加载失败：${err.message}`));
      titleNode.textContent = '分区不存在';
    });
  }

  async function submitThread(event) {
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
      const result = await F.api(`/api/boards/${encodeURIComponent(code)}/threads`, {
        method: 'POST',
        body: new FormData(form)
      });
      form.reset();
      F.toast('主题发布成功', 'success');
      if (result.retryAfter > 0) {
        cooling = true;
        F.startCooldown(btn, result.retryAfter, errorBox, '主题发布成功');
      }
      await loadBoard();
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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

  async function init() {
    if (!code) {
      F.$('#threadList').textContent = '';
      F.$('#threadList').appendChild(F.el('p', 'empty-state', '缺少分区参数'));
      return;
    }
    try {
      meta = await F.loadMeta();
      F.setImageHint(meta);
    } catch (err) {
      meta = null;
    }
    F.$('#newThreadForm').addEventListener('submit', submitThread);
    document.addEventListener('click', (event) => {
      const shareBtn = event.target.closest('.share-btn');
      if (!shareBtn) return;
      const postNode = shareBtn.closest('.post');
      const postId = shareBtn.dataset.shareId || (postNode ? postNode.dataset.postId : '');
      if (postId) F.sharePost(postId);
    });
    loadBoard();
  }

  init();
})();
