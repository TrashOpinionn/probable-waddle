'use strict';

// Vercel Serverless Function 入口：直接导出 Express app。
// db.init() 已在 src/app.js 的中间件中处理，兼容冷启动。
module.exports = require('../src/app');
