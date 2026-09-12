(function () {
  'use strict';

  const F = window.Forum;

  function renderCover(site) {
    const wrap = F.$('#coverWrap');
    const img = F.$('#coverImage');
    if (!wrap || !img) return;
    if (site && site.coverUrl) {
      img.onerror = () => {
        wrap.classList.add('invisible');
        img.removeAttribute('src');
      };
      img.src = site.coverUrl;
      wrap.classList.remove('invisible');
    } else {
      wrap.classList.add('invisible');
      img.removeAttribute('src');
    }
  }

  async function loadHome() {
    const listBox = F.$('#boardList');
    try {
      const data = await F.api('/api/home');
      F.setSiteHeader(data.site);
      renderCover(data.site);
      listBox.textContent = '';

      if (!data.boards.length) {
        listBox.appendChild(F.el('p', 'empty-state', '还没有分区，请通过管理后台添加。'));
        return;
      }

      for (const board of data.boards) {
        const card = F.el('a', 'board-card');
        card.href = `/board.html?b=${encodeURIComponent(board.code)}`;

        const top = F.el('div', 'board-card-top');
        top.appendChild(F.el('span', 'board-code', `/${board.code}/`));
        top.appendChild(F.el('span', 'board-name', board.name));
        card.appendChild(top);

        card.appendChild(F.el('div', 'board-desc', board.description || '暂无说明'));

        const meta = F.el('div', 'board-meta');
        meta.appendChild(F.el('span', null, `${board.thread_count} 主题 · ${board.reply_count} 回复`));
        meta.appendChild(F.el('span', null,
          board.last_activity ? `最后活动 ${F.formatShort(board.last_activity)}` : '暂无帖子'));
        card.appendChild(meta);

        listBox.appendChild(card);
      }
    } catch (err) {
      listBox.textContent = '';
      listBox.appendChild(F.el('p', 'empty-state', `加载失败：${err.message}`));
    }
  }

  loadHome();
})();
