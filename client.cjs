// client.cjs
// Usage:
//  node client.cjs whoami <count>
//  node client.cjs create <productId> <quantity>
//  node client.cjs complete <concurrentCount> <orderId>
// Examples:
//  node client.cjs whoami 5
//  node client.cjs create 1 2
//  node client.cjs complete 10 123

const axios = require('axios');

const args = process.argv.slice(2);
const mode = args[0] || 'whoami';
const count = parseInt(args[1], 10) || 5;
const orderId = args[2] || '1';
const base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const apiBase = base + '/api';

async function whoamiConcurrent(n) {
  const tasks = Array.from({ length: n }, (_, i) => i + 1).map(i =>
    axios.get(`${base}/whoami`).then(res => ({ i, ok: true, data: res.data })).catch(err => ({ i, ok: false, error: err.message }))
  );
  const results = await Promise.all(tasks);
  results.forEach(r => {
    if (r.ok) console.log(`Task ${r.i} -> port ${r.data.port} server_id ${r.data.server_id}`);
    else console.error(`Task ${r.i} -> error: ${r.error}`);
  });
}

async function completeConcurrent(n, id) {
  const endpoint = `${apiBase}/test-complete/${id}`; // requires route in routes/api.php
  console.log(`Sending ${n} concurrent POST ${endpoint}`);
  const start = Date.now();

  const tasks = Array.from({ length: n }, (_, i) => i + 1).map(i =>
    axios.post(endpoint, {}, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      timeout: 15000
    })
    .then(res => ({ i, ok: true, status: res.status, data: res.data }))
    .catch(err => {
      const msg = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
      return { i, ok: false, error: msg };
    })
  );

  const results = await Promise.all(tasks);
  const duration = Date.now() - start;
  let success = 0, fail = 0;
  results.forEach(r => {
    if (r.ok) {
      success++;
      console.log(`Request ${r.i} -> ${r.status} ${JSON.stringify(r.data)}`);
    } else {
      fail++;
      console.error(`Request ${r.i} -> error: ${r.error}`);
    }
  });
  console.log(`All done in ${duration}ms — success: ${success}, fail: ${fail}`);
}

// create order via API (test helper)
async function createOrder(productId = 1, quantity = 1) {
  const endpoint = `${apiBase}/test-create-order`; // requires route in routes/api.php
  const res = await axios.post(endpoint, { product_id: productId, quantity }, {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    timeout: 10000
  });
  console.log('Created order', res.data);
  return res.data.order_id;
}

(async () => {
  if (mode === 'whoami') {
    await whoamiConcurrent(count);
    return;
  }

  if (mode === 'create') {
    const id = await createOrder(parseInt(args[1],10)||1, parseInt(args[2],10)||1);
    console.log('order id:', id);
    return;
  }

  if (mode === 'complete') {
    await completeConcurrent(count, orderId);
    return;
  }

  console.error('Unknown mode. Use `whoami`, `create` or `complete`.');
})();
