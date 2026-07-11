(function () {
  if (window.__bilibiliTrackerInjected) return;
  window.__bilibiliTrackerInjected = true;


  /* ============================================================
     UTILITY
     ============================================================ */

  function findVideoElement() {
    var v = document.querySelector('video');
    if (v) return v;

    function search(root) {
      if (!root) return null;
      if (root.nodeName === 'VIDEO') return root;
      if (root.shadowRoot) {
        var v = search(root.shadowRoot);
        if (v) return v;
      }
      var kids = root.children;
      if (kids) {
        for (var i = 0; i < kids.length; i++) {
          var v = search(kids[i]);
          if (v) return v;
        }
      }
      return null;
    }
    v = search(document.body);
    if (v) return v;
    var hosts = document.querySelectorAll('bpx-player, bwp-video, bpx-video');
    for (var i = 0; i < hosts.length; i++) {
      v = search(hosts[i].shadowRoot);
      if (v) return v;
    }
    return null;
  }

  function parseDuration(str) {
    if (!str) return 0;
    var parts = str.split(':');
    if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    var n = parseFloat(str);
    return isNaN(n) ? 0 : Math.floor(n);
  }

  function getPageType() {
    var p = location.pathname;
    if (/\/video\/BV[a-zA-Z0-9]+/.test(p)) return 'video';
    if (/\/list\/ml\d+/.test(p) || /\/medialist\/play\/ml\d+/.test(p)) return 'collection';
    if (/\/channel\/collectiondetail/.test(p)) return 'collection';
    return 'other';
  }

  function msg(type, payload) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage({ type: type, payload: payload }, function (r) {
          resolve(chrome.runtime.lastError ? { error: String(chrome.runtime.lastError.message) } : (r || {}));
        });
      } catch (e) { resolve({ error: String(e.message) }); }
    });
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    timeoutMs = timeoutMs || 8000;
    return new Promise(function (resolve, reject) {
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); reject(new Error('timeout')); }, timeoutMs);
      var opts = Object.assign({}, options || {}, { signal: controller.signal });
      fetch(url, opts).then(function (r) {
        clearTimeout(timer);
        resolve(r);
      }).catch(function (e) {
        clearTimeout(timer);
        reject(e);
      });
    });
  }


  /* ============================================================
     DATA EXTRACTION
     ============================================================ */

  function extractVideoData() {
    try {
      var state = window.__INITIAL_STATE__;
      if (state && state.videoData) {
        var v = state.videoData;
        var currentCid = null;
        if (state.cid != null) currentCid = state.cid;
        else if (v.cid != null) currentCid = v.cid;
        else if (v.pages && v.pages.length > 0 && v.pages[0].cid != null) currentCid = v.pages[0].cid;
        if (currentCid == null) {
          var testEl = findVideoElement();
          if (testEl && testEl.src) {
            var cidSrcMatch = testEl.src.match(/[?&]cid=(\d+)/);
            if (cidSrcMatch) currentCid = parseInt(cidSrcMatch[1]);
          }
        }
        var titleFromState = v.title || (state.videoData && state.videoData.title);
        var durFromState = v.duration || (state.videoData && state.videoData.duration);

        var videoEl = findVideoElement();
        var title = titleFromState || (videoEl ? (videoEl.getAttribute('data-title') || document.title) : document.title) || '';
        var duration = durFromState || (videoEl ? Math.floor(videoEl.duration || 0) : 0);

        var result = {
          bvid: state.bvid || v.bvid, aid: state.aid || v.aid, cid: currentCid,
          title: title, duration: duration,
          coverUrl: v.pic || '',
          ownerName: v.owner ? v.owner.name : '',
          ownerMid: v.owner ? v.owner.mid : 0,
          pages: (v.pages || []).map(function (pg) {
            return { cid: pg.cid, page: pg.page, part: pg.part || '', duration: pg.duration || 0 };
          })
        };
        console.log('[BT] extractVideoData ok cid=' + currentCid + ' bvid=' + (state.bvid || v.bvid));
        return result;
      }
    } catch (e) {
      console.warn('[BT] extractVideoData: TRY threw', e.message);
    }

    var bvMatch = location.href.match(/BV([a-zA-Z0-9]+)/);
    var bvid = bvMatch ? 'BV' + bvMatch[1] : '';
    if (!bvid) return null;

    var state = window.__INITIAL_STATE__ || {};
    var cid = state.cid != null ? state.cid : (state.videoData && state.videoData.cid != null ? state.videoData.cid : null);
    var videoEl = findVideoElement();
    if (cid == null && videoEl && videoEl.src) {
      var cidMatch = videoEl.src.match(/[?&]cid=(\d+)/);
      if (cidMatch) cid = parseInt(cidMatch[1]);
    }
    console.log('[BT] extractVideoData fallback bvid=' + bvid + ' cid=' + cid + ' hasState=' + !!window.__INITIAL_STATE__ + ' hasVideoData=' + !!(state.videoData));
    return {
      bvid: bvid, aid: 0, cid: cid || null,
      title: document.title || '',
      duration: videoEl ? Math.floor(videoEl.duration || 0) : 0,
      coverUrl: '', ownerName: '', ownerMid: 0, pages: []
    };
  }

  function extractCollectionData() {
    try {
      var state = window.__INITIAL_STATE__;
      if (state) {
        if (state.mediaListInfo && state.mediaListInfo.mediaList && state.mediaListInfo.mediaList.length > 0) {
          var m = state.mediaListInfo;
          return { collectionId: m.id || 0, title: m.title || '', coverUrl: m.cover || '', upName: (m.upper || {}).name || '', upMid: (m.upper || {}).mid || 0, videos: m.mediaList.map(function (it) { return { bvid: it.bvid || '', aid: it.id || 0, title: it.title || '', duration: it.duration || 0 }; }) };
        }
        if (state.sectionInfo && state.sectionInfo.episodes && state.sectionInfo.episodes.length > 0) {
          var s = state.sectionInfo;
          return { collectionId: s.id || 0, title: s.title || '', coverUrl: '', upName: '', upMid: 0, videos: s.episodes.map(function (ep) { return { bvid: ep.bvid || '', aid: ep.aid || 0, title: ep.title || ep.long_title || '', duration: ep.duration || 0 }; }) };
        }
      }
    } catch (e) {}

    var items = document.querySelectorAll('.video-list-item, .video-item');
    var domVideos = [];
    for (var i = 0; i < items.length; i++) {
      var link = items[i].querySelector('a[href*="BV"], a[href*="/video/"]');
      if (!link) continue;
      var bvMatch = (link.getAttribute('href') || '').match(/BV([a-zA-Z0-9]+)/);
      if (!bvMatch) continue;
      var titleEl = items[i].querySelector('.title, .video-title');
      var durEl = items[i].querySelector('.duration, .length');
      domVideos.push({ bvid: 'BV' + bvMatch[1], aid: 0, title: titleEl ? titleEl.textContent.trim() : '', duration: durEl ? parseDuration(durEl.textContent.trim()) : 0 });
    }
    if (domVideos.length > 0) {
      var domTitle = document.querySelector('.list-title h1, .media-title, h1.title');
      var mlMatch = location.pathname.match(/ml(\d+)/);
      return { collectionId: mlMatch ? parseInt(mlMatch[1]) : 0, title: domTitle ? domTitle.textContent.trim() : '', coverUrl: '', upName: '', upMid: 0, videos: domVideos };
    }
    return null;
  }


  /* ============================================================
     PLAYER TRACKING
     ============================================================ */

  var videoData = null;
  var pollingTimer = null;
  var pollIntervalSec = 5;
  var lastReportedTime = -1;

  function reportProgress(opts) {
    opts = opts || {};
    var videoEl = findVideoElement();
    if (!videoEl) { waitForVideo(); return; }
    var ct = videoEl.currentTime;
    if (isNaN(ct)) return;
    var rate = videoEl.playbackRate || 1;
    var isPaused = videoEl.paused || videoEl.ended;
    var vidDur = videoEl.duration;

    if (!vidDur || isNaN(vidDur) || vidDur <= 0) return;

    if (!opts.force && lastReportedTime >= 0 && Math.abs(ct - lastReportedTime) < 0.5) return;

    var data = extractVideoData();
    if (!data) {
      if (!videoData || !videoData.bvid) return;
      data = videoData;
    }
    if (!data || !data.bvid) return;

    videoData = data;
    if (data.duration <= 0 && vidDur > 0) data.duration = Math.floor(vidDur);
    var pct = data.duration > 0 ? Math.min(100, (ct / data.duration) * 100) : 0;
    lastReportedTime = ct;

    msg('REPORT_PROGRESS', {
      bvid: data.bvid, aid: data.aid, cid: data.cid, title: data.title,
      duration: data.duration, currentTime: ct, progressPercent: pct,
      playbackRate: rate, coverUrl: data.coverUrl,
      ownerName: data.ownerName, ownerMid: data.ownerMid,
      paused: isPaused, timestamp: Date.now()
    }).catch(function () {});
  }

  function startPolling() {
    stopPolling();
    pollingTimer = setInterval(function () { reportProgress(); }, pollIntervalSec * 1000);
  }

  function stopPolling() {
    if (pollingTimer) { clearInterval(pollingTimer); pollingTimer = null; }
  }

  function setupPlayer(videoEl) {
    if (!videoEl || videoEl.__btListeners) return;
    videoEl.__btListeners = true;

    videoEl.addEventListener('play', function () {
      reportProgress({ force: true });
      startPolling();
    });
    videoEl.addEventListener('pause', function () {
      reportProgress({ force: true });
      stopPolling();
    });
    videoEl.addEventListener('ended', function () {
      reportProgress({ force: true });
      stopPolling();
    });
    videoEl.addEventListener('seeked', function () { reportProgress({ force: true }); });
    videoEl.addEventListener('ratechange', function () { reportProgress(); });
    videoEl.addEventListener('loadedmetadata', function () {
      var data = extractVideoData();
      if (data) {
        videoData = data;
      } else if (videoData) {
        videoData.duration = Math.floor(videoEl.duration || 0);
      }
      if (!videoEl.paused && !pollingTimer) {
        reportProgress({ force: true });
        startPolling();
      }
    });
  }

  function waitForVideo(cb, retries) {
    retries = retries || 0;
    if (retries > 60) { console.warn('[BT] waitForVideo: 60次重试后放弃'); return; }
    var el = findVideoElement();
    if (el) {
      setupPlayer(el);
      if (cb) cb(el);
      if (!el.paused) { reportProgress(); startPolling(); }
    } else {
      setTimeout(function () { waitForVideo(cb, retries + 1); }, 1000);
    }
  }

  function initVideoPage() {
    var data = extractVideoData();
    if (data) videoData = data;
    waitForVideo();
  }

  function initCollectionPage() {
    var retries = 0;
    (function tryExtract() {
      var data = extractCollectionData();
      if (data) {
        msg('SYNC_COLLECTION', data).catch(function () {});
      } else if (retries < 15) {
        retries++;
        setTimeout(tryExtract, 1000);
      }
    })();
  }


  /* ============================================================
     PAGE CHANGE DETECTION
     ============================================================ */

  var currentPageType = getPageType();
  var lastURL = location.href;

  function handlePageChange() {
    stopPolling();
    videoData = null;
    lastReportedTime = -1;
    currentPageType = getPageType();
    if (currentPageType === 'video') initVideoPage();
    else if (currentPageType === 'collection') initCollectionPage();
  }

  function onURLChanged() {
    if (location.href !== lastURL) { lastURL = location.href; handlePageChange(); }
  }

  var origPush = history.pushState;
  history.pushState = function () { origPush.apply(this, arguments); onURLChanged(); };
  var origReplace = history.replaceState;
  history.replaceState = function () { origReplace.apply(this, arguments); onURLChanged(); };
  window.addEventListener('popstate', onURLChanged);
  setInterval(onURLChanged, 10000);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { reportProgress({ force: true }); stopPolling(); }
    else { var el = findVideoElement(); if (!el) { waitForVideo(); } else if (!el.paused) { reportProgress(); startPolling(); } }
  });


  /* ============================================================
     IDENTIFY HANDLER (API-FIRST)
     ============================================================ */

  function identifyFallbackFn(respond, bvid) {
    var data = extractVideoData();
    if (data) {
      respond({
        type: 'video', title: data.title, bvid: data.bvid || bvid, aid: data.aid || 0,
        ownerName: data.ownerName, ownerMid: data.ownerMid, coverUrl: data.coverUrl,
        pages: data.pages, pageCount: data.pages ? data.pages.length : 1, totalDuration: data.duration
      });
      return;
    }
    respond({ type: 'unknown' });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (msg.type === 'SETTINGS_UPDATED') {
      if (msg.payload && msg.payload.pollInterval) {
        pollIntervalSec = msg.payload.pollInterval;
        if (pollingTimer) startPolling();
      }
      return;
    }

    if (msg.type !== 'IDENTIFY_PAGE') return;

    var url = location.href, path = location.pathname;
    var bvMatch = url.match(/BV([a-zA-Z0-9]+)/);
    var bvid = bvMatch ? 'BV' + bvMatch[1] : '';

    if (bvid && /\/video\//.test(path)) {
      fetchWithTimeout('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { credentials: 'include' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.code === 0 && j.data) {
            var d = j.data;
            respond({
              type: 'video', title: d.title || '', bvid: d.bvid || bvid, aid: d.aid || 0,
              ownerName: d.owner ? d.owner.name : '', ownerMid: d.owner ? d.owner.mid : 0,
              coverUrl: d.pic || '',
              pages: (d.pages || []).map(function (pg) { return { page: pg.page, part: pg.part || '', cid: pg.cid, duration: pg.duration || 0 }; }),
              pageCount: d.videos || ((d.pages || []).length || 1), totalDuration: d.duration || 0
            });
            return;
          }
          identifyFallbackFn(respond, bvid);
        }).catch(function () { identifyFallbackFn(respond, bvid); });
      return true;
    }

    if (/\/list\/ml\d+/.test(path) || /\/medialist\/play\/ml\d+/.test(path) || /\/channel\/collectiondetail/.test(path)) {
      var cd = extractCollectionData();
      if (cd) { respond({ type: 'collection', title: cd.title, collectionId: cd.collectionId, videos: cd.videos }); return; }
    }

    respond({ type: 'unknown' });
  });


  /* ============================================================
     STARTUP
     ============================================================ */

  if (currentPageType === 'video') {
    msg('GET_SETTINGS').then(function (r) {
      if (r.ok && r.settings && r.settings.pollInterval) pollIntervalSec = r.settings.pollInterval;
    });
    initVideoPage();
  } else if (currentPageType === 'collection') {
    initCollectionPage();
  }

})();
