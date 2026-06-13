// proxy.js
const http = require('http');
const httpProxy = require('http-proxy');

const targets = [
  'http://127.0.0.1:8001',
  'http://127.0.0.1:8002',
  'http://127.0.0.1:8003',
  'http://127.0.0.1:8004',
  'http://127.0.0.1:8005'
];

let idx = 0;
const proxy = httpProxy.createProxyServer({});

const server = http.createServer((req, res) => {
  const target = targets[idx % targets.length];
  idx++;
  proxy.web(req, res, { target }, err => {
    res.writeHead(502);
    res.end('Bad Gateway');
  });
});

server.listen(8080, () => console.log('Load balancer listening on http://127.0.0.1:8080'));
