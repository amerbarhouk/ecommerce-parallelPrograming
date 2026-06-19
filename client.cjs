#!/usr/bin/env node
/**
 * Ecommerce Parallel Programming - Test Client
 *
 * Distributed Caching with Redis Edition
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:8000';

// ========================================
// Color helpers
// ========================================
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
    return `${colors[color]}${text}${colors.reset}`;
}

function printHeader(title) {
    console.log('\n' + c('cyan', c('bold', '='.repeat(60))));
    console.log(c('cyan', c('bold', `  ${title}`)));
    console.log(c('cyan', c('bold', '='.repeat(60))));
}

function printSubHeader(title) {
    console.log('\n' + c('magenta', c('bold', `- ${title}`)));
}

// ========================================
// HTTP helpers
// ========================================
function httpGet(path) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        http.get(`${BASE_URL}${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve({ status: res.statusCode, data: json, ms: Date.now() - start });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, ms: Date.now() - start });
                }
            });
        }).on('error', reject);
    });
}

function httpPost(path, body) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const postData = JSON.stringify(body);
        const req = http.request(`${BASE_URL}${path}`, {
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
                    resolve({ status: res.statusCode, data: json, ms: Date.now() - start });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data, ms: Date.now() - start });
                }
            });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
    });
}

// ========================================
// Modes
// ========================================

// 1. whoami
async function modeWhoami() {
    printHeader('WHOAMI - Server Identity Check');
    try {
        const res = await httpGet('/whoami');
        console.log(c('gray', `Status: ${res.status} | Time: ${res.ms}ms`));
        if (res.status === 200) {
            console.log(c('green', 'OK - Server is running'));
            console.log(`  ${JSON.stringify(res.data)}`);
        } else {
            console.log(c('red', 'X - Server not responding'));
        }
    } catch (e) {
        console.log(c('red', `X Error: ${e.message}`));
        console.log(c('yellow', '  Make sure server is running: php artisan serve --port=8000'));
    }
}

// 2. create order
async function modeCreate(userId, productId) {
    printHeader(`CREATE ORDER - User ${userId}, Product ${productId}`);
    try {
        const res = await httpPost('/order', {
            user_id: parseInt(userId),
            product_id: parseInt(productId),
            quantity: 1,
        });
        console.log(c('gray', `Status: ${res.status} | Time: ${res.ms}ms`));
        if (res.status === 200 || res.status === 201) {
            console.log(c('green', 'OK - Order created'));
            console.log(`  ${JSON.stringify(res.data)}`);
        } else {
            console.log(c('red', 'X - Failed'));
            console.log(c('yellow', `  ${JSON.stringify(res.data)}`));
        }
    } catch (e) {
        console.log(c('red', `X Error: ${e.message}`));
    }
}

// 3. complete order
async function modeComplete(orderId) {
    printHeader(`COMPLETE ORDER ${orderId}`);
    try {
        const res = await httpPost('/order/complete', {
            order_id: parseInt(orderId),
        });
        console.log(c('gray', `Status: ${res.status} | Time: ${res.ms}ms`));
        if (res.status === 200) {
            console.log(c('green', 'OK - Order completed'));
            console.log(`  ${JSON.stringify(res.data)}`);
        } else {
            console.log(c('red', 'X - Failed'));
            console.log(c('yellow', `  ${JSON.stringify(res.data)}`));
        }
    } catch (e) {
        console.log(c('red', `X Error: ${e.message}`));
    }
}

// 4. DB unsafe
async function modeUnsafe(productId, concurrent = 10) {
    printHeader(`DB UNSAFE - Product ${productId} (${concurrent} concurrent)`);
    console.log(c('yellow', '  Method: DB + READ-MODIFY-WRITE (Race Condition expected)\n'));

    const before = await httpGet(`/uncached-product/${productId}`);
    if (before.status !== 200) {
        console.log(c('red', `X Product ${productId} not found`));
        return;
    }
    const stockBefore = before.data.stock ?? before.data.data?.stock;
    console.log(c('blue', `Stock before: ${stockBefore}`));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet(`/unsafe/${productId}`));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const after = await httpGet(`/uncached-product/${productId}`);
    const stockAfter = after.data.stock ?? after.data.data?.stock;
    console.log(c('blue', `Stock after:  ${stockAfter}`));
    console.log(c('blue', `Expected:     ${stockBefore - successCount}`));
    console.log();

    const lost = successCount - (stockBefore - stockAfter);
    if (lost > 0) {
        console.log(c('red', `X RACE CONDITION! Lost ${lost} updates`));
    } else {
        console.log(c('green', 'OK - No race condition this time'));
    }
    console.log(c('gray', `  Success: ${successCount} | Failed: ${failCount}`));
}

// 5. DB safe
async function modeSafe(productId, concurrent = 10) {
    printHeader(`DB SAFE - Product ${productId} (${concurrent} concurrent)`);
    console.log(c('yellow', '  Method: DB + Pessimistic Locking (Race Condition safe)\n'));

    const before = await httpGet(`/uncached-product/${productId}`);
    if (before.status !== 200) {
        console.log(c('red', `X Product ${productId} not found`));
        return;
    }
    const stockBefore = before.data.stock ?? before.data.data?.stock;
    console.log(c('blue', `Stock before: ${stockBefore}`));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet(`/safe/${productId}`));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const after = await httpGet(`/uncached-product/${productId}`);
    const stockAfter = after.data.stock ?? after.data.data?.stock;
    console.log(c('blue', `Stock after:  ${stockAfter}`));
    console.log(c('blue', `Expected:     ${stockBefore - successCount}`));
    console.log();

    if (stockAfter === stockBefore - successCount) {
        console.log(c('green', 'OK SAFE - No lost updates (locking worked!)'));
    } else {
        console.log(c('red', 'X - Unexpected result!'));
    }
    console.log(c('gray', `  Success: ${successCount} | Failed: ${failCount}`));
}

// 6. cache performance test (NEW: compares SERVER time, not network time)
async function modeCache(productId, iterations = 10) {
    printHeader(`CACHE TEST - Product ${productId} (${iterations} iterations)`);
    console.log(c('yellow', '  Strategy: Cache-Aside with Stampede Protection\n'));

    // Clear cache first
    await httpGet('/cache-clear');

    printSubHeader('Step 1: Cold Cache (Database hit)');
    const cold = await httpGet(`/cached-product/${productId}`);
    console.log(c('gray', `  Network time: ${cold.ms}ms`));
    if (cold.status === 200) {
        console.log(c('cyan', `  Server time:  ${cold.data.total_time_ms || 'N/A'}ms`));
        console.log(c('cyan', `  Cache status: ${cold.data.cache_status || 'N/A'}`));
        console.log(c('yellow', '  -> First request loads from DB and caches in Redis'));
    }

    printSubHeader(`Step 2: Warm Cache (${iterations} iterations)`);
    const warmServerTimes = [];
    const warmNetworkTimes = [];
    for (let i = 0; i < iterations; i++) {
        const res = await httpGet(`/cached-product/${productId}`);
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
    console.log(c('green', `  Network avg: ${avgWarmNet}ms`));
    console.log(c('green', `  Server avg:  ${avgWarmSrv}ms  (real cache performance!)`));
    console.log(c('gray', `  Server min:  ${minWarmSrv}ms | max: ${maxWarmSrv}ms`));

    printSubHeader(`Step 3: Direct DB (${iterations} iterations)`);
    const dbServerTimes = [];
    const dbNetworkTimes = [];
    for (let i = 0; i < iterations; i++) {
        const res = await httpGet(`/uncached-product/${productId}`);
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
    console.log(c('blue', `  Network avg: ${avgDbNet}ms`));
    console.log(c('blue', `  Server avg:  ${avgDbSrv}ms`));
    console.log(c('gray', `  Server min:  ${minDbSrv}ms | max: ${maxDbSrv}ms`));

    printSubHeader('Performance Comparison (Server time = real cache performance)');
    if (avgWarmSrv !== 'N/A' && avgDbSrv !== 'N/A' && parseFloat(avgWarmSrv) > 0) {
        const speedup = (parseFloat(avgDbSrv) / parseFloat(avgWarmSrv)).toFixed(2);
        console.log(c('magenta', c('bold', `  >> Cache is ${speedup}x faster than DB (server-side)`)));
        console.log(`  Cache server avg: ${c('green', avgWarmSrv + 'ms')}`);
        console.log(`  DB server avg:    ${c('blue', avgDbSrv + 'ms')}`);
    } else {
        const speedup = (parseFloat(avgDbNet) / parseFloat(avgWarmNet)).toFixed(2);
        console.log(c('magenta', c('bold', `  >> Cache is ${speedup}x faster than DB (network)`)));
        console.log(`  Cache network avg: ${c('green', avgWarmNet + 'ms')}`);
        console.log(`  DB network avg:    ${c('blue', avgDbNet + 'ms')}`);
    }

    printSubHeader('Cache Stats');
    const stats = await httpGet('/cache-stats');
    console.log(c('gray', `  ${JSON.stringify(stats.data)}`));
}

// 7. cache unsafe
async function modeCacheUnsafe(productId, concurrent = 10) {
    printHeader(`CACHE UNSAFE - Product ${productId} (${concurrent} concurrent)`);
    console.log(c('yellow', '  Method: Redis + READ-MODIFY-WRITE (Race Condition in cache!)\n'));

    await httpGet('/cache-warm/20');

    const before = await httpGet(`/cached-product/${productId}`);
    if (before.status !== 200) {
        console.log(c('red', `X Product ${productId} not found`));
        return;
    }
    const stockBefore = before.data.stock;
    console.log(c('blue', `Cached stock before: ${stockBefore}`));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet(`/cached-unsafe/${productId}`));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const after = await httpGet(`/cached-product/${productId}`);
    const stockAfter = after.data.stock;
    console.log(c('blue', `Cached stock after:  ${stockAfter}`));
    console.log(c('blue', `Expected:            ${stockBefore - successCount}`));
    console.log();

    const lost = successCount - (stockBefore - stockAfter);
    if (lost > 0) {
        console.log(c('red', `X RACE CONDITION! Lost ${lost} updates in Redis cache`));
    } else {
        console.log(c('yellow', '~ No race condition detected (try more concurrent requests)'));
    }
    console.log(c('gray', `  Success: ${successCount} | Failed: ${failCount}`));
}

// 8. cache safe
async function modeCacheSafe(productId, concurrent = 10) {
    printHeader(`CACHE SAFE - Product ${productId} (${concurrent} concurrent)`);
    console.log(c('yellow', '  Method: Redis + ATOMIC DECRBY (Race Condition safe!)\n'));

    await httpGet('/cache-warm/20');

    const before = await httpGet(`/cached-product/${productId}`);
    if (before.status !== 200) {
        console.log(c('red', `X Product ${productId} not found`));
        return;
    }
    const stockBefore = before.data.stock;
    console.log(c('blue', `Cached stock before: ${stockBefore}`));

    const promises = [];
    for (let i = 0; i < concurrent; i++) {
        promises.push(httpGet(`/cached-safe/${productId}`));
    }
    const results = await Promise.all(promises);

    const successCount = results.filter(r => r.status === 200).length;
    const failCount = results.filter(r => r.status !== 200).length;

    const after = await httpGet(`/cached-product/${productId}`);
    const stockAfter = after.data.stock;
    console.log(c('blue', `Cached stock after:  ${stockAfter}`));
    console.log(c('blue', `Expected:            ${stockBefore - successCount}`));
    console.log();

    if (stockAfter === stockBefore - successCount) {
        console.log(c('green', 'OK ATOMIC - No lost updates in Redis!'));
    } else {
        console.log(c('red', 'X - Unexpected result!'));
    }
    console.log(c('gray', `  Success: ${successCount} | Failed: ${failCount}`));
}

// 9. demo
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

    printHeader('DEMO COMPLETE');
    console.log(c('green', 'OK - All parallel programming concepts demonstrated!'));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========================================
// Main
// ========================================
async function main() {
    const [, , mode, ...args] = process.argv;

    if (!mode) {
        console.log(c('cyan', c('bold', '\nEcommerce Parallel Programming - Test Client')));
        console.log(c('gray', 'Distributed Caching with Redis Edition\n'));
        console.log('Usage:');
        console.log('  node client.cjs whoami                  Test server identity');
        console.log('  node client.cjs create <userId> <productId>   Create order');
        console.log('  node client.cjs complete <orderId>      Complete order (triggers job)');
        console.log('  node client.cjs unsafe <productId> [N]   DB race condition (N concurrent)');
        console.log('  node client.cjs safe <productId> [N]     DB with locking (N concurrent)');
        console.log('  node client.cjs cache <productId> [N]    Cache vs DB performance');
        console.log('  node client.cjs cache-unsafe <productId> [N]  Redis race condition');
        console.log('  node client.cjs cache-safe <productId> [N]    Redis atomic DECRBY');
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
        case 'demo':
            await modeDemo();
            break;
        default:
            console.log(c('red', `Unknown mode: ${mode}`));
            console.log(c('gray', 'Run "node client.cjs" for usage.'));
            process.exit(1);
    }
}

main().catch(err => {
    console.error(c('red', `Fatal error: ${err.message}`));
    process.exit(1);
});
