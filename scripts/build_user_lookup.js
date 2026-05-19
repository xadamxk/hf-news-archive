// Build username -> uid map by scanning every events.json contributor block.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const editionsDir = path.join(ROOT, 'editions');
const map = {};
for (const ed of fs.readdirSync(editionsDir)) {
  const p = path.join(editionsDir, ed, 'events.json');
  if (!fs.existsSync(p)) continue;
  let data;
  try { data = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
  if (!data.events) continue;
  for (const ev of data.events) {
    if (!Array.isArray(ev.users)) continue;
    for (const u of ev.users) {
      if (u && u.uid && u.username) {
        const key = u.username.toLowerCase();
        if (!map[key]) map[key] = { uid: u.uid, username: u.username, editions: [] };
        if (!map[key].editions.includes(ed)) map[key].editions.push(ed);
      }
    }
  }
}
const query = process.argv.slice(2).map(s => s.toLowerCase());
if (query.length) {
  for (const q of query) {
    const hits = Object.keys(map).filter(k => k.includes(q));
    for (const h of hits) console.log(JSON.stringify(map[h]));
  }
} else {
  fs.writeFileSync(path.join(ROOT, 'username_lookup.json'), JSON.stringify(map, null, 2));
  console.log(`wrote ${Object.keys(map).length} usernames`);
}
