// Keep-alive скрипт для Railway
// Предотвращает засыпание бесплатного инстанса

const https = require('https');
const http = require('http');

const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000; // 5 минут
const HEALTH_CHECK_URL = process.env.HEALTH_CHECK_URL || 'https://your-project.railway.app/status';

function pingServer() {
  const url = new URL(HEALTH_CHECK_URL);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    timeout: 10000
  };

  const client = url.protocol === 'https:' ? https : http;
  
  const req = client.request(options, (res) => {
    console.log(`✅ Keep-alive ping: ${res.statusCode} - ${new Date().toISOString()}`);
  });

  req.on('error', (error) => {
    console.log(`⚠️ Keep-alive ping failed: ${error.message}`);
  });

  req.on('timeout', () => {
    console.log('⚠️ Keep-alive ping timeout');
    req.destroy();
  });

  req.setTimeout(10000);
  req.end();
}

// Запускаем keep-alive
console.log('🔄 Starting keep-alive service...');
console.log(`📍 Target URL: ${HEALTH_CHECK_URL}`);
console.log(`⏰ Interval: ${KEEP_ALIVE_INTERVAL / 1000} seconds`);

setInterval(pingServer, KEEP_ALIVE_INTERVAL);

// Первый пинг сразу
pingServer();

console.log('✅ Keep-alive service started');
