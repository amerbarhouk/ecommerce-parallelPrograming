#!/usr/bin/env node
const http = require('http');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
};

function c(color, text) {
    return colors[color] + text + colors.reset;
}

function printHeader(title) {
    console.log('\n' + c('cyan', c('bold', '='.repeat(60))));
    console.log(c('cyan', c('bold', '  ' + title)));
    console.log(c('cyan', c('bold', '='.repeat(60))));
}

function printSubHeader(title) {
    console.log('\n' + c('magenta', c('bold', '- ' + title)));
}

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        http.get(BASE_URL + path, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        data: json,
                        ms: Date.now() - start,
                        backendPort: res.headers['x-backend-port'] || null,
                    });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, ms: Date.now() - start, backendPort: null });
                }
            });
        }).on('error', reject);
    });
}

function httpPost(path, body) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const postData = JSON.stringify(body);
        const req = http.request(BASE_URL + path, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        data: json,
                        ms: Date.now() - start,
                        backendPort: res.headers['x-backend-port'] || null,
                    });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, ms: Date.now() - start, backendPort: null });
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

async function modeWhoami() {
    printHeader('WHOAMI - Server Identity Check');
    try {
        const res = await httpGet('/whoami');
        console.log(c('gray', 'Status: ' + res.status + ' | Time: ' + res.ms + 'ms'));
        if (res.status === 200) {
            console.log(c('green', 'OK - Server is running'));
            console.log('  ' + JSON.stringify(res.data));
            if (res.backendPort) {
                console.log(c('cyan', '  -> Backend that handled this: port ' + res.backendPort));
            }
        } else {
            console.log(c('red', 'X - Server not responding'));
        }
    } catch (e) {
        console.log(c('red', 'X Error: ' + e.message));
        console.log(c('yellow', '  Make sure proxy + Laravel servers are running:'));
        console.log(c('yellow', '    .\\start-poc.ps1'));
    }
}

async function modeCreate(userId, productId) {
    printHeader('CREATE ORDER - User ' + userId + ', Product ' + productId);
    try {
        const res = await httpPost('/order', {
            user_id: parseInt(userId),
            product_id: parseInt(productId),
            quantity: 1,
        });
        console.log(c('gray', 'Status: ' + res.status + ' | Time: ' + res.ms + 'ms'));
        if (res.status === 200 || res.status === 201) {
            console.log(c('green', 'OK - Order created'));
            console.log('  ' + JSON.stringify(res.data));
        } else {
            console.log(c('red', 'X - Failed'));
            console.log(c('yellow', '  ' + JSON.stringify(res.data)));
        }
    } catch (e) {
        console.log(c('red', 'X Error: ' + e.message));
    }
}

async function modeComplete(orderId) {
    printHeader('COMPLETE ORDER ' + orderId);
    try {
        const res = await httpPost('/order/complete', {
            order_id: parseInt(orderId),
        });
        console.log(c('gray', 'Status: ' + res.status + ' | Time: ' + res.ms + 'ms'));
        if (res.status === 200) {
            console.log(c('green', 'OK - Order completed'));
            console.log('  ' + JSON.stringify(res.data));
        } else {
            console.log(c('red', 'X - Failed'));
            console.log(c('yellow', '  ' + JSON.stringify(res.data)));
        }
    } catch (e) {
        console.log(c('red', 'X Error: ' + e.message));
    }
}

async function modeUnsafe(productId, concurrent) {
    if (!concurrent) concurrent = 10;
    printHeader('DB UNSAFE - Product ' + productId + ' (' + concurrent + ' concurrent)');
    console.log(c('yellow', '  Method: DB + READ-MODIFY-WRITE (Race Condition expected)\n'));

    const before = await httpGet('/uncached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock || (before.data.data ? before.data.data.stock : null);
    console.log(c('blue', 'Stock before: ' + stockBefore));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet('/unsafe/' + productId));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const backendPorts = results.map(r => r.backendPort).filter(Boolean);
    const uniqueBackends = [...new Set(backendPorts)];
    if (uniqueBackends.length > 0) {
        console.log(c('cyan', '  Distributed across ' + uniqueBackends.length + ' backends: ' + uniqueBackends.join(', ')));
    }

    const after = await httpGet('/uncached-product/' + productId);
    const stockAfter = after.data.stock || (after.data.data ? after.data.data.stock : null);
    console.log(c('blue', 'Stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:     ' + (stockBefore - successCount)));
    console.log();

    const lost = successCount - (stockBefore - stockAfter);
    if (lost > 0) {
        console.log(c('red', 'X RACE CONDITION! Lost ' + lost + ' updates'));
    } else {
        console.log(c('green', 'OK - No race condition this time'));
    }
    console.log(c('gray', '  Success: ' + successCount + ' | Failed: ' + failCount));
}

async function modeSafe(productId, concurrent) {
    if (!concurrent) concurrent = 10;
    printHeader('DB SAFE - Product ' + productId + ' (' + concurrent + ' concurrent)');
    console.log(c('yellow', '  Method: DB + Pessimistic Locking (Race Condition safe)\n'));

    const before = await httpGet('/uncached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock || (before.data.data ? before.data.data.stock : null);
    console.log(c('blue', 'Stock before: ' + stockBefore));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet('/safe/' + productId));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const backendPorts = results.map(r => r.backendPort).filter(Boolean);
    const uniqueBackends = [...new Set(backendPorts)];
    if (uniqueBackends.length > 0) {
        console.log(c('cyan', '  Distributed across ' + uniqueBackends.length + ' backends: ' + uniqueBackends.join(', ')));
    }

    const after = await httpGet('/uncached-product/' + productId);
    const stockAfter = after.data.stock || (after.data.data ? after.data.data.stock : null);
    console.log(c('blue', 'Stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:     ' + (stockBefore - successCount)));
    console.log();

    if (stockAfter === stockBefore - successCount) {
        console.log(c('green', 'OK SAFE - No lost updates (locking worked!)'));
    } else {
        console.log(c('red', 'X - Unexpected result!'));
    }
    console.log(c('gray', '  Success: ' + successCount + ' | Failed: ' + failCount));
}

async function modeCache(productId, iterations) {
    if (!iterations) iterations = 10;
    printHeader('CACHE TEST - Product ' + productId + ' (' + iterations + ' iterations)');
    console.log(c('yellow', '  Strategy: Cache-Aside with Stampede Protection\n'));

    await httpGet('/cache-clear');

    printSubHeader('Step 1: Cold Cache (Database hit)');
    const cold = await httpGet('/cached-product/' + productId);
    console.log(c('gray', '  Network time: ' + cold.ms + 'ms'));
    if (cold.status === 200) {
        console.log(c('cyan', '  Server time:  ' + (cold.data.total_time_ms || 'N/A') + 'ms'));
        console.log(c('cyan', '  Cache status: ' + (cold.data.cache_status || 'N/A')));
        console.log(c('yellow', '  -> First request loads from DB and caches in Redis'));
    }

    printSubHeader('Step 2: Warm Cache (' + iterations + ' iterations)');
    const warmServerTimes = [];
    const warmNetworkTimes = [];
    for (let i = 0; i < iterations; i++) {
        const res = await httpGet('/cached-product/' + productId);
        warmNetworkTimes.push(res.ms);
        if (res.data && res.data.total_time_ms) {
            warmServerTimes.push(res.data.total_time_ms);
        }
        process.stdout.write(c('gray', '.'));
    }
    console.log();
    const avgWarmNet = (warmNetworkTimes.reduce((a, b) => a + b, 0) / warmNetworkTimes.length).toFixed(2);
    const avgWarmSrv = warmServerTimes.length > 0
        ? (warmServerTimes.reduce((a, b) => a + b, 0) / warmServerTimes.length).toFixed(2)
        : 'N/A';
    const minWarmSrv = warmServerTimes.length > 0 ? Math.min(...warmServerTimes).toFixed(2) : 'N/A';
    const maxWarmSrv = warmServerTimes.length > 0 ? Math.max(...warmServerTimes).toFixed(2) : 'N/A';
    console.log(c('green', '  Network avg: ' + avgWarmNet + 'ms'));
    console.log(c('green', '  Server avg:  ' + avgWarmSrv + 'ms  (real cache performance!)'));
    console.log(c('gray', '  Server min:  ' + minWarmSrv + 'ms | max: ' + maxWarmSrv + 'ms'));

    printSubHeader('Step 3: Direct DB (' + iterations + ' iterations)');
    const dbServerTimes = [];
    const dbNetworkTimes = [];
    for (let i = 0; i < iterations; i++) {
        const res = await httpGet('/uncached-product/' + productId);
        dbNetworkTimes.push(res.ms);
        if (res.data && res.data.total_time_ms) {
            dbServerTimes.push(res.data.total_time_ms);
        }
    }
    const avgDbNet = (dbNetworkTimes.reduce((a, b) => a + b, 0) / dbNetworkTimes.length).toFixed(2);
    const avgDbSrv = dbServerTimes.length > 0
        ? (dbServerTimes.reduce((a, b) => a + b, 0) / dbServerTimes.length).toFixed(2)
        : 'N/A';
    const minDbSrv = dbServerTimes.length > 0 ? Math.min(...dbServerTimes).toFixed(2) : 'N/A';
    const maxDbSrv = dbServerTimes.length > 0 ? Math.max(...dbServerTimes).toFixed(2) : 'N/A';
    console.log(c('blue', '  Network avg: ' + avgDbNet + 'ms'));
    console.log(c('blue', '  Server avg:  ' + avgDbSrv + 'ms'));
    console.log(c('gray', '  Server min:  ' + minDbSrv + 'ms | max: ' + maxDbSrv + 'ms'));

    printSubHeader('Performance Comparison (Server time = real cache performance)');
    if (avgWarmSrv !== 'N/A' && avgDbSrv !== 'N/A' && parseFloat(avgWarmSrv) > 0) {
        const speedup = (parseFloat(avgDbSrv) / parseFloat(avgWarmSrv)).toFixed(2);
        console.log(c('magenta', c('bold', '  >> Cache is ' + speedup + 'x faster than DB (server-side)')));
        console.log('  Cache server avg: ' + c('green', avgWarmSrv + 'ms'));
        console.log('  DB server avg:    ' + c('blue', avgDbSrv + 'ms'));
    } else {
        const speedup = (parseFloat(avgDbNet) / parseFloat(avgWarmNet)).toFixed(2);
        console.log(c('magenta', c('bold', '  >> Cache is ' + speedup + 'x faster than DB (network)')));
        console.log('  Cache network avg: ' + c('green', avgWarmNet + 'ms'));
        console.log('  DB network avg:    ' + c('blue', avgDbNet + 'ms'));
    }

    printSubHeader('Cache Stats');
    const stats = await httpGet('/cache-stats');
    console.log(c('gray', '  ' + JSON.stringify(stats.data)));
}

async function modeCacheUnsafe(productId, concurrent) {
    if (!concurrent) concurrent = 10;
    printHeader('CACHE UNSAFE - Product ' + productId + ' (' + concurrent + ' concurrent)');
    console.log(c('yellow', '  Method: Redis + READ-MODIFY-WRITE (Race Condition in cache!)\n'));

    await httpGet('/cache-warm/20');

    const before = await httpGet('/cached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock;
    console.log(c('blue', 'Cached stock before: ' + stockBefore));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet('/cached-unsafe/' + productId));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const backendPorts = results.map(r => r.backendPort).filter(Boolean);
    const uniqueBackends = [...new Set(backendPorts)];
    if (uniqueBackends.length > 0) {
        console.log(c('cyan', '  Distributed across ' + uniqueBackends.length + ' backends: ' + uniqueBackends.join(', ')));
    }

    const after = await httpGet('/cached-product/' + productId);
    const stockAfter = after.data.stock;
    console.log(c('blue', 'Cached stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:            ' + (stockBefore - successCount)));
    console.log();

    const lost = successCount - (stockBefore - stockAfter);
    if (lost > 0) {
        console.log(c('red', 'X RACE CONDITION! Lost ' + lost + ' updates in Redis cache'));
    } else {
        console.log(c('yellow', '~ No race condition detected (try more concurrent requests)'));
    }
    console.log(c('gray', '  Success: ' + successCount + ' | Failed: ' + failCount));
}

async function modeCacheSafe(productId, concurrent) {
    if (!concurrent) concurrent = 10;
    printHeader('CACHE SAFE - Product ' + productId + ' (' + concurrent + ' concurrent)');
    console.log(c('yellow', '  Method: Redis + ATOMIC DECRBY (Race Condition safe!)\n'));

    await httpGet('/cache-warm/20');

    const before = await httpGet('/cached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock;
    console.log(c('blue', 'Cached stock before: ' + stockBefore));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet('/cached-safe/' + productId));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const backendPorts = results.map(r => r.backendPort).filter(Boolean);
    const uniqueBackends = [...new Set(backendPorts)];
    if (uniqueBackends.length > 0) {
        console.log(c('cyan', '  Distributed across ' + uniqueBackends.length + ' backends: ' + uniqueBackends.join(', ')));
    }

    const after = await httpGet('/cached-product/' + productId);
    const stockAfter = after.data.stock;
    console.log(c('blue', 'Cached stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:            ' + (stockBefore - successCount)));
    console.log();

    if (stockAfter === stockBefore - successCount) {
        console.log(c('green', 'OK ATOMIC - No lost updates in Redis!'));
    } else {
        console.log(c('red', 'X - Unexpected result!'));
    }
    console.log(c('gray', '  Success: ' + successCount + ' | Failed: ' + failCount));
}

// ========================================
// ACID Transaction Demo (Requirement #8)
// ========================================

// 9. ACID Success - Order + Stock update in single transaction
async function modeAcidSuccess(productId, quantity) {
    if (!productId) productId = 1;
    if (!quantity) quantity = 1;
    printHeader('ACID SUCCESS - Order + Stock in Single Transaction');
    console.log(c('yellow', '  Method: DB::transaction (Atomic + Consistent + Isolated + Durable)\n'));

    const before = await httpGet('/uncached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock || (before.data.data ? before.data.data.stock : null);
    console.log(c('blue', 'Stock before: ' + stockBefore));
    console.log(c('gray', '  Will create 1 order with qty=' + quantity + ' and update stock atomically\n'));

    const res = await httpPost('/order/atomic', {
        product_id: parseInt(productId),
        quantity: parseInt(quantity),
        fail_after: false,
    });

    console.log(c('gray', 'Status: ' + res.status + ' | Time: ' + res.ms + 'ms'));
    if (res.backendPort) {
        console.log(c('cyan', '  -> Handled by backend port: ' + res.backendPort));
    }

    if (res.status === 201) {
        console.log(c('green', 'OK - ACID Transaction Committed!'));
        console.log('  ' + JSON.stringify(res.data, null, 2));
    } else {
        console.log(c('red', 'X - ACID Transaction Failed'));
        console.log(c('yellow', '  ' + JSON.stringify(res.data, null, 2)));
    }

    const after = await httpGet('/uncached-product/' + productId);
    const stockAfter = after.data.stock || (after.data.data ? after.data.data.stock : null);
    console.log();
    console.log(c('blue', 'Stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:     ' + (stockBefore - quantity)));

    if (res.status === 201 && stockAfter === stockBefore - quantity) {
        console.log(c('green', '\nOK ACID - Order created AND stock updated atomically!'));
        console.log(c('green', '  -> Both operations succeeded TOGETHER (or neither did)'));
    } else if (res.status !== 201 && stockAfter === stockBefore) {
        console.log(c('yellow', '\n~ Transaction failed but stock unchanged (correct rollback)'));
    } else {
        console.log(c('red', '\nX - Unexpected state! ACID may be violated!'));
    }
}

// 10. ACID Fail - Simulate failure to demonstrate rollback
async function modeAcidFail(productId, quantity) {
    if (!productId) productId = 1;
    if (!quantity) quantity = 1;
    printHeader('ACID FAIL - Demonstrate Rollback (Atomicity)');
    console.log(c('yellow', '  Method: DB::transaction + simulated failure\n'));
    console.log(c('gray', '  This will simulate a failure AFTER stock update but BEFORE commit.'));
    console.log(c('gray', '  ACID guarantees: stock should NOT change, order should NOT be created.\n'));

    const before = await httpGet('/uncached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock || (before.data.data ? before.data.data.stock : null);
    console.log(c('blue', 'Stock before: ' + stockBefore));
    console.log(c('yellow', '  Sending request with fail_after=true...\n'));

    const res = await httpPost('/order/atomic', {
        product_id: parseInt(productId),
        quantity: parseInt(quantity),
        fail_after: true,
    });

    console.log(c('gray', 'Status: ' + res.status + ' | Time: ' + res.ms + 'ms'));
    if (res.backendPort) {
        console.log(c('cyan', '  -> Handled by backend port: ' + res.backendPort));
    }
    console.log(c('red', 'X - ACID Transaction Failed (as expected)'));
    console.log(c('yellow', '  ' + JSON.stringify(res.data, null, 2)));

    const after = await httpGet('/uncached-product/' + productId);
    const stockAfter = after.data.stock || (after.data.data ? after.data.data.stock : null);
    console.log();
    console.log(c('blue', 'Stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:     ' + stockBefore + ' (NO CHANGE - rollback worked)'));

    if (stockAfter === stockBefore) {
        console.log(c('green', '\nOK ACID ATOMICITY - Stock unchanged after rollback!'));
        console.log(c('green', '  -> Order NOT created, Stock NOT updated (both rolled back together)'));
    } else {
        console.log(c('red', '\nX - ATOMICITY VIOLATED! Stock changed despite failure!'));
    }
}

// 11. ACID Concurrent - Multiple concurrent ACID transactions
async function modeAcidConcurrent(productId, concurrent) {
    if (!productId) productId = 1;
    if (!concurrent) concurrent = 10;
    printHeader('ACID CONCURRENT - ' + concurrent + ' Transactions on Product ' + productId);
    console.log(c('yellow', '  Method: Multiple DB::transaction + lockForUpdate (Isolation)\n'));

    const before = await httpGet('/uncached-product/' + productId);
    if (before.status !== 200) {
        console.log(c('red', 'X Product ' + productId + ' not found'));
        return;
    }
    const stockBefore = before.data.stock || (before.data.data ? before.data.data.stock : null);
    console.log(c('blue', 'Stock before: ' + stockBefore));
    console.log(c('gray', '  Sending ' + concurrent + ' concurrent ACID transactions...\n'));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpPost('/order/atomic', {
            product_id: parseInt(productId),
            quantity: 1,
            fail_after: false,
        }));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 201).length;
    const failCount = results.filter(r => r.status !== 201).length;

    const backendPorts = results.map(r => r.backendPort).filter(Boolean);
    const uniqueBackends = [...new Set(backendPorts)];
    if (uniqueBackends.length > 0) {
        console.log(c('cyan', '  Distributed across ' + uniqueBackends.length + ' backends: ' + uniqueBackends.join(', ')));
    }

    console.log();
    results.forEach((r, i) => {
        if (r.status === 201) {
            console.log(c('green', '  Tx ' + (i + 1) + ' -> OK (order_id=' + r.data.order_id + ', stock=' + r.data.stock_after + ')'));
        } else {
            console.log(c('red', '  Tx ' + (i + 1) + ' -> FAIL (' + (r.data.error || r.data.message) + ')'));
        }
    });

    const after = await httpGet('/uncached-product/' + productId);
    const stockAfter = after.data.stock || (after.data.data ? after.data.data.stock : null);
    console.log();
    console.log(c('blue', 'Stock after:  ' + stockAfter));
    console.log(c('blue', 'Expected:     ' + (stockBefore - successCount) + ' (stock_before - successful_orders)'));

    if (stockAfter === stockBefore - successCount) {
        console.log(c('green', '\nOK ACID ISOLATION - All ' + successCount + ' transactions applied correctly!'));
        console.log(c('green', '  -> No lost updates, no phantom reads, no dirty reads'));
    } else {
        const lost = successCount - (stockBefore - stockAfter);
        if (lost > 0) {
            console.log(c('red', '\nX ISOLATION FAILED! Lost ' + lost + ' updates'));
        }
    }
    console.log(c('gray', '  Success: ' + successCount + ' | Failed: ' + failCount));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function modeDemo() {
    printHeader('FULL DEMO - Parallel Programming Concepts');

    await modeWhoami();
    await sleep(500);

    printSubHeader('Step 1: Cache Performance (Cache-Aside)');
    await modeCache(1, 10);
    await sleep(500);

    printSubHeader('Step 2: Race Condition in Cache (Unsafe)');
    await modeCacheUnsafe(2, 10);
    await sleep(500);

    printSubHeader('Step 3: Atomic Operations in Cache (Safe)');
    await modeCacheSafe(3, 10);
    await sleep(500);

    printSubHeader('Step 4: DB Race Condition (Unsafe)');
    await modeUnsafe(4, 10);
    await sleep(500);

    printSubHeader('Step 5: DB Pessimistic Locking (Safe)');
    await modeSafe(5, 10);
    await sleep(500);

    printSubHeader('Step 6: ACID Transaction - Success');
    await modeAcidSuccess(6, 2);
    await sleep(500);

    printSubHeader('Step 7: ACID Transaction - Fail (Rollback demo)');
    await modeAcidFail(6, 1);
    await sleep(500);

    printSubHeader('Step 8: ACID Transaction - Concurrent (Isolation demo)');
    await modeAcidConcurrent(6, 10);

    printHeader('DEMO COMPLETE');
    console.log(c('green', 'OK - All parallel programming concepts demonstrated!'));
}

async function main() {
    const argv = process.argv;
    const mode = argv[2];
    const args = argv.slice(3);

    if (!mode) {
        console.log(c('cyan', c('bold', '\nEcommerce Parallel Programming - Test Client')));
        console.log(c('gray', 'Distributed Caching with Redis + ACID Edition\n'));
        console.log('Using BASE_URL = ' + c('green', BASE_URL));
        console.log('Usage:');
        console.log('  node client.cjs whoami                  Test server identity');
        console.log('  node client.cjs create <userId> <productId>   Create order');
        console.log('  node client.cjs complete <orderId>      Complete order (triggers job)');
        console.log('  node client.cjs unsafe <productId> [N]   DB race condition (N concurrent)');
        console.log('  node client.cjs safe <productId> [N]     DB with locking (N concurrent)');
        console.log('  node client.cjs cache <productId> [N]    Cache vs DB performance');
        console.log('  node client.cjs cache-unsafe <productId> [N]  Redis race condition');
        console.log('  node client.cjs cache-safe <productId> [N]    Redis atomic DECRBY');
        console.log('  node client.cjs acid-success <pid> [qty]  ACID transaction (success)');
        console.log('  node client.cjs acid-fail <pid> [qty]     ACID transaction (rollback demo)');
        console.log('  node client.cjs acid-concurrent <pid> [N] ACID isolation (N concurrent)');
        console.log('  node client.cjs demo                     Full demo of all concepts');
        process.exit(0);
    }

    switch (mode) {
        case 'whoami':
            await modeWhoami();
            break;
        case 'create':
            if (args.length < 2) {
                console.log(c('red', 'Usage: node client.cjs create <userId> <productId>'));
                process.exit(1);
            }
            await modeCreate(args[0], args[1]);
            break;
        case 'complete':
            if (args.length < 1) {
                console.log(c('red', 'Usage: node client.cjs complete <orderId>'));
                process.exit(1);
            }
            await modeComplete(args[0]);
            break;
        case 'unsafe':
            await modeUnsafe(args[0] || 1, parseInt(args[1] || 10));
            break;
        case 'safe':
            await modeSafe(args[0] || 1, parseInt(args[1] || 10));
            break;
        case 'cache':
            await modeCache(args[0] || 1, parseInt(args[1] || 10));
            break;
        case 'cache-unsafe':
            await modeCacheUnsafe(args[0] || 1, parseInt(args[1] || 10));
            break;
        case 'cache-safe':
            await modeCacheSafe(args[0] || 1, parseInt(args[1] || 10));
            break;
        case 'acid-success':
            await modeAcidSuccess(args[0] || 1, parseInt(args[1] || 1));
            break;
        case 'acid-fail':
            await modeAcidFail(args[0] || 1, parseInt(args[1] || 1));
            break;
        case 'acid-concurrent':
            await modeAcidConcurrent(args[0] || 1, parseInt(args[1] || 10));
            break;
        case 'demo':
            await modeDemo();
            break;
        default:
            console.log(c('red', 'Unknown mode: ' + mode));
            console.log(c('gray', 'Run "node client.cjs" for usage.'));
            process.exit(1);
    }
}

main().catch(err => {
    console.error(c('red', 'Fatal error: ' + err.message));
    process.exit(1);
});
