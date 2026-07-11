/** Dashboard statistics panel */


function refreshStats() {
  sendMessage({ type: 'GET_STATS' }).then(function (r) {
    if (!r.ok) return;
    var today = r.today || {};
    $('#stat-today-time').textContent = formatDuration(today.totalSeconds || 0, timePrecision);
    $('#stat-today-detail').textContent = '已完成 ' + (today.completedCount || 0) + ' 个视频';

    var streak = r.streak || {};
    $('#stat-streak-current').textContent = (streak.current || 0) + ' 天';
    $('#stat-streak-longest').textContent = streak.longest || 0;
  });
}
