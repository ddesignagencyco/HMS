const fs = require('fs');
const data = JSON.parse(fs.readFileSync('docs-final/openapi.json','utf8'));
const paths = Object.keys(data.paths || {});

// Check which paths are likely admin-only vs public
const adminLike = [];
const publicLike = [];
const devLike = [];

for (const path of paths) {
  const pathObj = data.paths[path];
  const methods = Object.keys(pathObj).filter(m => typeof pathObj[m] === 'object');
  
  let isAdmin = false;
  let isDev = false;
  
  for (const m of methods) {
    const desc = (pathObj[m].description || '').toLowerCase();
    const summary = (pathObj[m].summary || '').toLowerCase();
    
    if (desc.includes('admin') || summary.includes('admin')) isAdmin = true;
    if (desc.includes('development') || summary.includes('development')) isDev = true;
    if (desc.includes('webhook') || summary.includes('webhook')) isDev = true;
  }
  
  if (isDev) devLike.push(path);
  else if (isAdmin) adminLike.push(path);
  else publicLike.push(path);
}

console.log('=== LIKELY ADMIN-ONLY (not in public web frontend) ===');
console.log('Count:', adminLike.length);
for (const p of adminLike) console.log('  ' + p);

console.log('\n=== DEV-ONLY (disabled in production) ===');
console.log('Count:', devLike.length);
for (const p of devLike) console.log('  ' + p);

console.log('\n=== PUBLIC (likely wired in web frontend) ===');
console.log('Total public:', publicLike.length);
console.log('(showing first 30)');
for (const p of publicLike.slice(0,30)) console.log('  ' + p);