const fs = require('fs');
const path = require('path');

const featuresDir = 'src/features';
const features = fs.readdirSync(featuresDir).filter(f => {
  try { return fs.statSync(path.join(featuresDir, f)).isDirectory(); } catch { return false; }
});

const apiCalls = new Set();

for (const feat of features) {
  const apiPath = path.join(featuresDir, feat, 'api.ts');
  if (!fs.existsSync(apiPath)) continue;
  const content = fs.readFileSync(apiPath, 'utf8');
  const matches = content.match(/'[^']*\/api\/v1[^']*'/g);
  if (matches) {
    for (const m of matches) {
      apiCalls.add(m.replace(/'/g, ''));
    }
  }
}

const clientPath = 'src/lib/api/client.ts';
if (fs.existsSync(clientPath)) {
  const clientContent = fs.readFileSync(clientPath, 'utf8');
  const baseMatches = clientContent.match(/\/api\/v1[^\s"']+/g);
  if (baseMatches) {
    for (const m of baseMatches) apiCalls.add(m);
  }
}

console.log('Total unique API call patterns from web frontend:', apiCalls.size);
for (const c of [...apiCalls].sort()) {
  console.log('  ' + c);
}