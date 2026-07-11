/**
 * Progress calculation utilities.
 */

function calcProgressPercent(currentTime, duration) {
  if (!duration || duration <= 0) return 0;
  return Math.min(100, (currentTime / duration) * 100);
}

function isVideoCompleted(progressPercent, threshold) {
  return progressPercent >= threshold;
}

function mergeWatchIntervals(intervals) {
  if (!intervals || intervals.length === 0) return [];

  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr[0] <= last[1] + 2) {
      last[1] = Math.max(last[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

function calcEffectiveWatchTime(intervals) {
  const merged = mergeWatchIntervals(intervals);
  return merged.reduce((sum, [start, end]) => sum + (end - start), 0);
}

function shouldSkipProgressUpdate(oldTime, newTime, maxNormalDelta) {
  if (oldTime === undefined || oldTime === null || oldTime < 0) return false;
  var delta = newTime - oldTime;
  if (delta > (maxNormalDelta || 10)) return true;
  return false;
}
