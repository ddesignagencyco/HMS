const fs = require('fs');

const clientPath = 'src/lib/api/client.ts';
const content = fs.readFileSync(clientPath, 'utf8');

// find all /api/v1/... patterns
const regex = /\/api\/v1[^\s"'<>]+/g;
const matches = content.match(regex);

console.log('API_BASE references in client.ts:');
if (matches) {
  const unique = [...new Set(matches)];
  for (const m of unique) console.log('  ' + m);
} else {
  console.log('  none found');
}

// also look for fetch/api patterns in feature api.ts files
console.log('\nChecking feature api.ts files:');
const featuresDir = 'src/features';
const features = fs.readdirSync(featuresDir).filter(f => {
  try { return fs.statSync(path.join(featuresDir, f)).isDirectory(); } catch { return false; }
});

for (const feat of features) {
  const apiPath = path.join(featuresDir, feat, 'api.ts');
  if (!fs.existsSync(apiPath)) { console.log('  ' + feat + ': no api.ts'); continue; }
  const apiContent = fs.readFileSync(apiPath, 'utf8');
  // find all strings that look like API paths
  const apiMatches = apiContent.match(/\/api\/v1[^\s"'<>]+/g);
  if (apiMatches && apiMatches.length > 0) {
    console.log('  ' + feat + ': ' + apiMatches.length, 'matches');
    for (const m of [...new Set(apiMatches)]) console.log('    ' + m);
  } else {
    console.log('  ' + feat + ': no /api/v1 matches');
  }
}