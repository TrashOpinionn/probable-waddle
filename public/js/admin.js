(function () {
  'use strict';

  const F = window.Forum;
  const apiBase = location.pathname.replace(/\/+$/, '') + '/api';
  let overviewData = null;
  let adminMeta = null;

  function $(id) {
    return document.getElementById(id);
  }

  function showLogin() {
    $('loginView').classList.remove('invisible');
    $('dashboard').classList.add('invisible');
  }

  function showDashboard() {
    $('loginView').classList.add('invisible');
    $('dashboard').classList.remove('invisible');
  }

  async function withError(elId, fn, successMessage) {
    const msgEl = elId ? $(elId) : null;
    if (msgEl) msgEl.textContent = '';
    try {
      const result = await fn();
      if (successMessage) F.toast(successMessage, 'success');
      return result === undefined ? true : result;
    } catch (err) {
      if (msgEl) {
        msgEl.textContent = err.message;
      } else {
        F.toast(err.message, 'error');
      }
      if (err.status === 401) showLogin();
      return null;
    }
  }

  function renderSettings(settings) {
    $('siteTitle').value = settings.siteTitle || '';
    $('siteDescription').value = settings.siteDescription || '';
  }

  function renderCover(settings) {
    const img = $('coverPreview');
    const empty = $('coverEmpty');
    if (settings.coverUrl) {
      img.onerror = () => {
        img.classList.add('invisible');
        empty.classList.remove('invisible');
      };
      img.src = settings.coverUrl;
      img.classList.remove('invisible');
      empty.classList.add('invisible');
    } else {
      img.removeAttribute('src');
      img.classList.add('invisible');
      empty.classList.remove('invisible');
    }
  }

  function renderStats(data) {
    const stats = data.stats || {};
    const cards = [
      ['分区', stats.boards || 0],
      ['主题', stats.threads || 0],
      ['回复', stats.replies || 0],
      ['点赞', stats.likes || 0]
    ];
    const box = $('statCards');
    box.textContent = '';
    for (const [label, value] of cards) {
      const card = F.el('div', 'stat-card');
      card.appendChild(F.el('span', 'stat-value', value));
      card.appendChild(F.el('span', 'stat-label', label));
      box.appendChild(card);
    }

    const c = data.config || {};
    $('dashHint').textContent =
      `数据库 ${c.database} · 图片 ${c.storage} · 保留 ${c.retentionDays} 天 · 清理 ${c.cleanupSchedule} · 图片 ≤ ${c.maxUploadMb}MB · 发帖间隔 ${c.postCooldownSeconds}s`;
  }

  function renderBoardEditor(boards) {
    const rows = $('boardRows');
    rows.textContent = '';
    if (!boards.length) {
      rows.appendChild(F.el('p', 'muted', '暂无分区'));
      return;
    }
    for (const board of boards) {
      const row = F.el('div', 'board-edit-row');
      row.dataset.boardId = board.id;

      const codeInput = F.el('input', 'bc');
      codeInput.type = 'text';
      codeInput.maxLength = 30;
      codeInput.value = board.code;
      codeInput.placeholder = '标识';

      const nameInput = F.el('input', 'bn');
      nameInput.type = 'text';
      nameInput.maxLength = 30;
      nameInput.value = board.name;
      nameInput.placeholder = '名称';

      const descInput = F.el('input', 'bd');
      descInput.type = 'text';
      descInput.maxLength = 200;
      descInput.value = board.description || '';
      descInput.placeholder = '说明';

      const saveBtn = F.el('button', 'btn btn-small', '保存');
      saveBtn.type = 'button';
      saveBtn.addEventListener('click', () =>
        saveBoard(board.id, codeInput.value, nameInput.value, descInput.value));

      const delBtn = F.el('button', 'btn btn-small btn-danger', '删除');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => deleteBoard(board));

      row.append(codeInput, nameInput, descInput, saveBtn, delBtn);
      rows.appendChild(row);
    }
  }

  function fillBoardSelect(boards) {
    const sel = $('adminBoardId');
    sel.textContent = '';
    for (const board of boards) {
      const opt = document.createElement('option');
      opt.value = board.id;
      opt.textContent = `${board.name} (/${board.code}/)`;
      sel.appendChild(opt);
    }
  }

  function snippetOf(post) {
    if (post.subject) return `${post.subject}｜${post.content || '(仅图片)'}`;
    return post.content || '(仅图片)';
  }

  function filteredPosts() {
    if (!overviewData) return [];
    const q = ($('postFilter').value || '').trim().toLowerCase();
    if (!q) return overviewData.recentPosts;
    return overviewData.recentPosts.filter((post) => {
      const haystack = [
        post.id,
        post.boardCode,
        post.boardName,
        post.subject,
        post.content,
        post.anonId
      ].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }

  function renderPostTable() {
    const tbody = $('postTableBody');
    const posts = filteredPosts();
    tbody.textContent = '';
    if (!posts.length) {
      const tr = document.createElement('tr');
      const td = F.el('td', 'muted', '没有匹配的帖子');
      td.colSpan = 5;
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    for (const post of posts) {
      const tr = document.createElement('tr');
      const tdId = document.createElement('td');
      tdId.appendChild(document.createTextNode(`No.${post.id}`));
      tdId.appendChild(F.el('div', 'muted', post.threadId ? `回复主题 ${post.threadId}` : '主题帖'));
      if (post.threadId && post.likeCount > 0) {
        tdId.appendChild(F.el('span', 'meta-chip', `♥ ${post.likeCount}`));
      }

      const tdBoard = F.el('td', null, `/${post.boardCode || ''}/ ${post.boardName || ''}`);
      const tdTime = F.el('td', null, F.formatTime(post.createdAt));
      const tdContent = F.el('td', 'admin-snippet', snippetOf(post));
      const tdActions = F.el('td', 'admin-actions');

      const viewLink = F.el('a', 'btn btn-small', '查看');
      viewLink.href = `/thread.html?id=${encodeURIComponent(threadIdOf(post))}`;
      viewLink.target = '_blank';
      viewLink.rel = 'noopener';
      tdActions.appendChild(viewLink);

      if (!post.threadId) {
        const stickyBtn = F.el('button', 'btn btn-small', post.isSticky ? '取消置顶' : '置顶');
        stickyBtn.type = 'button';
        stickyBtn.addEventListener('click', () => toggleSticky(post, !post.isSticky));
        tdActions.appendChild(stickyBtn);
      }

      const delBtn = F.el('button', 'btn btn-small btn-danger', '删除');
      delBtn.type = 'button';
      delBtn.addEventListener('click', () => deletePost(post));
      tdActions.appendChild(delBtn);

      tr.append(tdId, tdBoard, tdTime, tdContent, tdActions);
      tbody.appendChild(tr);
    }
  }

  function threadIdOf(post) {
    return post.threadId || post.id;
  }

  async function loadOverview(showToast) {
    const data = await F.api(`${apiBase}/overview`);
    overviewData = data;
    renderSettings(data.settings);
    renderCover(data.settings);
    renderStats(data);
    renderBoardEditor(data.boards);
    fillBoardSelect(data.boards);
    renderPostTable();
    if (showToast) F.toast('数据已刷新', 'success');
  }

  async function saveBoard(id, code, name, description) {
    await withError(null, async () => {
      await F.api(`${apiBase}/boards/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name, description })
      });
      await loadOverview(false);
    }, '分区已保存');
  }

  async function deleteBoard(board) {
    const ok = window.confirm(
      `确认删除分区「${board.name}」？分区内全部主题、回复和图片都会被删除，无法恢复。`
    );
    if (!ok) return;
    await withError(null, async () => {
      await F.api(`${apiBase}/boards/${board.id}`, { method: 'DELETE' });
      await loadOverview(false);
    }, '分区已删除');
  }

  async function toggleSticky(post, sticky) {
    await withError(null, async () => {
      await F.api(`${apiBase}/posts/${post.id}/sticky`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky })
      });
      await loadOverview(false);
    }, sticky ? '已置顶' : '已取消置顶');
  }

  async function deletePost(post) {
    const extra = post.threadId ? '' : '\n注意：删除主题会连同其全部回复一起删除。';
    const ok = window.confirm(`确认删除 No.${post.id}？${extra}`);
    if (!ok) return;
    await withError(null, async () => {
      await F.api(`${apiBase}/posts/${post.id}`, { method: 'DELETE' });
      await loadOverview(false);
    }, '帖子已删除');
  }

  async function submitLogin(event) {
    event.preventDefault();
    const btn = $('loginBtn');
    const errorBox = $('loginError');
    errorBox.textContent = '';
    btn.disabled = true;
    try {
      await F.api(`${apiBase}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('loginPassword').value })
      });
      $('loginPassword').value = '';
      showDashboard();
      await loadOverview(false);
    } catch (err) {
      errorBox.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function submitSettings(event) {
    event.preventDefault();
    const ok = await withError('settingsMsg', async () => {
      await F.api(`${apiBase}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteTitle: $('siteTitle').value,
          siteDescription: $('siteDescription').value
        })
      });
      $('settingsMsg').textContent = '已保存';
    }, '首页设置已保存');
    if (ok) setTimeout(() => { $('settingsMsg').textContent = ''; }, 1800);
  }

  async function submitCover(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = $('coverFile').files[0];
    const msg = $('coverMsg');
    msg.textContent = '';
    if (!file) {
      msg.textContent = '请选择要上传的封面图片';
      return;
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      msg.textContent = '封面仅支持 JPG / PNG 格式';
      return;
    }
    const maxMb = (overviewData && overviewData.config && overviewData.config.coverMaxMb) || 2;
    if (file.size > maxMb * 1024 * 1024) {
      msg.textContent = `封面不能超过 ${maxMb}MB`;
      return;
    }

    const fd = new FormData();
    fd.append('cover', file, file.name);
    await withError('coverMsg', async () => {
      await F.api(`${apiBase}/cover`, { method: 'POST', body: fd });
      form.reset();
      await loadOverview(false);
    }, '论坛封面已更新');
  }

  async function removeCover() {
    if (!window.confirm('确认移除当前论坛封面？移除后首页会恢复默认简洁样式。')) return;
    await withError('coverMsg', async () => {
      await F.api(`${apiBase}/cover`, { method: 'DELETE' });
      await loadOverview(false);
    }, '论坛封面已移除');
  }

  async function addBoard() {
    await withError(null, async () => {
      await F.api(`${apiBase}/boards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: $('newBoardCode').value,
          name: $('newBoardName').value,
          description: $('newBoardDesc').value
        })
      });
      $('newBoardCode').value = '';
      $('newBoardName').value = '';
      $('newBoardDesc').value = '';
      await loadOverview(false);
    }, '分区已添加');
  }

  async function submitAdminPost(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const btn = form.querySelector('button[type="submit"]');
    const msg = $('adminPostMsg');
    msg.textContent = '';
    const content = $('adminContent').value.trim();
    const image = $('adminImage').files[0];
    if (!content && !image) {
      msg.textContent = '正文和图片至少填写一项';
      return;
    }
    if (!adminMeta) {
      try {
        adminMeta = await F.loadMeta();
      } catch (err) {
        adminMeta = null;
      }
    }
    const fileError = F.validateImageFile(image, adminMeta);
    if (fileError) {
      msg.textContent = fileError;
      return;
    }

    const fd = new FormData();
    fd.append('boardId', $('adminBoardId').value);
    const threadId = $('adminThreadId').value.trim();
    if (threadId) fd.append('threadId', threadId);
    fd.append('subject', $('adminSubject').value.trim());
    fd.append('content', content);
    fd.append('sticky', $('adminSticky').checked ? 'true' : 'false');
    if (image) fd.append('image', image, image.name);

    btn.disabled = true;
    try {
      await F.api(`${apiBase}/posts`, { method: 'POST', body: fd });
      form.reset();
      F.toast('管理帖发布成功', 'success');
      await loadOverview(false);
    } catch (err) {
      msg.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    try {
      await F.api(`${apiBase}/logout`, { method: 'POST' });
    } catch (err) {
      // 会话可能已失效，忽略即可
    }
    showLogin();
  }

  async function init() {
    $('loginForm').addEventListener('submit', submitLogin);
    $('logoutBtn').addEventListener('click', logout);
    $('settingsForm').addEventListener('submit', submitSettings);
    $('coverForm').addEventListener('submit', submitCover);
    $('coverRemoveBtn').addEventListener('click', removeCover);
    $('addBoardBtn').addEventListener('click', addBoard);
    $('adminPostForm').addEventListener('submit', submitAdminPost);
    $('refreshBtn').addEventListener('click', () => loadOverview(true).catch((err) => F.toast(err.message, 'error')));
    $('postFilter').addEventListener('input', renderPostTable);

    try {
      await F.api(`${apiBase}/me`);
      showDashboard();
      await loadOverview(false);
    } catch (err) {
      showLogin();
    }
  }

  init();
})();
