/*
 * 把整個 App 打包成單一 HTML 檔（dist/coffee-log.html），用來發佈成 claude.ai 頁面。
 * 發佈時資料存在該頁面的雲端資料庫（db capability），而非瀏覽器。
 *   node scripts/build-artifact.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<noscript>')).trim();
const scripts = ['js/calc.js', 'js/store.js', 'js/app.js'].map(read);
if (scripts.some((s) => /<\/script/i.test(s))) throw new Error('script contains </script>');

// claude.ai 頁面外框已處理上下安全區域，頁首改黏在安全區域下緣
const embedCss = '.top { top: env(safe-area-inset-top, 0px); padding-top: 12px; }';

const out = `<title>咖啡沖煮記錄</title>
<style>
${read('css/style.css')}
${embedCss}
</style>
${body}
<script>window.COFFEE_EMBED = true;</script>
${scripts.map((s) => `<script>\n${s}\n</script>`).join('\n')}
`;

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/coffee-log.html'), out);
console.log('dist/coffee-log.html', (out.length / 1024).toFixed(1) + ' KB');
