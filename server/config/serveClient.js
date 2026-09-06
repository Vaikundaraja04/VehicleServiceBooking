const fs = require("node:fs");
const path = require("node:path");
const express = require("express");

function serveBuiltClient(app, directory) {
  const root = path.resolve(directory);
  const index = path.join(root, "index.html");
  if (!fs.existsSync(index)) {
    throw new Error("Client production build is missing; run the client build before starting");
  }
  const staticFiles = express.static(root, {
    index: false, dotfiles: "ignore",
    setHeaders(res, file) {
      if (path.extname(file) === ".html") res.setHeader("Cache-Control", "no-store");
    },
  });
  app.use((req, res, next) => {
    let pathname;
    try { pathname = decodeURIComponent(req.path); } catch { return next(); }
    if (!['GET', 'HEAD'].includes(req.method) || /^\/api(?:\/|$)/i.test(pathname)
      || pathname.split('/').some(part => part.startsWith('.'))) return next();
    staticFiles(req, res, error => {
      if (error) return next(error);
      if (path.extname(pathname) || /^\/assets(?:\/|$)/i.test(pathname) || !req.accepts('html')) return next();
      res.setHeader('Cache-Control', 'no-store');
      return res.sendFile(index);
    });
  });
}

module.exports = { serveBuiltClient };
