/**
 * Export / Import utilities.
 */

async function exportAsJSON(dbOps) {
  const courses = await dbOps.getAll('courses');
  const videos = await dbOps.getAll('videos');
  const dailyStats = await dbOps.getAll('daily_stats');

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    courses,
    videos,
    dailyStats
  };

  return JSON.stringify(data, null, 2);
}

async function exportAsCSV(dbOps) {
  const videos = await dbOps.getAll('videos');
  const courses = await dbOps.getAll('courses');

  const courseMap = {};
  courses.forEach(c => { courseMap[c.id] = c; });

  const headers = ['BV号', '视频标题', '所属课程', '总时长(秒)', '已播放(秒)', '进度百分比', '是否完成', '最后观看时间'];
  const rows = [headers];

  videos.forEach(v => {
    const course = courseMap[v.courseId];
    const courseName = course ? course.title : '未归属';
    const completed = v.completed ? '是' : '否';
    const lastPlayed = v.lastPlayedAt ? new Date(v.lastPlayedAt).toLocaleString('zh-CN') : '';

    rows.push([
      v.bvid,
      v.title || v.bvid,
      courseName,
      v.duration,
      Math.floor(v.currentTime || 0),
      (v.progressPercent || 0).toFixed(1) + '%',
      completed,
      lastPlayed
    ]);
  });

  const csvContent = '\uFEFF' + rows.map(row =>
    row.map(cell => {
      const str = String(cell);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',')
  ).join('\n');

  return csvContent;
}
