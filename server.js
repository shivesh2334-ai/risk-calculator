const express = require('express');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const ROOT_DIR = __dirname;

// Prevent serving server/config files as static assets
const BLOCKED_PREFIXES = ['/server.js', '/package.json', '/package-lock.json', '/vercel.json', '/metadata.json', '/node_modules', '/tests'];
app.use((req, res, next) => {
  const reqPath = req.path.toLowerCase();
  if (BLOCKED_PREFIXES.some((prefix) => reqPath === prefix || reqPath.startsWith(prefix + '/'))) {
    return res.status(404).send('Not found');
  }
  next();
});

// Stub Vercel Web Analytics script so it does not 404 in local/AI Studio preview
app.get('/_vercel/insights/script.js', (_req, res) => {
  res.type('application/javascript').send('// Vercel analytics disabled in preview\n');
});

app.use(
  express.static(ROOT_DIR, {
    index: 'index.html',
    dotfiles: 'ignore',
    extensions: ['html'],
  })
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT_DIR, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});
