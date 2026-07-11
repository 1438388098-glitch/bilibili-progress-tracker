/** Dashboard modals — identify, new course, settings, import/export */


/* ================================================================
   IDENTIFY + IMPORT
   ================================================================ */

function startIdentify() {
  var prog = $('#identify-progress');
  var res = $('#identify-result');
  prog.classList.remove('hidden');
  res.classList.add('hidden');

  sendMessage({ type: 'IDENTIFY_ACTIVE_TAB' }).then(function (r) {
    prog.classList.add('hidden');
    if (!r.ok) {
      var msg = r.error === 'no_tab' ? '请先在 B 站打开一个合集页或视频页' : (r.message || '识别失败');
      showIdentifyResult(msg, false);
      return;
    }
    var d = r.data;
    if (!d || !d.type) { showIdentifyResult('未能识别当前页面内容', false); return; }
    showIdentifyModal(d);
  });
}

function showIdentifyResult(msg, ok) {
  var el = $('#identify-result');
  el.textContent = msg;
  el.className = 'identify-result ' + (ok ? 'success' : 'error');
  el.classList.remove('hidden');
  clearTimeout(el._timer);
  el._timer = setTimeout(function () { el.classList.add('hidden'); }, 5000);
}

function showIdentifyModal(d) {
  var oldWrapper = $('#identify-select-wrapper');
  if (oldWrapper) oldWrapper.remove();

  if (d.type === 'collection') {
    $('#identify-modal-title').textContent = '发现合集：' + d.title;
    $('#identify-modal-body').textContent = ((d.videos || []).length) + ' 个视频，将创建为课程';
    $('#identify-modal-body').dataset.videos = JSON.stringify(d.videos || []);
    $('#identify-modal-body').dataset.title = d.title;
    $('#identify-modal-body').dataset.collectionId = d.collectionId || 0;
    $('#modal-identify').classList.remove('hidden');

  } else if (d.type === 'video') {
    var pageCount = d.pageCount || ((d.pages || []).length || 1);
    var vList = (d.pages || []).length > 0
      ? d.pages.map(function (pg) { return { bvid: d.bvid, aid: d.aid || 0, title: pg.part || ('P' + pg.page), duration: pg.duration || 0, cid: pg.cid }; })
      : [{ bvid: d.bvid, aid: d.aid || 0, title: d.title || '', duration: d.totalDuration || 0, cid: 0 }];

    if (pageCount > 1) {
      $('#identify-modal-title').textContent = '发现多P视频：' + d.title;
      $('#identify-modal-body').textContent = pageCount + ' 个分P，将创建为课程';
      $('#identify-modal-body').dataset.videos = JSON.stringify(vList);
      $('#identify-modal-body').dataset.title = d.title;
      $('#identify-modal-body').dataset.collectionId = '0';
      $('#modal-identify').classList.remove('hidden');
    } else {
      $('#identify-modal-title').textContent = '当前是视频页';
      $('#identify-modal-body').textContent = '检测到单个视频，是否将 "' + d.title + '" 添加到已有课程？';
      $('#identify-modal-body').dataset.videos = JSON.stringify(vList);
      $('#identify-modal-body').dataset.title = d.title;
      $('#identify-modal-body').dataset.collectionId = '0';
      var selHTML = '<div id="identify-select-wrapper" style="margin-top:8px"><select id="identify-select-course"><option value="">-- 添加到已有课程 --</option></select></div>';
      $('#identify-modal-body').insertAdjacentHTML('afterend', selHTML);
      populateCourseDropdown();
      $('#modal-identify').classList.remove('hidden');
    }
  } else {
    showIdentifyResult('未能识别该页面，请打开 B 站合集页或视频页', false);
  }
}

function populateCourseDropdown() {
  var sel = $('#identify-select-course');
  if (!sel) return;
  coursesCache.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c.id; o.textContent = c.title;
    sel.appendChild(o);
  });
}

document.addEventListener('DOMContentLoaded', function () {
  $('#btn-identify-cancel').addEventListener('click', closeAllModals);
  $('#btn-identify-import').addEventListener('click', function () {
    var b = $('#identify-modal-body');
    var videos = JSON.parse(b.dataset.videos || '[]');
    var title = b.dataset.title || '';
    var colId = parseInt(b.dataset.collectionId) || 0;
    var sel = $('#identify-select-course');
    var courseId = sel ? parseInt(sel.value) : 0;

    closeAllModals();

    if (colId > 0) {
      sendMessage({ type: 'SYNC_COLLECTION', payload: { collectionId: colId, title: title, videos: videos } }).then(function (r) {
        showToast(r.ok ? '课程 "' + title + '" 已导入' : '导入失败');
        if (r.ok) refreshAll();
      });
    } else if (courseId > 0) {
      sendMessage({ type: 'ADD_VIDEOS_TO_COURSE', payload: { courseId: courseId, bvidList: videos.map(function (v) { return v.bvid; }), cidList: videos.map(function (v) { return v.cid; }) } }).then(function (r) {
        showToast(r.ok ? '已添加到课程' : '添加失败');
        if (r.ok) refreshAll();
      });
    } else {
      sendMessage({ type: 'SYNC_COLLECTION', payload: { collectionId: 0, title: title, videos: videos } }).then(function (r) {
        showToast(r.ok ? '课程 "' + title + '" 已创建' : '创建失败');
        if (r.ok) refreshAll();
      });
    }
  });
});


/* ================================================================
   NEW COURSE MODAL
   ================================================================ */

function showNewCourseModal() {
  $('#new-course-title').value = '';
  $('#new-course-bvlist').value = '';
  $('#modal-new-course').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', function () {
  $('#btn-modal-cancel').addEventListener('click', closeAllModals);
  $('#btn-modal-save').addEventListener('click', function () {
    var title = $('#new-course-title').value.trim();
    var raw = $('#new-course-bvlist').value.trim();
    if (!title) { showToast('请输入课程名称'); return; }
    var bvids = raw.split(/[\n,，\s]+/).filter(function (s) { return /^BV[a-zA-Z0-9]+$/i.test(s.trim()); }).map(function (s) { return s.trim(); });
    if (bvids.length === 0) { showToast('请输入有效的 BV 号'); return; }
    sendMessage({ type: 'CREATE_MANUAL_COURSE', payload: { title: title, bvidList: bvids } }).then(function (r) {
      if (r.ok) { closeAllModals(); showToast('课程 "' + title + '" 创建成功'); refreshAll(); }
      else showToast('创建失败');
    });
  });
});


/* ================================================================
   SETTINGS MODAL
   ================================================================ */

var _settingsBound = false;

function loadSettings() {
  sendMessage({ type: 'GET_SETTINGS' }).then(function (r) {
    if (!r.ok) return;
    var s = r.settings || {};
    var thr = s.threshold || 98;
    var pol = s.pollInterval || 5;
    timePrecision = s.timePrecision || 'minutes';

    var slider = $('#setting-threshold');
    if (slider) {
      slider.value = thr;
      $('#threshold-display').textContent = thr + '%';
    }
    var sel = $('#setting-poll-interval');
    if (sel) sel.value = String(pol);
    var prec = $('#setting-time-precision');
    if (prec) prec.value = timePrecision;

    if (!_settingsBound) {
      _settingsBound = true;
      if (slider) {
        slider.addEventListener('input', function () {
          $('#threshold-display').textContent = this.value + '%';
        });
        slider.addEventListener('change', function () {
          sendMessage({ type: 'UPDATE_SETTING', payload: { key: 'threshold', value: parseInt(this.value) } });
        });
      }
      if (sel) {
        sel.addEventListener('change', function () {
          sendMessage({ type: 'UPDATE_SETTING', payload: { key: 'pollInterval', value: parseInt(this.value) } });
        });
      }
      if (prec) {
        prec.addEventListener('change', function () {
          timePrecision = this.value;
          sendMessage({ type: 'UPDATE_SETTING', payload: { key: 'timePrecision', value: this.value } });
          refreshStats();
        });
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', function () {
  $('#btn-settings-close').addEventListener('click', closeAllModals);
  $('#btn-import-close').addEventListener('click', closeAllModals);
});


/* ================================================================
   IMPORT / EXPORT
   ================================================================ */

function setupFileImport() {
  var inp = $('#file-import');
  if (!inp) return;
  inp.addEventListener('change', function () {
    var file = inp.files[0];
    if (!file) return;
    var st = $('#import-status');
    st.classList.remove('hidden', 'success', 'error');
    st.textContent = '正在导入...';
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data.version) throw new Error('无效的备份文件');
        sendMessage({ type: 'IMPORT_JSON_FILE', payload: data }).then(function (r) {
          if (r.ok) { st.className = 'import-status success'; st.textContent = '导入成功！'; refreshAll(); }
          else { st.className = 'import-status error'; st.textContent = '导入失败: ' + (r.error || ''); }
        });
      } catch (er) { st.className = 'import-status error'; st.textContent = '文件解析失败: ' + er.message; }
    };
    reader.readAsText(file);
  });
}

function exportJSON() {
  sendMessage({ type: 'EXPORT_JSON' }).then(function (r) {
    if (r.ok && r.data) {
      downloadBlob(r.data, r.filename || 'bilibili-tracker.json', 'application/json;charset=utf-8');
      showToast('JSON 备份已下载');
    } else showToast('导出失败');
  });
}

function exportCSV() {
  sendMessage({ type: 'EXPORT_CSV' }).then(function (r) {
    if (r.ok && r.data) {
      downloadBlob(r.data, r.filename || 'bilibili-tracker.csv', 'text/csv;charset=utf-8');
      showToast('CSV 表格已下载');
    } else showToast('导出失败');
  });
}

/* ================================================================
   EDIT COURSE MODAL
   ================================================================ */

function showEditCourseModal(course) {
  $('#edit-course-title').value = course.title || '';
  $('#edit-course-bvlist').value = (course.bvidList || []).join('\n');
  $('#modal-edit-course').dataset.courseId = course.id;
  $('#modal-edit-course').classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', function () {
  $('#btn-edit-cancel').addEventListener('click', closeAllModals);
  $('#btn-edit-save').addEventListener('click', function () {
    var title = $('#edit-course-title').value.trim();
    var raw = $('#edit-course-bvlist').value.trim();
    var courseId = parseInt($('#modal-edit-course').dataset.courseId) || 0;
    if (!title) { showToast('请输入课程名称'); return; }
    if (!courseId) { showToast('课程ID无效'); return; }

    var bvids = raw.split(/[\n,，\s]+/).filter(function (s) { return /^BV[a-zA-Z0-9]+$/i.test(s.trim()); }).map(function (s) { return s.trim(); });
    var dedupedBvids = bvids.filter(function (b, i, a) { return a.indexOf(b) === i; });

    sendMessage({
      type: 'EDIT_COURSE',
      payload: { courseId: courseId, title: title, bvidList: dedupedBvids }
    }).then(function (r) {
      if (r.ok) {
        closeAllModals();
        showToast('课程修改已保存');
        refreshAll();
      } else {
        showToast('修改失败: ' + (r.error || ''));
      }
    });
  });
});


function clearAllData() {
  if (confirm('确定要清除所有课程、视频进度和统计数据吗？此操作不可恢复。')) {
    sendMessage({ type: 'CLEAR_ALL' }).then(function () { showToast('所有数据已清除'); refreshAll(); });
  }
}
