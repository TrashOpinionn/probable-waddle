(function () {
  'use strict';

  const F = window.Forum;
  const id = Number(new URLSearchParams(location.search).get('id'));
  let currentPost = null;

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
      F.toast(data.added ? '点赞成功' : '你已经赞过这条帖子了', data.added ? 'success' : '');
    } catch (err) {
      button.disabled = false;
      F.toast(err.message, 'error');
    }
  }

  async function loadPost() {
    const box = F.$('#postBox');
    const actionsBox = F.$('#postActions');
    try {
      const data = await F.api(`/api/posts/${id}`);
      currentPost = data.post;
      F.setSiteHeader(data.site);

      const boardLink = F.$('#boardCrumb');
      boardLink.textContent = data.post.boardName || data.post.boardCode || '分区';
      boardLink.href = `/board.html?b=${encodeURIComponent(data.post.boardCode || '')}`;

      const threadId = data.post.threadId || data.post.id;
      const title = data.post.subject || `帖子 No.${data.post.id}`;
      F.$('#postTitle').textContent = title;
      F.$('#postMeta').textContent =
        `${data.post.boardName || ''} · ${F.formatTime(data.post.createdAt)} · No.${data.post.id}` +
        (data.post.threadId ? ` · 来自主题 No.${data.post.threadId}` : '');
      document.title = `${title} · 校园匿名版`;

      box.textContent = '';
      box.appendChild(F.renderPost(data.post, {
        showLike: true,
        showShare: true,
        subjectLink: `/thread.html?id=${encodeURIComponent(threadId)}`
      }));

      actionsBox.textContent = '';
      const threadLink = F.el('a', 'btn btn-primary', '查看完整主题');
      threadLink.href = `/thread.html?id=${encodeURIComponent(threadId)}#p${data.post.id}`;
      actionsBox.appendChild(threadLink);
      if (data.thread && data.thread.subject && data.post.threadId) {
        actionsBox.appendChild(F.el('span', 'muted', `《${data.thread.subject}》`));
      }
    } catch (err) {
      box.textContent = '';
      box.appendChild(F.el('p', 'empty-state', `加载失败：${err.message}`));
      F.$('#postTitle').textContent = '帖子不存在';
    }
  }

  document.addEventListener('click', (event) => {
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

  if (!Number.isInteger(id) || id <= 0) {
    F.$('#postBox').appendChild(F.el('p', 'empty-state', '缺少帖子参数'));
  } else {
    loadPost();
  }
})();
