/** Dashboard main — entry, connection, global utilities */

var port = null;
var coursesCache = [];
var timePrecision = 'minutes';
var nowPlayingHideTimer = null;
var reconnectDelay = 1000;
var reconnectTimer = null;

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function sendMessage(msg) {
  return new Promise(function (resolve) {
    chrome.runtime.sendMessage(msg, function (resp) {
      resolve(chrome.runtime.lastError ? { error: String(chrome.runtime.lastError.message) } : (resp || {}));
    });
  });
}

function showToast(text) {
  var t = $('#toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.classList.add('hidden'); }, 2500);
}

function closeAllModals() {
  $$('.modal').forEach(function (m) { m.classList.add('hidden'); });
}

function downloadBlob(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}


/* ================================================================
   CONNECTION
   ================================================================ */

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'dashboard' });
    reconnectDelay = 1000;
    port.onMessage.addListener(function (msg) {
      if (msg.type === 'PROGRESS_PUSH') handleProgressPush(msg.payload);
      else if (msg.type === 'COURSE_UPDATED') handleCourseUpdated(msg.payload);
      else if (msg.type === 'COURSE_SYNCED') refreshAll();
      else if (msg.type === 'COURSE_REMOVED') refreshAll();
    });
    port.onDisconnect.addListener(function () {
      port = null;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });
  } catch (e) {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  }
}


/* ================================================================
   PUSH HANDLERS — Real-time update without full re-render
   ================================================================ */

function handleProgressPush(p) {
  showNowPlaying(p);

  var videoItem = null;
  var totalItems = document.querySelectorAll('.video-item').length;

  if (p.bvid) {
    if (p.cid) {
      videoItem = document.querySelector('.video-item[data-bvid="' + p.bvid + '"][data-cid="' + p.cid + '"]');
    }
    if (!videoItem) {
      videoItem = document.querySelector('.video-item[data-bvid="' + p.bvid + '"][data-cid=""]');
    }
    if (!videoItem) {
      var candidates = document.querySelectorAll('.video-item[data-bvid="' + p.bvid + '"]');
      if (candidates.length === 1) {
        videoItem = candidates[0];
      } else if (candidates.length > 1 && p.videoTitle) {
        for (var ci = 0; ci < candidates.length; ci++) {
          var titleEl = candidates[ci].querySelector('.video-title');
          if (titleEl) {
            var domTitle = titleEl.textContent.replace(/ · .*$/, '').trim();
            if (domTitle === p.videoTitle) { videoItem = candidates[ci]; break; }
          }
        }
        if (!videoItem) {
          for (var cj = 0; cj < candidates.length; cj++) {
            var tel = candidates[cj].querySelector('.video-title');
            if (tel && tel.textContent.indexOf(p.videoTitle) >= 0) { videoItem = candidates[cj]; break; }
          }
        }
      }
    }
  }

  if (videoItem) {
    if (p.cid) videoItem.setAttribute('data-cid', String(p.cid));

    var vs = videoItem.querySelector('.video-status');
    var mb = videoItem.querySelector('.video-progress-mini-bar');
    var pct = Math.round(p.progressPercent || 0);
    if (vs) {
      vs.textContent = p.completed ? '✅' : pct + '%';
      vs.className = 'video-status' + (p.completed ? ' completed' : (pct > 0 ? ' watching' : ''));
    }
    if (mb) {
      mb.style.width = pct + '%';
      if (p.completed) mb.classList.add('completed');
      else mb.classList.remove('completed');
    }
    console.log('[BT] updated pct=' + pct + '% candidates=' + totalItems);
  } else {
    console.log('[BT] NO match bvid=' + p.bvid + ' cid=' + p.cid + ' totalItems=' + totalItems);
  }

  if (p.paused) {
    if (nowPlayingHideTimer) clearTimeout(nowPlayingHideTimer);
    nowPlayingHideTimer = setTimeout(function () {
      var zone = $('#now-playing-zone');
      if (zone) zone.classList.add('hidden');
    }, 10000);
  } else {
    if (nowPlayingHideTimer) { clearTimeout(nowPlayingHideTimer); nowPlayingHideTimer = null; }
  }

  refreshStats();
}

function showNowPlaying(p) {
  var zone = $('#now-playing-zone');
  if (!zone) return;
  zone.classList.remove('hidden');

  $('#np-title').textContent = p.videoTitle || '正在播放...';
  $('#np-bar').style.width = Math.round(p.progressPercent || 0) + '%';
  $('#np-time').textContent = formatDurationClock(p.currentTime || 0) + ' / ' + formatDurationClock(p.duration || 0);

  var course = coursesCache.find(function (c) { return c.id === p.courseId; });
  if (course) {
    $('#np-course').textContent = '· ' + course.title;
    $('#np-course').classList.remove('hidden');
  } else {
    $('#np-course').classList.add('hidden');
  }
}

function handleCourseUpdated(p) {
  var card = document.querySelector('.course-card[data-course-id="' + p.courseId + '"]');
  if (card) {
    var bar = card.querySelector('.course-card-progress-bar');
    var pct = p.totalVideos > 0 ? Math.round((p.completedVideos / p.totalVideos) * 100) : 0;
    if (bar) bar.style.width = pct + '%';
    var pctEl = card.querySelector('.course-card-pct');
    if (pctEl) pctEl.textContent = pct + '% (' + p.completedVideos + '/' + p.totalVideos + ')';
    var meta = card.querySelector('.course-card-meta');
    if (meta && p.lastPlayedAt) {
      var durSpan = meta.querySelector('.meta-duration');
      var durText = durSpan ? durSpan.textContent : '';
      meta.innerHTML = '上次学习: ' + formatTime(p.lastPlayedAt) + (durText ? ' <span class="meta-duration">' + durText + '</span>' : '');
    }
  }
}


/* ================================================================
   REFRESH ALL
   ================================================================ */

function refreshAll() {
  refreshCourses();
  refreshStats();
}

function loadAll() {
  refreshCourses();
  refreshStats();
  loadSettings();
}


/* ================================================================
   WINDOW BOUNDS
   ================================================================ */

function saveBounds() {
  sendMessage({ type: 'SAVE_WINDOW_BOUNDS', payload: { width: window.outerWidth, height: window.outerHeight, left: window.screenX, top: window.screenY } });
}
var boundsTimer = null;
window.addEventListener('resize', function () { clearTimeout(boundsTimer); boundsTimer = setTimeout(saveBounds, 1000); });
window.addEventListener('beforeunload', saveBounds);


/* ================================================================
   INIT
   ================================================================ */

document.addEventListener('DOMContentLoaded', function () {
  connect();
  loadAll();

  $('#btn-identify').addEventListener('click', startIdentify);
  $('#btn-new-course').addEventListener('click', showNewCourseModal);
  $('#btn-refresh').addEventListener('click', function () {
    var btn = $('#btn-refresh');
    btn.classList.add('spinning');
    loadAll();
    setTimeout(function () { btn.classList.remove('spinning'); }, 600);
  });

  $('#btn-menu').addEventListener('click', function () { $('#dropdown-menu').classList.toggle('hidden'); });
  document.addEventListener('click', function (e) { if (!e.target.closest('#menu-dropdown')) $('#dropdown-menu').classList.add('hidden'); });
  $$('#dropdown-menu a[data-action]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      e.preventDefault();
      $('#dropdown-menu').classList.add('hidden');
      var act = a.dataset.action;
      if (act === 'settings') { $('#modal-settings').classList.remove('hidden'); loadSettings(); }
      else if (act === 'import') { $('#modal-import').classList.remove('hidden'); }
      else if (act === 'export-json') exportJSON();
      else if (act === 'export-csv') exportCSV();
      else if (act === 'clear') clearAllData();
    });
  });

  $$('.modal-backdrop').forEach(function (bd) { bd.addEventListener('click', closeAllModals); });

  $('#search-input').addEventListener('input', function () {
    var q = this.value.toLowerCase();
    renderCourses(coursesCache.filter(function (c) { return c.title.toLowerCase().indexOf(q) >= 0; }));
  });

  setupFileImport();
});
