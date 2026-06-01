const fs = require('fs');
const html = fs.readFileSync('brands.html', 'utf8');
const slugs = [];
const pattern = /href=["'](?:https?:\/\/maxbau\.ro)?\/?marci\/([a-z0-9-]+)["']/gi;
let m;
while ((m = pattern.exec(html)) !== null) {
  if (!slugs.includes(m[1])) {
    slugs.push(m[1]);
  }
}
fs.writeFileSync('extracted_brands.json', JSON.stringify(slugs, null, 2));
console.log('Extracted ' + slugs.length + ' brands');
