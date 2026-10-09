/*
 * 把整個 App 打包成單一 HTML 檔：
 *   dist/coffee-log.html  claude.ai 頁面版（資料存在頁面的雲端資料庫）
 *   gas/Index.html        Google 試算表版（貼到 Apps Script，資料存在試算表）
 *   node scripts/build.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, text) => {
  fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
  fs.writeFileSync(path.join(root, f), text);
  console.log(f, (text.length / 1024).toFixed(1) + ' KB');
};

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<noscript>')).trim();
const css = read('css/style.css');
const scripts = ['js/calc.js', 'js/store.js', 'js/app.js'].map(read);
if (scripts.some((s) => /<\/script/i.test(s))) throw new Error('script contains </script>');

function bundle(mode, extraCss) {
  return `<style>
${css}
${extraCss || ''}
</style>
${body}
<script>window.COFFEE_MODE = '${mode}';</script>
${scripts.map((s) => `<script>\n${s}\n</script>`).join('\n')}
`;
}

// claude.ai 頁面外框已處理上下安全區域，頁首改黏在安全區域下緣
write('dist/coffee-log.html', '<title>咖啡沖煮記錄</title>\n' +
  bundle('claude', '.top { top: env(safe-area-inset-top, 0px); padding-top: 12px; }'));

write('gas/Index.html', `<!DOCTYPE html>
<!-- 由 scripts/build.js 產生，請勿直接修改；整份貼到 Apps Script 的 Index.html -->
<html>
<head>
<meta charset="utf-8">
</head>
<body>
${bundle('gas')}</body>
</html>
`);
