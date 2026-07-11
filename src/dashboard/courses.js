/** Dashboard courses — render, expand/collapse, delete */


function refreshCourses() {
  sendMessage({ type: 'GET_COURSES' }).then(function (r) {
    if (!r.ok || !r.courses) return;
    coursesCache = r.courses;
    renderCourses(coursesCache);
  });
}


function renderCourses(courses) {
  var list = $('#courses-list');
  var empty = $('#courses-empty');
  var cnt = $('#courses-count');

  if (!courses || courses.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    cnt.textContent = '共 0 门课程';
    return;
  }
  empty.classList.add('hidden');
  cnt.textContent = '共 ' + courses.length + ' 门课程';

  var html = '';
  courses.forEach(function (c) {
    var total = c.totalVideos || 0;
    var completed = c.completedVideos || 0;
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    var tag = c.source === 'manual' ? '手动' : '合集';
    var totalDur = (c.totalDurationSec || 0) > 0 ? ' · ' + formatDurationClock(c.totalDurationSec) : '';

    html +=
      '<div class="course-card" data-course-id="' + c.id + '">' +
        '<button class="course-edit-btn" data-course-id="' + c.id + '" title="编辑课程">&#9998;</button>' +
        '<button class="course-delete-btn" data-course-id="' + c.id + '" title="删除课程">&times;</button>' +
        '<div class="course-card-header">' +
          '<span class="course-card-title">' + escapeHTML(c.title) +
            ' <span class="course-source-tag">' + tag + '</span></span>' +
          '<span class="course-card-count">' + completed + '/' + total + '</span>' +
        '</div>' +
        '<div class="course-card-meta">上次学习: ' + formatTime(c.lastPlayedAt || c.updatedAt) +
          (totalDur ? ' <span class="meta-duration">' + totalDur + '</span>' : '') + '</div>' +
        '<div class="course-card-progress"><div class="course-card-progress-bar" style="width:' + pct + '%"></div></div>' +
        '<div class="course-card-pct">' + pct + '% &middot; ' + total + ' 个视频' + '</div>' +
        '<div class="video-list" id="vl-' + c.id + '"></div>' +
      '</div>';
  });
  list.innerHTML = html;

  $$('.course-card').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('.course-delete-btn') || e.target.closest('.course-edit-btn')) return;
      toggleVideos(card, parseInt(card.dataset.courseId));
    });
  });

  $$('.course-delete-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var cid = parseInt(btn.dataset.courseId);
      if (confirm('确定要删除这门课程及其所有视频记录吗？')) {
        sendMessage({ type: 'REMOVE_COURSE', payload: { courseId: cid } }).then(function (r) {
          showToast(r.ok ? '课程已删除' : '删除失败');
          if (r.ok) refreshAll();
        });
      }
    });
  });

  $$('.course-edit-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var cid = parseInt(btn.dataset.courseId);
      var course = coursesCache.find(function (c) { return c.id === cid; });
      if (course) showEditCourseModal(course);
    });
  });
}


function toggleVideos(card, courseId) {
  var vl = card.querySelector('.video-list');
  if (vl.classList.contains('open')) { vl.classList.remove('open'); return; }
  if (vl.dataset.loaded) { vl.classList.add('open'); return; }

  sendMessage({ type: 'GET_COURSE_DETAIL', payload: { courseId: courseId } }).then(function (r) {
    if (!r.ok || !r.videos) return;
    var videos = r.videos;
    var totalSec = 0;
    var html = '';
    videos.forEach(function (v, idx) {
      var done = v.completed;
      var pct = v.progressPercent || 0;
      var sClass = done ? 'completed' : (pct > 0 ? 'watching' : '');
      var sText = done ? '✅' : (pct > 0 ? Math.round(pct) + '%' : '0%');
      var dur = v.duration > 0 ? ' · ' + formatDurationClock(v.duration) : '';
      totalSec += v.duration || 0;

      html +=
        '<div class="video-item" data-bvid="' + v.bvid + '" data-cid="' + (v.cid || '') + '">' +
          '<span class="video-index">' + (idx + 1) + '</span>' +
          '<div class="video-info">' +
            '<div class="video-title">' + escapeHTML(v.title || v.bvid) + dur + '</div>' +
            '<div class="video-progress-mini"><div class="video-progress-mini-bar' + (done ? ' completed' : '') + '" style="width:' + pct + '%"></div></div>' +
          '</div>' +
          '<span class="video-status ' + sClass + '">' + sText + '</span>' +
        '</div>';
    });
    vl.innerHTML = html;
    vl.dataset.loaded = '1';
    vl.classList.add('open');

    var meta = card.querySelector('.course-card-meta');
    var durSpan = meta ? meta.querySelector('.meta-duration') : null;
    if (meta && totalSec > 0 && !durSpan) {
      var existing = meta.innerHTML;
      meta.innerHTML = existing + ' <span class="meta-duration">· ' + formatDurationClock(totalSec) + '</span>';
    }

    vl.querySelectorAll('.video-item').forEach(function (item) {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        chrome.tabs.create({ url: 'https://www.bilibili.com/video/' + item.dataset.bvid });
      });
    });
  });
}
