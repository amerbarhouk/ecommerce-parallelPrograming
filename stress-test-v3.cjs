#!/usr/bin/env node
/**
 * ============================================================
 * Stress Test v3 - with Capacity Control Awareness
 * ============================================================
 *
 * Requirement #9: Stress Testing under 100+ concurrent users
 * Requirement #2: Resource Management & Capacity Control
 *
 * v3 changes:
 *   - Recognizes 503 as "graceful degradation" (capacity limit reached)
 *   - Differentiates: SUCCESS vs THROTTLED vs FAILED
 *   - Reports capacity utilization from /proxy-stats
 *   - "Stable" verdict considers graceful 503s as OK
 *   - Higher timeout (45s) for write-heavy scenarios
 *   - Uses /stress/* endpoints (no sleep)
 *
 * Stability criteria:
 *   - success_rate + throttle_rate >= 95% = STABLE
 *   - True failures (5xx other than 503, timeouts) < 5% = STABLE
 *   - 503 from capacity limiter = graceful (not failure)
 *
 * USAGE:
 *   node stress-test-v3.cjs <scenario> [concurrent] [duration_sec]
 * ============================================================
 */

const http = require('http');
const os = require('os');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const DEFAULT_CONCURRENT = 100;
const DEFAULT_DURATION_SEC = 30;
const REQUEST_TIMEOUT_MS = 45000;

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

function c(color, text) { return colors[color] + text + colors.reset; }

// ============================================================
// HTTP
// ============================================================
function httpRequest(method, path, body) {
    return new Promise((resolve) => {
        const start = Date.now();
        const url = BASE_URL + path;
        const opts = { method, timeout: REQUEST_TIMEOUT_MS };

        if (method === 'POST' && body) {
            const postData = JSON.stringify(body);
            opts.headers = {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            };
        }

        const req = http.request(url, opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
                resolve({
                    status: res.statusCode,
                    data: parsed,
                    ms: Date.now() - start,
                    backendPort: res.headers['x-backend-port'] || null,
                    capacityStatus: res.headers['x-capacity-status'] || null,
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    throttled: res.statusCode === 503,
                });
            });
        });

        req.on('error', (e) => {
            resolve({
                status: 0,
                data: null,
                ms: Date.now() - start,
                backendPort: null,
                capacityStatus: null,
                ok: false,
                throttled: false,
                error: e.message,
            });
        });

        req.on('timeout', () => {
            req.destroy(new Error('REQUEST_TIMEOUT'));
        });

        if (method === 'POST' && body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

function httpGet(path) { return httpRequest('GET', path); }
function httpPost(path, body) { return httpRequest('POST', path, body); }

// ============================================================
// SCENARIOS
// ============================================================
const scenarios = {
    ping: {
        name: 'PING - Pure LB Throughput',
        description: 'Lightest test. Pure proxy+framework overhead.',
        type: 'read',
        path: '/stress/ping',
        productId: null,
    },
    whoami: {
        name: 'WHOAMI - LB Distribution',
        description: 'Verifies Load Balancer distributes across backends.',
        type: 'read',
        path: '/whoami',
        productId: null,
    },
    cache: {
        name: 'CACHE - Cache-Aside Read Stress',
        description: 'Read-heavy stress on Redis Cache-Aside pattern.',
        type: 'read',
        path: '/cached-product/1',
        productId: 1,
    },
    safe: {
        name: 'SAFE - Pessimistic Locking (Fast)',
        description: 'Write-heavy with lockForUpdate. Expected: 0 data loss.',
        type: 'write',
        path: '/stress/safe-fast/5',
        productId: 5,
    },
    acid: {
        name: 'ACID - Atomic Transaction Stress',
        description: 'POST /order/atomic with concurrency. Expected: 0 data loss.',
        type: 'write',
        path: '/order/atomic',
        productId: 6,
        body: { product_id: 6, quantity: 1, fail_after: false },
        method: 'POST',
    },
    mixed: {
        name: 'MIXED - Realistic E-commerce Load',
        description: '60% ping + 20% cache + 20% safe-fast writes.',
        type: 'mixed',
    },
    overload: {
        name: 'OVERLOAD - Push Beyond Capacity (503 expected)',
        description: 'High concurrency to test graceful degradation. 503 = OK.',
        type: 'write',
        path: '/stress/safe-fast/5',
        productId: 5,
        expected503: true,
    },
};

// ============================================================
// STATS
// ============================================================
class Stats {
    constructor(name) {
        this.name = name;
        this.total = 0;
        this.success = 0;
        this.throttled = 0;  // 503 from capacity limiter
        this.failures = 0;   // true failures
        this.errors = {};
        this.statusCodes = {};
        this.responseTimes = [];
        this.backendPorts = new Set();
        this.startTime = null;
        this.endTime = null;
        this.errorsList = [];
        this.dataIntegrity = {
            stockBefore: null,
            stockAfter: null,
            expectedWrites: 0,
            lostUpdates: 0,
        };
    }

    start() { this.startTime = Date.now(); }
    stop() { this.endTime = Date.now(); }

    record(result) {
        this.total++;
        this.responseTimes.push(result.ms);
        if (result.backendPort) this.backendPorts.add(result.backendPort);
        this.statusCodes[result.status] = (this.statusCodes[result.status] || 0) + 1;

        if (result.ok) {
            this.success++;
        } else if (result.throttled) {
            this.throttled++;
        } else {
            this.failures++;
            const errMsg = result.error || ('HTTP ' + result.status);
            this.errors[errMsg] = (this.errors[errMsg] || 0) + 1;
            if (this.errorsList.length < 10) {
                this.errorsList.push({
                    status: result.status,
                    error: errMsg,
                    ms: result.ms,
                    data: typeof result.data === 'object' ? JSON.stringify(result.data).substring(0, 200) : String(result.data).substring(0, 200),
                });
            }
        }
    }

    getPercentile(p) {
        if (this.responseTimes.length === 0) return 0;
        const sorted = [...this.responseTimes].sort((a, b) => a - b);
        const idx = Math.floor((p / 100) * sorted.length);
        return sorted[Math.min(idx, sorted.length - 1)];
    }

    summary() {
        const duration = (this.endTime - this.startTime) / 1000;
        const rps = duration > 0 ? (this.total / duration).toFixed(2) : 0;
        const avgMs = this.responseTimes.length > 0
            ? (this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length).toFixed(2)
            : 0;

        // For overload scenario: success + throttled = stable
        const stableRate = this.total > 0
            ? (((this.success + this.throttled) / this.total) * 100).toFixed(2)
            : 0;

        return {
            name: this.name,
            duration_sec: duration.toFixed(2),
            total_requests: this.total,
            success: this.success,
            throttled: this.throttled,
            failures: this.failures,
            success_rate: this.total > 0 ? ((this.success / this.total) * 100).toFixed(2) + '%' : '0%',
            throttle_rate: this.total > 0 ? ((this.throttled / this.total) * 100).toFixed(2) + '%' : '0%',
            failure_rate: this.total > 0 ? ((this.failures / this.total) * 100).toFixed(2) + '%' : '0%',
            stable_rate: stableRate + '%',  // success + throttled
            rps,
            avg_ms: avgMs,
            p50_ms: this.getPercentile(50),
            p90_ms: this.getPercentile(90),
            p95_ms: this.getPercentile(95),
            p99_ms: this.getPercentile(99),
            max_ms: Math.max(...this.responseTimes, 0),
            min_ms: this.responseTimes.length > 0 ? Math.min(...this.responseTimes) : 0,
            status_codes: this.statusCodes,
            backend_distribution: [...this.backendPorts],
            errors: this.errors,
            sample_errors: this.errorsList,
            data_integrity: this.dataIntegrity,
        };
    }
}

// ============================================================
// WORKER
// ============================================================
async function worker(stats, scenario, endTime) {
    while (Date.now() < endTime) {
        let result;
        if (scenario.type === 'mixed') {
            const r = Math.random();
            if (r < 0.6) {
                result = await httpGet('/stress/ping');
            } else if (r < 0.8) {
                result = await httpGet('/cached-product/' + (Math.floor(Math.random() * 5) + 1));
            } else {
                result = await httpGet('/stress/safe-fast/5');
            }
        } else if (scenario.method === 'POST') {
            result = await httpPost(scenario.path, scenario.body);
        } else {
            result = await httpGet(scenario.path);
        }
        stats.record(result);
    }
}

// ============================================================
// HELPERS
// ============================================================
async function getStock(productId) {
    const res = await httpGet('/stress/stock/' + productId);
    if (res.status !== 200) return null;
    return res.data.stock;
}

async function resetStock(productId, stock) {
    const res = await httpPost('/stress/reset-stock/' + productId + '?stock=' + stock, {});
    return res.status === 200;
}

async function getProxyStats() {
    const res = await httpGet('/proxy-stats');
    return res.status === 200 ? res.data : null;
}

// ============================================================
// RUN SCENARIO
// ============================================================
async function runScenario(scenarioKey, concurrent, durationSec) {
    const scenario = scenarios[scenarioKey];
    if (!scenario) return null;

    const stats = new Stats(scenario.name);

    if (scenario.productId) {
        const stock = await getStock(scenario.productId);
        if (stock === null) {
            console.log(c('red', 'X Cannot read product #' + scenario.productId + ' stock'));
            console.log(c('yellow', '  Make sure StressTestController is installed.'));
            return null;
        }
        stats.dataIntegrity.stockBefore = stock;
        console.log(c('blue', 'Stock before: ' + stock));
    }

    console.log('\n' + c('cyan', c('bold', '='.repeat(70))));
    console.log(c('cyan', c('bold', '  STRESS TEST: ' + scenario.name)));
    console.log(c('cyan', c('bold', '='.repeat(70))));
    console.log(c('gray', '  ' + scenario.description));
    console.log(c('gray', '  Concurrent: ' + concurrent + ' | Duration: ' + durationSec + 's | Target: ' + BASE_URL));
    console.log(c('gray', '  Started: ' + new Date().toLocaleTimeString()));
    console.log();

    // Show capacity before test
    const proxyStatsBefore = await getProxyStats();
    if (proxyStatsBefore) {
        console.log(c('gray', '  Capacity: ' + proxyStatsBefore.capacity.current_active + '/' + proxyStatsBefore.capacity.max_total_concurrent + ' active, ' + proxyStatsBefore.capacity.healthy_backends + ' backends'));
    }
    console.log();

    stats.start();
    const endTime = Date.now() + (durationSec * 1000);

    const workers = [];
    for (let i = 0; i < concurrent; i++) {
        workers.push(worker(stats, scenario, endTime));
    }

    const progressInterval = setInterval(() => {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        const remaining = (durationSec - elapsed).toFixed(1);
        process.stdout.write('\r' + c('yellow', '  [' + elapsed + 's/' + durationSec + 's] ') +
            c('green', 'OK=' + stats.success) + ' ' +
            c('blue', 'THROTTLE=' + stats.throttled) + ' ' +
            c('red', 'FAIL=' + stats.failures) + ' ' +
            c('gray', '(' + remaining + 's left)        '));
    }, 1000);

    await Promise.all(workers);
    clearInterval(progressInterval);
    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    stats.stop();

    if (scenario.productId) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const stockAfter = await getStock(scenario.productId);
        stats.dataIntegrity.stockAfter = stockAfter;
        console.log(c('blue', 'Stock after:  ' + stockAfter));

        const expectedWrites = (stats.statusCodes['200'] || 0) + (stats.statusCodes['201'] || 0);
        const expectedStock = stats.dataIntegrity.stockBefore - expectedWrites;
        stats.dataIntegrity.expectedWrites = expectedWrites;
        stats.dataIntegrity.lostUpdates = expectedStock - stockAfter;
    }

    // Show proxy stats after test
    const proxyStatsAfter = await getProxyStats();
    printStats(stats, scenario, proxyStatsAfter);

    return stats.summary();
}

// ============================================================
// PRINT STATS
// ============================================================
function printStats(stats, scenario, proxyStats) {
    const s = stats.summary();

    console.log('\n' + c('magenta', c('bold', '  TEST RESULTS')));
    console.log(c('magenta', '  ' + '-'.repeat(66)));

    console.log(c('bold', '\n  PERFORMANCE:'));
    console.log('    Total requests:    ' + c('cyan', s.total_requests));
    console.log('    Duration:          ' + s.duration_sec + 's');
    console.log('    Requests/sec:      ' + c('green', s.rps));
    console.log('    Avg response time: ' + s.avg_ms + 'ms');
    console.log('    Min / Max:         ' + s.min_ms + 'ms / ' + s.max_ms + 'ms');

    console.log(c('bold', '\n  PERCENTILES:'));
    console.log('    p50: ' + c('yellow', s.p50_ms + 'ms') + '  p90: ' + c('yellow', s.p90_ms + 'ms'));
    console.log('    p95: ' + c('yellow', s.p95_ms + 'ms') + '  p99: ' + c('red', s.p99_ms + 'ms'));

    console.log(c('bold', '\n  BREAKDOWN:'));
    console.log('    ' + c('green', 'SUCCESS') + '   : ' + s.success + ' (' + s.success_rate + ')');
    console.log('    ' + c('blue', 'THROTTLED') + ' : ' + s.throttled + ' (' + s.throttle_rate + ') [503 from capacity limiter]');
    console.log('    ' + c('red', 'FAILURES') + ' : ' + s.failures + ' (' + s.failure_rate + ') [timeouts, 5xx other than 503]');
    console.log('    ' + c('cyan', 'STABLE') + '    : ' + s.stable_rate + ' [success + throttled]');

    console.log(c('bold', '\n  HTTP STATUS CODES:'));
    Object.keys(s.status_codes).sort().forEach(code => {
        const count = s.status_codes[code];
        const pct = ((count / s.total_requests) * 100).toFixed(1);
        const label = code === '0' ? 'Conn Error' : 'HTTP ' + code;
        let color = 'red';
        if (code === '200' || code === '201') color = 'green';
        else if (code === '503') color = 'blue';  // graceful
        else if (code === '409') color = 'yellow';
        console.log('    ' + c(color, label.padEnd(15)) + ' : ' + String(count).padStart(6) + ' (' + pct + '%)');
    });

    if (s.backend_distribution.length > 0) {
        console.log(c('bold', '\n  LOAD BALANCER DISTRIBUTION:'));
        console.log('    Backends hit: ' + c('cyan', s.backend_distribution.length + ' / 5'));
        console.log('    Ports:        ' + s.backend_distribution.join(', '));
    }

    // Capacity utilization from proxy
    if (proxyStats) {
        console.log(c('bold', '\n  CAPACITY UTILIZATION (from proxy):'));
        console.log('    Max concurrent:    ' + proxyStats.capacity.max_total_concurrent);
        console.log('    Current active:   ' + proxyStats.capacity.current_active);
        console.log('    Utilization:      ' + proxyStats.capacity.utilization_pct);
        console.log('    Healthy backends: ' + proxyStats.capacity.healthy_backends + '/' + proxyStats.capacity.total_backends);
        console.log('    Total 503s:       ' + proxyStats.proxy.total_503);
        console.log('    Queue overflow:   ' + (proxyStats.proxy.total_503 - stats.throttled > 0 ? 'YES (queue was full)' : 'NO'));
    }

    if (Object.keys(s.errors).length > 0) {
        console.log(c('bold', '\n  ERRORS (true failures, not 503):'));
        Object.entries(s.errors).sort((a, b) => b[1] - a[1]).forEach(([err, count]) => {
            console.log('    ' + c('red', err.padEnd(35)) + ' : ' + count);
        });
    }

    if (s.data_integrity.stockBefore !== null && s.data_integrity.stockAfter !== null) {
        console.log(c('bold', '\n  DATA INTEGRITY:'));
        console.log('    Stock before/after: ' + s.data_integrity.stockBefore + ' / ' + s.data_integrity.stockAfter);
        console.log('    Successful writes:  ' + s.data_integrity.expectedWrites);
        const lost = s.data_integrity.lostUpdates;
        console.log('    Lost updates:       ' + c(lost > 0 ? 'red' : 'green', lost));
        if (lost === 0 && s.data_integrity.expectedWrites > 0) {
            console.log(c('green', '    OK - DATA INTEGRITY PRESERVED'));
        } else if (lost > 0) {
            console.log(c('red', '    X DATA LOSS DETECTED'));
        }
    }

    // Stability verdict (success + throttled = stable)
    console.log(c('bold', '\n  STABILITY VERDICT:'));
    const stableRate = parseFloat(s.stable_rate);
    const failureRate = parseFloat(s.failure_rate);

    if (stableRate >= 95 && failureRate < 5) {
        console.log(c('green', '    OK - System STABLE under load'));
        console.log(c('green', '    -> success (' + s.success_rate + ') + throttled (' + s.throttle_rate + ') >= 95%'));
        console.log(c('green', '    -> True failures (' + s.failure_rate + ') < 5%'));
        if (stats.throttled > 0) {
            console.log(c('cyan', '    -> Capacity control worked: ' + stats.throttled + ' requests gracefully rejected with 503'));
        }
    } else {
        console.log(c('red', '    X INSTABILITY DETECTED'));
        console.log(c('yellow', '    -> True failures too high (' + s.failure_rate + ')'));
        console.log(c('yellow', '    -> This indicates the system CRASHED, not just throttled'));
    }

    console.log('\n' + c('gray', '  Finished: ' + new Date().toLocaleTimeString()) + '\n');
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    const argv = process.argv;
    const scenario = argv[2];
    const concurrent = parseInt(argv[3] || DEFAULT_CONCURRENT);
    const durationSec = parseInt(argv[4] || DEFAULT_DURATION_SEC);

    console.log(c('cyan', c('bold', '\n' + '='.repeat(70))));
    console.log(c('cyan', c('bold', '  STRESS TEST v3 - with Capacity Control')));
    console.log(c('cyan', c('bold', '  Requirement #9 + #2: Stability + Capacity Control')));
    console.log(c('cyan', c('bold', '='.repeat(70))));
    console.log(c('gray', '  Target:  ' + BASE_URL));
    console.log(c('gray', '  Machine: ' + os.hostname() + ' | ' + os.cpus().length + ' CPUs | ' + Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB RAM'));

    if (!scenario) {
        console.log('\n' + c('yellow', c('bold', 'USAGE:')));
        console.log('  node stress-test-v3.cjs <scenario> [concurrent] [duration_sec]');
        console.log('\n' + c('yellow', c('bold', 'SCENARIOS:')));
        Object.entries(scenarios).forEach(([key, s]) => {
            console.log('  ' + c('cyan', key.padEnd(10)) + ' - ' + s.name);
        });
        console.log('\n' + c('yellow', c('bold', 'EXAMPLES:')));
        console.log('  node stress-test-v3.cjs all 100 30');
        console.log('  node stress-test-v3.cjs overload 200 30  # expect 503s (graceful)');
        console.log('  node stress-test-v3.cjs safe 100 30');
        process.exit(0);
    }

    if (scenario === 'all') {
        const allResults = {};
        const keys = ['ping', 'whoami', 'cache', 'safe', 'acid', 'mixed', 'overload'];

        console.log('\n' + c('yellow', '[Setup] Resetting stocks...'));
        await resetStock(4, 2000);
        await resetStock(5, 2000);
        await resetStock(6, 2000);
        console.log(c('green', '  OK - Stocks reset'));

        for (const key of keys) {
            const conc = (key === 'overload') ? Math.max(concurrent, 200) : concurrent;
            allResults[key] = await runScenario(key, conc, durationSec);
            if (key !== keys[keys.length - 1]) {
                console.log(c('gray', '  (5s pause)'));
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Final summary
        console.log('\n' + c('cyan', c('bold', '='.repeat(70))));
        console.log(c('cyan', c('bold', '  FINAL SUMMARY - ALL SCENARIOS')));
        console.log(c('cyan', c('bold', '='.repeat(70))));
        console.log('  ' + c('bold', 'Scenario'.padEnd(12)) + 'Req    OK    Thr   Fail  Stable  p95     Lost   Verdict');
        console.log('  ' + '-'.repeat(75));
        Object.entries(allResults).forEach(([key, s]) => {
            if (!s) return;
            const stableRate = parseFloat(s.stable_rate);
            const verdict = stableRate >= 95 ? c('green', 'STABLE') : c('red', 'UNSTABLE');
            const lost = s.data_integrity.stockBefore !== null ? s.data_integrity.lostUpdates : 'N/A';
            console.log('  ' + c('bold', key.padEnd(12)) +
                String(s.total_requests).padStart(5) + '  ' +
                String(s.success).padStart(5) + '  ' +
                String(s.throttled).padStart(5) + '  ' +
                String(s.failures).padStart(5) + '  ' +
                (s.stable_rate).padStart(7) + '  ' +
                (s.p95_ms + 'ms').padStart(7) + '  ' +
                String(lost).padStart(5) + '  ' +
                verdict);
        });
        console.log('  ' + '-'.repeat(75));

        const report = {
            timestamp: new Date().toISOString(),
            target: BASE_URL,
            machine: {
                hostname: os.hostname(),
                cpus: os.cpus().length,
                memory_gb: Math.round(os.totalmem() / 1024 / 1024 / 1024),
                node_version: process.version,
            },
            parameters: { concurrent, duration_sec: durationSec },
            results: allResults,
        };
        fs.writeFileSync('stress-test-report-v3.json', JSON.stringify(report, null, 2));
        console.log('\n' + c('green', 'OK Report saved: stress-test-report-v3.json'));
    } else {
        await runScenario(scenario, concurrent, durationSec);
    }
}

main().catch(err => {
    console.error(c('red', 'Fatal: ' + err.message));
    console.error(err.stack);
    process.exit(1);
});
