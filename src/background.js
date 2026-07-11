importScripts(
  'lib/constants.js', 'lib/db.js', 'lib/format.js',
  'lib/stats.js', 'lib/tracker.js', 'lib/export.js'
);

const DEFAULT_THRESHOLD = 98;
const DEFAULT_POLL_SEC = 5;

var settingsCache = {};
var dashboardPorts = [];
var dashboardWindowId = null;

initSettings();

async function initSettings() {
  settingsCache.threshold = DEFAULT_THRESHOLD;
  settingsCache.pollInterval = DEFAULT_POLL_SEC;
  settingsCache.timePrecision = 'minutes';
  var t = await getByKey('settings', 'threshold');
  if (t) settingsCache.threshold = t.value;
  var p = await getByKey('settings', 'pollInterval');
  if (p) settingsCache.pollInterval = p.value;
  var tp = await getByKey('settings', 'timePrecision');
  if (tp) settingsCache.timePrecision = tp.value;
}


/* ================================================================
   DASHBOARD WINDOW MANAGEMENT
   ================================================================ */

chrome.action.onClicked.addListener(async function () {
  if (dashboardWindowId !== null) {
    try {
      await chrome.windows.get(dashboardWindowId);
      await chrome.windows.remove(dashboardWindowId);
    } catch (e) {
      console.warn('[BT-SW] window remove failed:', e.message);
    }
    dashboardWindowId = null;
    return;
  }
  var saved = await getByKey('settings', 'windowBounds');
  var b = saved ? saved.value : {};
  var win = await chrome.windows.create({
    url: 'src/dashboard/dashboard.html',
    type: 'popup',
    width: b.width || 1000,
    height: b.height || 700,
    left: b.left,
    top: b.top
  });
  dashboardWindowId = win.id;
});

chrome.windows.onRemoved.addListener(function (id) {
  if (id === dashboardWindowId) dashboardWindowId = null;
});


/* ================================================================
   REAL-TIME PUSH TO DASHBOARD
   ================================================================ */

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'dashboard') return;
  dashboardPorts.push(port);
  console.log('[BT-SW] Dashboard connected, total ports=' + dashboardPorts.length);
  port.onDisconnect.addListener(function () {
    dashboardPorts = dashboardPorts.filter(function (p) { return p !== port; });
    console.log('[BT-SW] Dashboard disconnected, total ports=' + dashboardPorts.length);
  });
});

function pushDashboard(data) {
  dashboardPorts.forEach(function (p) {
    try { p.postMessage(data); } catch (e) {
      console.warn('[BT-SW] pushDashboard failed:', e.message);
    }
  });
}


/* ================================================================
   MESSAGE ROUTER
   ================================================================ */

chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
  handleMessage(msg, sender).then(respond).catch(function (e) {
    console.warn('[BT-SW] handleMessage error:', e.message);
    respond({ error: e.message });
  });
  return true;
});

function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'REPORT_PROGRESS':       return onReportProgress(msg.payload);
    case 'SYNC_COLLECTION':       return onSyncCollection(msg.payload);
    case 'GET_COURSES':           return onGetCourses();
    case 'GET_COURSE_DETAIL':     return onGetCourseDetail(msg.payload);
    case 'GET_STATS':             return onGetStats();
    case 'GET_STREAK':            return onGetStreak();
    case 'CREATE_MANUAL_COURSE':  return onCreateManualCourse(msg.payload);
    case 'EDIT_COURSE':           return onEditCourse(msg.payload);
    case 'ADD_VIDEOS_TO_COURSE':  return onAddVideos(msg.payload);
    case 'REMOVE_COURSE':         return onRemoveCourse(msg.payload);
    case 'RESET_PROGRESS':        return onResetProgress(msg.payload);
    case 'GET_SETTINGS':          return onGetSettings();
    case 'UPDATE_SETTING':        return onUpdateSetting(msg.payload);
    case 'EXPORT_JSON':           return onExportJSON();
    case 'IMPORT_JSON_FILE':      return onImportJSON(msg.payload);
    case 'EXPORT_CSV':            return onExportCSV();
    case 'SAVE_WINDOW_BOUNDS':    return onSaveBounds(msg.payload);
    case 'CLEAR_ALL':             return onClearAll();
    case 'IDENTIFY_ACTIVE_TAB':   return onIdentifyActiveTab();
    default:                      return Promise.resolve({ error: 'Unknown message type' });
  }
}


/* ================================================================
   HANDLERS — PROGRESS
   ================================================================ */

async function onReportProgress(p) {
  var bvid = p.bvid, cid = p.cid, title = p.title, duration = p.duration;
  var currentTime = p.currentTime, progressPercent = p.progressPercent;
  var playbackRate = p.playbackRate, coverUrl = p.coverUrl;
  var ownerName = p.ownerName, ownerMid = p.ownerMid, aid = p.aid;
  var paused = p.paused || false;
  var timestamp = p.timestamp || Date.now();

  if (!bvid) return { ok: false };

  var existingList = await getByIndex('videos', 'bvid', bvid) || [];
  var video = null;
  var oldLastReported = 0;

  if (existingList.length > 0) {
    if (cid != null) {
      video = existingList.find(function (v) { return v.cid === cid; });
      if (!video) {
        var placeholder = existingList.find(function (v) { return !v.cid || v.cid === 0; });
        if (placeholder) { video = placeholder; video.cid = cid; }
      }
    }
    if (!video && title && existingList.length > 1) {
      video = existingList.find(function (v) { return v.title && v.title === title; });
    }
    if (!video) video = existingList[0];

    if (video) {
      oldLastReported = (video.lastReportedTime !== undefined && video.lastReportedTime !== null)
        ? video.lastReportedTime
        : (video.currentTime || 0);

      if (currentTime > 0 && !isNaN(currentTime)) {
        video.currentTime = Math.max(video.currentTime || 0, currentTime);
        video.progressPercent = progressPercent > 0
          ? Math.max(video.progressPercent || 0, progressPercent)
          : calcProgressPercent(video.currentTime, duration || video.duration);
      }
      video.lastPlayedAt = timestamp;
      video.updatedAt = timestamp;
      if (duration > 0)  video.duration = duration;
      if (title)         video.title = title;
      if (coverUrl)      video.coverUrl = coverUrl;
      if (ownerName)     video.ownerName = ownerName;
      if (ownerMid)      video.ownerMid = ownerMid;
    }
  }

  if (!video) {
    var courseRef = existingList.length > 0
      ? existingList.find(function (v) { return v.courseId && v.courseId > 0; })
      : null;
    video = {
      courseId: courseRef ? courseRef.courseId : 0,
      bvid: bvid, aid: aid || 0, cid: cid || null,
      title: title || '', duration: duration || 0,
      currentTime: currentTime || 0, progressPercent: progressPercent || 0,
      completed: false, watchCount: 1,
      lastPlayedAt: timestamp, updatedAt: timestamp,
      lastReportedTime: currentTime || 0
    };
  }

  if ((!video.courseId || video.courseId === 0) && existingList.length > 0) {
    var ref = existingList.find(function (v) { return v.courseId && v.courseId > 0; });
    if (ref) video.courseId = ref.courseId;
  }

  var thr = settingsCache.threshold || DEFAULT_THRESHOLD;
  var wasCompleted = video.completed;
  video.completed = isVideoCompleted(video.progressPercent, thr);
  video.lastReportedTime = currentTime;
  await put('videos', video);

  if (video.courseId && video.courseId > 0) {
    await updateCourseCounts(video.courseId);
  }

  var rate = playbackRate && playbackRate > 0 ? playbackRate : 1;
  var pollSec = settingsCache.pollInterval || DEFAULT_POLL_SEC;
  var maxNormalDelta = pollSec * rate * 2 + 5;
  var addedSec = 0;
  if (currentTime > 0 && oldLastReported >= 0) {
    var delta = currentTime - oldLastReported;
    if (delta > 0 && !shouldSkipProgressUpdate(oldLastReported, currentTime, maxNormalDelta)) {
      addedSec = Math.round(delta / rate);
    }
  }
  await updateDailyStats(
    { getFirstByIndex: getFirstByIndex, put: put, getAll: getAll },
    addedSec,
    video.completed && !wasCompleted ? 1 : 0,
    bvid
  );

  pushDashboard({
    type: 'PROGRESS_PUSH',
    payload: {
      bvid: bvid, cid: cid, courseId: video.courseId, videoTitle: video.title,
      currentTime: video.currentTime, progressPercent: video.progressPercent,
      completed: video.completed, duration: video.duration,
      paused: paused, lastPlayedAt: timestamp
    }
  });
  console.log('[BT-SW] pushDashboard PROGRESS_PUSH courseId=' + video.courseId + ' title="' + (video.title || '') + '" cid=' + cid + ' paused=' + paused);

  return { ok: true };
}


async function updateCourseCounts(courseId) {
  var course = await getOne('courses', courseId);
  if (!course) return;
  var allVideos = await getByIndex('videos', 'courseId', courseId);
  course.completedVideos = allVideos.filter(function (v) { return v.completed; }).length;
  course.totalVideos = allVideos.length;
  course.totalDurationSec = allVideos.reduce(function (sum, v) { return sum + (v.duration || 0); }, 0);
  var latestPlay = 0;
  allVideos.forEach(function (v) { if ((v.lastPlayedAt || 0) > latestPlay) latestPlay = v.lastPlayedAt; });
  if (latestPlay > 0) course.lastPlayedAt = latestPlay;
  course.updatedAt = Date.now();
  await put('courses', course);
  pushDashboard({ type: 'COURSE_UPDATED', payload: {
    courseId: courseId, completedVideos: course.completedVideos,
    totalVideos: course.totalVideos, totalDurationSec: course.totalDurationSec,
    lastPlayedAt: course.lastPlayedAt || course.updatedAt
  }});
}


/* ================================================================
   HANDLERS — COURSES
   ================================================================ */

async function onSyncCollection(p) {
  var collectionId = p.collectionId, title = p.title, videos = p.videos;
  var coverUrl = p.coverUrl, upMid = p.upMid;
  if (!collectionId && !title) return { ok: false, error: 'Need collectionId or title' };

  var course = null, wasNew = false;
  if (collectionId > 0) {
    var exist = await getByIndex('courses', 'collectionId', collectionId);
    if (exist && exist.length > 0) {
      course = exist[0];
      course.title = title || course.title;
      if (coverUrl) course.coverUrl = coverUrl;
    }
  }

  if (!course && collectionId === 0 && title) {
    var all = await getAll('courses');
    var dup = all.find(function (c) { return c.title === title && c.source === 'manual'; });
    if (dup) course = dup;
  }

  if (!course) {
    wasNew = true;
    course = {
      source: collectionId > 0 ? 'collection' : 'manual',
      collectionId: collectionId || 0, title: title || '',
      coverUrl: coverUrl || '', upId: upMid || 0,
      bvidList: [], totalVideos: 0, completedVideos: 0, totalDurationSec: 0,
      createdAt: Date.now(), updatedAt: Date.now()
    };
  }

  var courseId = course.id;
  var existingVids = courseId ? await getByIndex('videos', 'courseId', courseId) : [];
  if (!courseId) course.id = await put('courses', course);
  else await put('courses', course);

  var vidMap = {};
  existingVids.forEach(function (v) {
    vidMap[v.bvid + '_' + (v.cid || 0)] = true;
  });

  var newAdded = false;
  var bvidList = [];
  for (var i = 0; i < (videos || []).length; i++) {
    var v = videos[i];
    bvidList.push(v.bvid);
    var key = v.bvid + '_' + (v.cid || 0);
    if (vidMap[key]) continue;
    newAdded = true;

    var orphans = await getByIndex('videos', 'bvid', v.bvid);
    if (orphans && orphans.length > 0) {
      var orph = v.cid
        ? orphans.find(function (o) { return o.cid === v.cid && (!o.courseId || o.courseId === 0); })
        : orphans.find(function (o) { return (!o.courseId || o.courseId === 0); });
      if (orph) {
        orph.courseId = course.id;
        if (v.title) orph.title = v.title;
        if (v.duration) orph.duration = v.duration;
        if (v.cid) orph.cid = v.cid;
        orph.updatedAt = Date.now();
        await put('videos', orph);
        continue;
      }
    }
    await put('videos', {
      courseId: course.id, bvid: v.bvid, aid: v.aid || 0, cid: v.cid || null,
      title: v.title || '', duration: v.duration || 0,
      currentTime: 0, progressPercent: 0, completed: false, watchCount: 0,
      lastPlayedAt: 0, updatedAt: Date.now(), lastReportedTime: 0
    });
  }

  course.bvidList = bvidList.filter(function (b, i, a) { return a.indexOf(b) === i; });
  var courseVids = await getByIndex('videos', 'courseId', course.id);
  course.totalVideos = courseVids.length;
  course.completedVideos = courseVids.filter(function (v) { return v.completed; }).length;
  course.totalDurationSec = courseVids.reduce(function (sum, v) { return sum + (v.duration || 0); }, 0);
  if (newAdded) course.updatedAt = Date.now();
  await put('courses', course);

  pushDashboard({ type: 'COURSE_SYNCED', payload: { course: course, wasNew: wasNew } });
  return { ok: true, course: course };
}


async function onGetCourses() {
  var courses = await getAll('courses');
  courses.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
  return { ok: true, courses: courses };
}


async function onGetCourseDetail(p) {
  var course = await getOne('courses', p.courseId);
  if (!course) return { ok: false };
  var videos = await getByIndex('videos', 'courseId', p.courseId);
  var bvidList = course.bvidList || [];
  videos.sort(function (a, b) {
    var idxA = bvidList.indexOf(a.bvid);
    var idxB = bvidList.indexOf(b.bvid);
    if (idxA >= 0 && idxB >= 0) return idxA - idxB;
    if (idxA >= 0) return -1;
    if (idxB >= 0) return 1;
    if (a.bvid === b.bvid) return (a.cid || 0) - (b.cid || 0);
    return (a.id || 0) - (b.id || 0);
  });
  return { ok: true, course: course, videos: videos };
}


async function onCreateManualCourse(p) {
  var title = p.title, bvidList = (p.bvidList || []).filter(function (b, i, a) { return a.indexOf(b) === i; });
  if (!title) return { ok: false };
  var now = Date.now();
  var course = {
    source: 'manual', collectionId: 0, title: title, coverUrl: '', upId: 0,
    bvidList: bvidList, totalVideos: bvidList.length, completedVideos: 0,
    totalDurationSec: 0, createdAt: now, updatedAt: now
  };
  course.id = await put('courses', course);
  for (var i = 0; i < bvidList.length; i++) {
    var bv = bvidList[i];
    var ex = await getByIndex('videos', 'bvid', bv);
    var adoptable = ex && ex.length > 0
      ? ex.find(function (v) { return (!v.courseId || v.courseId === 0) && (!v.cid || v.cid === 0); })
      : null;
    if (adoptable) {
      adoptable.courseId = course.id;
      adoptable.updatedAt = now;
      await put('videos', adoptable);
    } else {
      await put('videos', {
        courseId: course.id, bvid: bv, aid: 0, cid: null,
        title: '', duration: 0, currentTime: 0, progressPercent: 0,
        completed: false, watchCount: 0, lastPlayedAt: 0, updatedAt: now,
        lastReportedTime: 0
      });
    }
  }
  await updateCourseCounts(course.id);
  pushDashboard({ type: 'COURSE_SYNCED', payload: { course: course, wasNew: true } });
  return { ok: true, course: course };
}


async function onEditCourse(p) {
  var course = await getOne('courses', p.courseId);
  if (!course) return { ok: false, error: 'Course not found' };

  if (p.title) course.title = p.title;

  if (p.bvidList) {
    var newBvidList = p.bvidList;
    var oldVideos = await getByIndex('videos', 'courseId', course.id);
    oldVideos.sort(function (a, b) { return (a.id || 0) - (b.id || 0); });

    for (var i = 0; i < Math.min(oldVideos.length, newBvidList.length); i++) {
      if (oldVideos[i].bvid !== newBvidList[i]) {
        oldVideos[i].bvid = newBvidList[i];
        oldVideos[i].updatedAt = Date.now();
        await put('videos', oldVideos[i]);
      }
    }

    for (var j = oldVideos.length; j < newBvidList.length; j++) {
      await put('videos', {
        courseId: course.id, bvid: newBvidList[j], aid: 0, cid: null,
        title: '', duration: 0, currentTime: 0, progressPercent: 0,
        completed: false, watchCount: 0, lastPlayedAt: 0, updatedAt: Date.now(),
        lastReportedTime: 0
      });
    }

    for (var k = newBvidList.length; k < oldVideos.length; k++) {
      await deleteOne('videos', oldVideos[k].id);
    }

    course.bvidList = newBvidList;
  }

  course.updatedAt = Date.now();
  await put('courses', course);
  await updateCourseCounts(course.id);
  pushDashboard({ type: 'COURSE_SYNCED', payload: { course: course, wasNew: false } });
  return { ok: true, course: course };
}


async function onAddVideos(p) {
  var course = await getOne('courses', p.courseId);
  if (!course) return { ok: false };
  var now = Date.now();
  for (var i = 0; i < (p.bvidList || []).length; i++) {
    var bv = p.bvidList[i], ci = p.cidList ? p.cidList[i] : null;
    var ex = await getByIndex('videos', 'bvid', bv);
    var m = null;
    if (ex && ex.length > 0) {
      if (ci) {
        m = ex.find(function (v) { return v.cid === ci; });
        if (!m) m = ex.find(function (v) { return (!v.courseId || v.courseId === 0) && (!v.cid || v.cid === 0); });
      } else {
        m = ex.find(function (v) { return (!v.courseId || v.courseId === 0); });
      }
    }
    if (m && (!m.courseId || m.courseId === 0)) {
      m.courseId = course.id;
      if (ci) m.cid = ci;
      m.updatedAt = now;
      await put('videos', m);
    } else if (!m) {
      await put('videos', {
        courseId: course.id, bvid: bv, aid: 0, cid: ci || null,
        title: '', duration: 0, currentTime: 0, progressPercent: 0,
        completed: false, watchCount: 0, lastPlayedAt: 0, updatedAt: now,
        lastReportedTime: 0
      });
    }
  }
  course.bvidList = (course.bvidList || []).concat(p.bvidList || []).filter(function (b, i, a) { return a.indexOf(b) === i; });
  course.updatedAt = now;
  await put('courses', course);
  await updateCourseCounts(course.id);
  return { ok: true };
}


async function onRemoveCourse(p) {
  await deleteByIndex('videos', 'courseId', p.courseId);
  await deleteOne('courses', p.courseId);
  pushDashboard({ type: 'COURSE_REMOVED', payload: { courseId: p.courseId } });
  return { ok: true };
}


async function onResetProgress(p) {
  var list = await getByIndex('videos', 'bvid', p.bvid);
  if (!list || list.length === 0) return { ok: false };
  var v = p.cid ? list.find(function (x) { return x.cid === p.cid; }) : list[0];
  if (!v) v = list.find(function (x) { return !x.cid || x.cid === 0; }) || list[0];
  if (!v) return { ok: false };
  v.currentTime = 0;
  v.progressPercent = 0;
  v.completed = false;
  v.lastReportedTime = 0;
  v.updatedAt = Date.now();
  await put('videos', v);
  if (v.courseId) await updateCourseCounts(v.courseId);
  return { ok: true };
}


/* ================================================================
   HANDLERS — STATS
   ================================================================ */

async function onGetStats() {
  var streak = await getStreak({ getAll: getAll });
  var today = await getTodayStats({ getFirstByIndex: getFirstByIndex });
  return {
    ok: true,
    today: today || { date: getDateStr(Date.now()), totalSeconds: 0, videoCount: 0, completedCount: 0, courseCount: 0 },
    streak: streak
  };
}

async function onGetStreak() {
  return { ok: true, streak: await getStreak({ getAll: getAll }) };
}


/* ================================================================
   HANDLERS — SETTINGS
   ================================================================ */

async function onGetSettings() {
  var all = await getAll('settings');
  var s = {}; all.forEach(function (x) { s[x.key] = x.value; });
  if (!s.threshold) s.threshold = DEFAULT_THRESHOLD;
  if (!s.pollInterval) s.pollInterval = DEFAULT_POLL_SEC;
  if (!s.timePrecision) s.timePrecision = 'minutes';
  return { ok: true, settings: s };
}

async function onUpdateSetting(p) {
  await put('settings', { key: p.key, value: p.value });
  if (p.key === 'threshold') {
    settingsCache.threshold = p.value;
    await recomputeCompletedStatus();
  }
  if (p.key === 'pollInterval') {
    settingsCache.pollInterval = p.value;
    broadcastToContentScripts({ type: 'SETTINGS_UPDATED', payload: { pollInterval: p.value } });
  }
  if (p.key === 'timePrecision') {
    settingsCache.timePrecision = p.value;
  }
  return { ok: true };
}

async function recomputeCompletedStatus() {
  var allVideos = await getAll('videos');
  var thr = settingsCache.threshold || DEFAULT_THRESHOLD;
  var affectedCourses = {};
  for (var i = 0; i < allVideos.length; i++) {
    var v = allVideos[i];
    var wasCompleted = v.completed;
    v.completed = isVideoCompleted(v.progressPercent || 0, thr);
    if (v.completed !== wasCompleted) {
      v.updatedAt = Date.now();
      await put('videos', v);
      if (v.courseId && v.courseId > 0) affectedCourses[v.courseId] = true;
    }
  }
  var courseIds = Object.keys(affectedCourses);
  for (var ci = 0; ci < courseIds.length; ci++) {
    await updateCourseCounts(parseInt(courseIds[ci]));
  }
  if (courseIds.length > 0) {
    pushDashboard({ type: 'COURSE_SYNCED', payload: { course: null, wasNew: false } });
  }
}

function broadcastToContentScripts(msg) {
  chrome.tabs.query({ url: '*://*.bilibili.com/*' }, function (tabs) {
    if (!tabs) return;
    tabs.forEach(function (tab) {
      try { chrome.tabs.sendMessage(tab.id, msg); } catch (e) {}
    });
  });
}

async function onSaveBounds(p) {
  await put('settings', { key: 'windowBounds', value: p });
  return { ok: true };
}


/* ================================================================
   HANDLERS — EXPORT / IMPORT
   ================================================================ */

async function onExportJSON() {
  var json = await exportAsJSON({ getAll: getAll, getByIndex: getByIndex, getOne: getOne, put: put });
  return { ok: true, data: json, filename: 'bilibili-tracker-' + getDateStr() + '.json' };
}

async function onImportJSON(p) {
  if (!p || !p.version) return { ok: false, error: 'invalid file' };

  var courseIdMap = {};

  for (var i = 0; i < (p.courses || []).length; i++) {
    var c = p.courses[i];
    var oldId = c.id;
    var existing = null;
    if (c.collectionId && c.collectionId > 0) {
      var ex = await getByIndex('courses', 'collectionId', c.collectionId);
      if (ex && ex.length > 0) existing = ex[0];
    }
    if (existing) {
      Object.assign(existing, c, { id: existing.id });
      await put('courses', existing);
      courseIdMap[oldId] = existing.id;
    } else {
      var nc = Object.assign({}, c);
      delete nc.id;
      var newId = await put('courses', nc);
      courseIdMap[oldId] = newId;
    }
  }

  for (var j = 0; j < (p.videos || []).length; j++) {
    var v = p.videos[j];
    var newCourseId = courseIdMap[v.courseId] || v.courseId || 0;
    var ev = await getByIndex('videos', 'bvid', v.bvid);
    var match = null;
    if (ev && ev.length > 0) {
      var vCid = v.cid || 0;
      match = ev.find(function (e) { return (e.cid || 0) === vCid; });
    }
    if (match) {
      Object.assign(match, v, { id: match.id, courseId: newCourseId });
      await put('videos', match);
    } else {
      var nv = Object.assign({}, v, { courseId: newCourseId });
      delete nv.id;
      await put('videos', nv);
    }
  }

  for (var k = 0; k < (p.dailyStats || []).length; k++) {
    var ds = p.dailyStats[k];
    var ed = await getFirstByIndex('daily_stats', 'date', ds.date);
    if (ed) {
      Object.assign(ed, ds, { id: ed.id });
      await put('daily_stats', ed);
    } else {
      var nd = Object.assign({}, ds);
      delete nd.id;
      await put('daily_stats', nd);
    }
  }

  var allCourses = await getAll('courses');
  for (var aci = 0; aci < allCourses.length; aci++) {
    await updateCourseCounts(allCourses[aci].id);
  }

  return { ok: true };
}

async function onExportCSV() {
  var csv = await exportAsCSV({ getAll: getAll });
  return { ok: true, data: csv, filename: 'bilibili-tracker-' + getDateStr() + '.csv' };
}

async function onClearAll() {
  await clearStore('courses');
  await clearStore('videos');
  await clearStore('daily_stats');
  return { ok: true };
}


/* ================================================================
   HANDLERS — IDENTIFY
   ================================================================ */

async function onIdentifyActiveTab() {
  var tabs = await chrome.tabs.query({ url: '*://*.bilibili.com/*' });
  if (!tabs || tabs.length === 0) return { ok: false, error: 'no_tab', message: '没有找到 B 站标签页' };
  tabs.sort(function (a, b) { return (b.lastAccessed || 0) - (a.lastAccessed || 0); });
  var tabId = tabs[0].id;

  for (var attempt = 1; attempt <= 3; attempt++) {
    try {
      var r = await chrome.tabs.sendMessage(tabId, { type: 'IDENTIFY_PAGE' });
      if (r && r.type) return { ok: true, data: r };
    } catch (e) {
      console.warn('[BT-SW] identify attempt ' + attempt + ' failed:', e.message);
    }
    if (attempt < 3) await new Promise(function (rs) { setTimeout(rs, 1000); });
  }

  try {
    var sr = await chrome.scripting.executeScript({ target: { tabId: tabId }, func: identifyFallback });
    if (sr && sr[0] && sr[0].result && sr[0].result.type) return { ok: true, data: sr[0].result };
  } catch (e) {
    console.warn('[BT-SW] identify fallback failed:', e.message);
  }

  return { ok: false, error: 'failed', message: '无法识别，请刷新 B 站页面后重试' };
}

function identifyFallback() {
  var u = location.href, p = location.pathname;
  var bv = (u.match(/BV([a-zA-Z0-9]+)/) || [])[1];
  if (!bv || !/\/video\//.test(p)) return { type: 'unknown' };
  var x = new XMLHttpRequest();
  x.open('GET', 'https://api.bilibili.com/x/web-interface/view?bvid=BV' + bv, false);
  x.withCredentials = true;
  try {
    x.send();
    if (x.status === 200) {
      var j = JSON.parse(x.responseText);
      if (j.code === 0 && j.data) {
        var d = j.data;
        return {
          type: 'video', title: d.title || '', bvid: d.bvid || 'BV' + bv,
          aid: d.aid || 0, ownerName: (d.owner || {}).name || '', ownerMid: (d.owner || {}).mid || 0,
          coverUrl: d.pic || '',
          pages: (d.pages || []).map(function (pg) { return { page: pg.page, part: pg.part || '', cid: pg.cid, duration: pg.duration || 0 }; }),
          pageCount: d.videos || ((d.pages || []).length || 1), totalDuration: d.duration || 0
        };
      }
    }
  } catch (e) {}
  return { type: 'unknown' };
}
