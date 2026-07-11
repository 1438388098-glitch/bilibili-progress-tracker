/**
 * Statistics calculation utilities.
 * Requires getDateStr() from lib/format.js
 */

var _dailyStatsWriteQueue = Promise.resolve();

async function updateDailyStats(dbOps, secondsWatched, completedCount, bvid, timestamp) {
  _dailyStatsWriteQueue = _dailyStatsWriteQueue.then(function () {
    return _updateDailyStatsInternal(dbOps, secondsWatched, completedCount, bvid, timestamp);
  });
  return _dailyStatsWriteQueue;
}

async function _updateDailyStatsInternal(dbOps, secondsWatched, completedCount, bvid, timestamp) {
  const dateStr = getDateStr(timestamp || Date.now());

  let todayStats = await dbOps.getFirstByIndex('daily_stats', 'date', dateStr);

  if (!todayStats) {
    todayStats = {
      date: dateStr,
      totalSeconds: 0,
      videoCount: 0,
      completedCount: 0,
      reportedBvids: []
    };
  }

  const addedSeconds = Math.max(0, secondsWatched);
  todayStats.totalSeconds = (todayStats.totalSeconds || 0) + addedSeconds;

  if (bvid && !(todayStats.reportedBvids || []).includes(bvid)) {
    todayStats.videoCount = (todayStats.videoCount || 0) + 1;
    if (!todayStats.reportedBvids) todayStats.reportedBvids = [];
    todayStats.reportedBvids.push(bvid);
    if (todayStats.reportedBvids.length > 500) {
      todayStats.reportedBvids = todayStats.reportedBvids.slice(-500);
    }
  }

  if (completedCount > 0) {
    todayStats.completedCount = (todayStats.completedCount || 0) + completedCount;
  }

  return dbOps.put('daily_stats', todayStats);
}

async function getTodayStats(dbOps) {
  const dateStr = getDateStr(Date.now());
  return dbOps.getFirstByIndex('daily_stats', 'date', dateStr);
}

async function getWeeklyStats(dbOps, days) {
  const allStats = await dbOps.getAll('daily_stats');
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  const statsMap = {};
  allStats.forEach(s => { statsMap[s.date] = s; });

  return dates.map(date => statsMap[date] || {
    date,
    totalSeconds: 0,
    videoCount: 0,
    completedCount: 0
  });
}

async function getStreak(dbOps) {
  const allStats = await dbOps.getAll('daily_stats');
  if (allStats.length === 0) return { current: 0, longest: 0 };

  const dateSet = new Set();
  allStats.forEach(s => {
    if (s.totalSeconds > 0) dateSet.add(s.date);
  });

  if (dateSet.size === 0) return { current: 0, longest: 0 };

  let currentStreak = 0;
  const today = new Date();
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${day}`;

    if (dateSet.has(dateStr)) {
      currentStreak++;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }

  let longestStreak = 0;
  const sortedDates = Array.from(dateSet).sort();
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prevParts = sortedDates[i - 1].split('-').map(Number);
    const currParts = sortedDates[i].split('-').map(Number);
    const prevDate = new Date(Date.UTC(prevParts[0], prevParts[1] - 1, prevParts[2]));
    const currDate = new Date(Date.UTC(currParts[0], currParts[1] - 1, currParts[2]));
    const diffDays = Math.round((currDate - prevDate) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      run++;
    } else {
      longestStreak = Math.max(longestStreak, run);
      run = 1;
    }
  }
  longestStreak = Math.max(longestStreak, run);

  return { current: currentStreak, longest: longestStreak };
}

function calcTotalHours(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
