var fs = require('fs');
var path = require('path');

var dir = path.join(__dirname, '..');
var files = [
  'src/lib/constants.js',
  'src/lib/db.js',
  'src/lib/format.js',
  'src/lib/stats.js',
  'src/lib/tracker.js',
  'src/lib/export.js',
  'src/content-patch.js',
  'src/content.js',
  'src/background.js',
  'src/dashboard/main.js',
  'src/dashboard/courses.js',
  'src/dashboard/stats.js',
  'src/dashboard/modals.js'
];

var errors = 0;
files.forEach(function (f) {
  var fp = path.join(dir, f);
  if (!fs.existsSync(fp)) { console.log('MISSING: ' + f); errors++; return; }
  try { new Function(fs.readFileSync(fp, 'utf-8')); console.log('OK: ' + f); }
  catch (e) { console.log('ERROR: ' + f + ' - ' + e.message); errors++; }
});

console.log('\n' + errors + ' error(s) found');
