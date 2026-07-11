/** Shared formatting utilities — loaded by background.js, content.js, and dashboard */


function formatDuration(seconds, precision) {
  if (!seconds || seconds <= 0) return precision === 'seconds' ? '0s' : '0m';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.round(seconds % 60);
  if (precision === 'seconds') {
    var parts = [];
    if (h > 0) parts.push(h + 'h');
    if (m > 0) parts.push(m + 'm');
    parts.push(s + 's');
    return parts.join(' ');
  }
  if (s >= 30) m++;
  if (m >= 60) { h++; m = 0; }
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}


function formatDurationClock(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  var mm = String(m).padStart(2, '0');
  var ss = String(s).padStart(2, '0');
  if (h > 0) return h + ':' + mm + ':' + ss;
  return m + ':' + ss;
}


function formatTime(ts) {
  if (!ts) return '';
  var d = new Date(ts);
  var y = d.getFullYear();
  var M = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  var h = String(d.getHours()).padStart(2, '0');
  var min = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + M + '-' + day + ' ' + h + ':' + min;
}


function getDateStr(timestamp) {
  var d = new Date(timestamp || Date.now());
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}


function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
