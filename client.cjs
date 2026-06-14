// client.cjs
// Usage:
//  node client.cjs whoami <count>              — Test Load Balancer
//  node client.cjs create <productId> <qty>    — Create new order
//  node client.cjs complete <count> <orderId>  — Complete order concurrently
//  node client.cjs unsafe <count> <productId>  — Test Race Condition (no lock)
//  node client.cjs safe <count> <productId>    — Test Pessimistic Locking
//  node client.cjs demo                        — Run all tests in order

const axios = require('axios');

const args = process.argv.slice(2);
const mode = args[0] || 'whoami';
const count = parseInt(args[1], 10) || 5;
const idParam = args[2] || '1';
const base = process.env.BASE_URL || 'http://127.0.0.1:8080';
const apiBase = base + '/api';

// ─── Colors ───
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
};

function header(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${C.bold}${C.cyan}  ${title}${C.reset}`);
  console.log(`${'='.repeat(60)}\n`);
}

function sub(text) {
  console.log(`${C.yellow}  > ${text}${C.reset}`);
}

// ─── 1. whoami - Test Load Balancer ───
async function whoamiConcurrent(n) {
  header('1. Load Balancer Test (whoami)');
  const tasks = Array.from({ length: n }, (_, i) => i + 1).map(i =>
    axios.get(`${base}/whoami`).then(res => ({ i, ok: true, data: res.data })).catch(err => ({ i, ok: false, error: err.message }))
  );
  const results = await Promise.all(tasks);
  results.forEach(r => {
    if (r.ok) console.log(`  Task ${r.i} -> port ${r.data.port} server_id ${r.data.server_id}`);
    else console.error(`  Task ${r.i} -> error: ${r.error}`);
  });
}

// ─── 2. create - Create new order ───
async function createOrder(productId = 1, quantity = 1) {
  header('2. Create New Order');
  const endpoint = `${apiBase}/test-create-order`;
  sub(`POST ${endpoint} | product_id=${productId} quantity=${quantity}`);
  const res = await axios.post(endpoint, { product_id: productId, quantity }, {
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    timeout: 10000
  });
  console.log(`  ${C.green}Order created:${C.reset}`, res.data);
  return res.data.order_id;
}

// ─── 3. complete - Complete order concurrently ───
async function completeConcurrent(n, id) {
  header('3. Complete Order Concurrently (Race Condition Protection)');
  const endpoint = `${apiBase}/test-complete/${id}`;
  sub(`Sending ${n} concurrent POST to ${endpoint}`);
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
      console.log(`  ${C.green}Request ${r.i} -> ${r.status} ${JSON.stringify(r.data)}${C.reset}`);
    } else {
      fail++;
      console.log(`  ${C.red}Request ${r.i} -> ${r.error}${C.reset}`);
    }
  });
  console.log(`\n  Result: ${duration}ms - ${C.green}Success: ${success}${C.reset}, ${C.red}Fail: ${fail}${C.reset}`);
  sub('Only 1 should succeed, rest should fail (Race Condition protection with lock)');
}

// ─── 4. unsafe - Test Race Condition (no lock) ───
async function unsafeConcurrent(n, productId) {
  header('4. UNSAFE - Update Stock WITHOUT Lock (Race Condition)');

  sub(`Using product #${productId}`);
  sub(`Sending ${n} concurrent GET to ${base}/unsafe/${productId}`);
  const start = Date.now();

  const tasks = Array.from({ length: n }, (_, i) => i + 1).map(i =>
    axios.get(`${base}/unsafe/${productId}`, { timeout: 15000 })
    .then(res => ({ i, ok: true, data: res.data }))
    .catch(err => {
      const msg = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
      return { i, ok: false, error: msg };
    })
  );

  const results = await Promise.all(tasks);
  const duration = Date.now() - start;
  results.forEach(r => {
    if (r.ok) {
      console.log(`  Request ${r.i} -> stock=${r.data.stock}`);
    } else {
      console.log(`  ${C.red}Request ${r.i} -> ${r.error}${C.reset}`);
    }
  });

  console.log(`\n  ${C.red}WARNING: Without lock, concurrent requests read the same old stock value${C.reset}`);
  console.log(`  ${C.red}Instead of decreasing by ${n}, it may decrease less due to Race Condition${C.reset}`);
  console.log(`  ${C.yellow}Total time: ${duration}ms (due to sleep 5s per request)${C.reset}`);
}

// ─── 5. safe - Test Pessimistic Locking ───
async function safeConcurrent(n, productId) {
  header('5. SAFE - Update Stock WITH Lock (Pessimistic Locking)');

  sub(`Sending ${n} concurrent GET to ${base}/safe/${productId}`);
  const start = Date.now();

  const tasks = Array.from({ length: n }, (_, i) => i + 1).map(i =>
    axios.get(`${base}/safe/${productId}`, { timeout: 30000 })
    .then(res => ({ i, ok: true, data: res.data }))
    .catch(err => {
      const msg = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
      return { i, ok: false, error: msg };
    })
  );

  const results = await Promise.all(tasks);
  const duration = Date.now() - start;
  results.forEach(r => {
    if (r.ok) {
      console.log(`  ${C.green}Request ${r.i} -> stock_after=${r.data.stock_after}${C.reset}`);
    } else {
      console.log(`  ${C.red}Request ${r.i} -> ${r.error}${C.reset}`);
    }
  });

  console.log(`\n  ${C.green}OK: With lock, each request waits for the previous one to finish${C.reset}`);
  console.log(`  ${C.green}Stock decreases exactly ${n} times - no Race Condition${C.reset}`);
  console.log(`  ${C.yellow}Total time: ${duration}ms (each request waits ~5s = ${n}x5s)${C.reset}`);
}

// ─── demo - Run all tests ───
async function runDemo() {
  console.log(`\n${C.bold}${C.magenta}${'='.repeat(60)}`);
  console.log(`   Parallel Programming E-Commerce - Full Demo`);
  console.log(`${'='.repeat(60)}${C.reset}`);

  // 1. Load Balancer
  await whoamiConcurrent(5);

  // 2. Create order
  const orderId = await createOrder(1, 2);

  // 3. Complete order concurrently
  if (orderId) {
    await completeConcurrent(5, orderId);
  }

  // 4. Unsafe (Race Condition)
  await unsafeConcurrent(5, 1);

  // 5. Safe (Pessimistic Locking)
  await safeConcurrent(5, 1);

  // Summary
  header('Concepts Summary');
  console.log(`  ${C.red}UNSAFE:${C.reset}    Concurrent reads same value -> Race Condition -> Wrong data`);
  console.log(`  ${C.green}SAFE:${C.reset}      lockForUpdate() -> each request waits -> Correct data`);
  console.log(`  ${C.green}COMPLETE:${C.reset}  transaction + lock -> only 1 succeeds -> Double protection`);
  console.log(`  ${C.cyan}QUEUE:${C.reset}     Long tasks run in background (async processing)`);
  console.log(`  ${C.cyan}CHUNK:${C.reset}     Process large data in batches for better performance`);
  console.log(`  ${C.cyan}LB:${C.reset}        Load Balancer distributes requests across 5 servers\n`);
}

// ─── Run ───
(async () => {
  try {
    if (mode === 'whoami') {
      await whoamiConcurrent(count);
    } else if (mode === 'create') {
      const id = await createOrder(parseInt(args[1], 10) || 1, parseInt(args[2], 10) || 1);
      console.log(`  order id: ${id}`);
    } else if (mode === 'complete') {
      await completeConcurrent(count, idParam);
    } else if (mode === 'unsafe') {
      await unsafeConcurrent(count, parseInt(idParam, 10) || 1);
    } else if (mode === 'safe') {
      await safeConcurrent(count, parseInt(idParam, 10) || 1);
    } else if (mode === 'demo') {
      await runDemo();
    } else {
      console.log(`${C.bold}Available commands:${C.reset}`);
      console.log(`  node client.cjs whoami <count>              — Test Load Balancer`);
      console.log(`  node client.cjs create <productId> <qty>    — Create new order`);
      console.log(`  node client.cjs complete <count> <orderId>  — Complete order concurrently`);
      console.log(`  node client.cjs unsafe <count> <productId>  — Test Race Condition`);
      console.log(`  node client.cjs safe <count> <productId>    — Test Pessimistic Locking`);
      console.log(`  node client.cjs demo                        — Run all tests`);
    }
  } catch (err) {
    console.error(`${C.red}Error: ${err.message}${C.reset}`);
  }
})();
