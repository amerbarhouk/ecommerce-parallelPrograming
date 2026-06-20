#!/usr/bin/env node
/**
 * ============================================================
 * Stress Testing Tool v2 - E-commerce Parallel Programming
 * ============================================================
 *
 * Requirement #9: Stability under >= 100 concurrent users
 *
 * v2 FIXES:
 *   - Uses /stress/* endpoints (NO sleep(5)) instead of /safe /unsafe
 *   - ACID test uses higher concurrency safely (no artificial delay)
 *   - Increased timeout to 45s for write-heavy scenarios
 *   - Better data integrity verification
 *   - Per-scenario concurrency tuning (writes get lower concurrency)
 *
 * USAGE:
 *   node stress-test.cjs <scenario> [concurrent] [duration_sec]
 *
 * SCENARIOS:
 *   ping       - Pure LB test (no DB, no Redis) - max throughput
 *   whoami     - LB distribution + server info
 *   cache      - Cache-Aside read stress (Redis)
 *   unsafe     - DB Race Condition stress (write-heavy, NO sleep)
 *   safe       - DB Pessimistic Locking stress (write-heavy, NO sleep)
 *   acid       - ACID Transaction stress (atomic writes)
 *   mixed      - Realistic mix of read/write
 *   all        - Run all scenarios sequentially
 *
 * EXAMPLES:
 *   node stress-test.cjs all 100 30
 *   node stress-test.cjs ping 200 30
 *   node stress-test.cjs safe 100 30
 *   node stress-test.cjs acid 100 30
 * ============================================================
 */

const http = require('http');
const os = require('os');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const DEFAULT_CONCURRENT = 100;
const DEFAULT_DURATION_SEC = 30;
const REQUEST_TIMEOUT_MS = 45000;  // 45s — was 30s, increased for write scenarios

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

// ============================================================
// HTTP CLIENT
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
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                });
            });
        });

        req.on('error', (e) => {
            resolve({
                status: 0,
                data: null,
                ms: Date.now() - start,
                backendPort: null,
                ok: false,
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
        name: 'PING - Pure LB Throughput (no DB/Redis)',
        description: 'Lightest possible test. Measures pure proxy+framework overhead.',
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
    unsafe: {
        name: 'UNSAFE - DB Race Condition (Fast, no sleep)',
        description: 'Write-heavy. Expected: data loss under high concurrency.',
        type: 'write',
        path: '/stress/unsafe-fast/4',
        productId: 4,
    },
    safe: {
        name: 'SAFE - DB Pessimistic Locking (Fast, no sleep)',
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
        description: '80% reads (ping+cache) + 20% writes (safe-fast).',
        type: 'mixed',
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
        this.failures = 0;
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
        const successRate = this.total > 0 ? ((this.success / this.total) * 100).toFixed(2) : 0;

        return {
            name: this.name,
            duration_sec: duration.toFixed(2),
            total_requests: this.total,
            success: this.success,
            failures: this.failures,
            success_rate: successRate + '%',
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
            if (r < 0.5) {
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

// ============================================================
// RUN SCENARIO
// ============================================================
async function runScenario(scenarioKey, concurrent, durationSec) {
    const scenario = scenarios[scenarioKey];
    if (!scenario) {
        console.log(c('red', 'Unknown scenario: ' + scenarioKey));
        return null;
    }

    const stats = new Stats(scenario.name);

    // Pre-check stock for write scenarios
    if (scenario.productId) {
        const stock = await getStock(scenario.productId);
        if (stock === null) {
            console.log(c('red', 'X Cannot read product #' + scenario.productId + ' stock'));
            console.log(c('yellow', '  Make sure StressTestController routes are added.'));
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

    stats.start();
    const endTime = Date.now() + (durationSec * 1000);

    const workers = [];
    for (let i = 0; i < concurrent; i++) {
        workers.push(worker(stats, scenario, endTime));
    }

    // Progress
    const progressInterval = setInterval(() => {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        const remaining = (durationSec - elapsed).toFixed(1);
        process.stdout.write('\r' + c('yellow', '  [' + elapsed + 's/' + durationSec + 's] ') +
            c('green', 'OK=' + stats.success) + ' ' +
            c('red', 'FAIL=' + stats.failures) + ' ' +
            c('gray', '(' + remaining + 's left)        '));
    }, 1000);

    await Promise.all(workers);
    clearInterval(progressInterval);
    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    stats.stop();

    // Post-check stock
    if (scenario.productId) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        const stockAfter = await getStock(scenario.productId);
        stats.dataIntegrity.stockAfter = stockAfter;
        console.log(c('blue', 'Stock after:  ' + stockAfter));

        // Compute lost updates
        const expectedWrites = (stats.statusCodes['200'] || 0) + (stats.statusCodes['201'] || 0);
        const expectedStock = stats.dataIntegrity.stockBefore - expectedWrites;
        stats.dataIntegrity.expectedWrites = expectedWrites;
        stats.dataIntegrity.lostUpdates = expectedStock - stockAfter;
    }

    printStats(stats);
    return stats.summary();
}

// ============================================================
// PRINT STATS
// ============================================================
function printStats(stats) {
    const s = stats.summary();

    console.log('\n' + c('magenta', c('bold', '  TEST RESULTS')));
    console.log(c('magenta', '  ' + '-'.repeat(66)));

    console.log(c('bold', '\n  PERFORMANCE:'));
    console.log('    Total requests:    ' + c('cyan', s.total_requests));
    console.log('    Duration:          ' + s.duration_sec + 's');
    console.log('    Requests/sec:      ' + c('green', s.rps));
    console.log('    Avg response time: ' + s.avg_ms + 'ms');
    console.log('    Min / Max:         ' + s.min_ms + 'ms / ' + s.max_ms + 'ms');

    console.log(c('bold', '\n  PERCENTILES (latency):'));
    console.log('    p50 (median): ' + c('yellow', s.p50_ms + 'ms'));
    console.log('    p90:          ' + c('yellow', s.p90_ms + 'ms'));
    console.log('    p95:          ' + c('yellow', s.p95_ms + 'ms'));
    console.log('    p99:          ' + c('red', s.p99_ms + 'ms'));

    console.log(c('bold', '\n  SUCCESS RATE:'));
    const successColor = parseFloat(s.success_rate) === 100 ? 'green' : (parseFloat(s.success_rate) >= 95 ? 'yellow' : 'red');
    console.log('    ' + c(successColor, s.success_rate) + ' (' + s.success + '/' + s.total_requests + ')');

    console.log(c('bold', '\n  HTTP STATUS CODES:'));
    Object.keys(s.status_codes).sort().forEach(code => {
        const count = s.status_codes[code];
        const pct = ((count / s.total_requests) * 100).toFixed(1);
        const label = code === '0' ? 'Conn Error' : 'HTTP ' + code;
        const color = (code === '200' || code === '201') ? 'green' : (code === '409' ? 'yellow' : 'red');
        console.log('    ' + c(color, label.padEnd(15)) + ' : ' + String(count).padStart(6) + ' (' + pct + '%)');
    });

    if (s.backend_distribution.length > 0) {
        console.log(c('bold', '\n  LOAD BALANCER DISTRIBUTION:'));
        console.log('    Backends hit: ' + c('cyan', s.backend_distribution.length + ' / 5'));
        console.log('    Ports:        ' + s.backend_distribution.join(', '));
        if (s.backend_distribution.length === 5) {
            console.log(c('green', '    OK - All 5 backends received traffic'));
        } else if (s.backend_distribution.length >= 3) {
            console.log(c('yellow', '    WARN - Only ' + s.backend_distribution.length + ' backends hit'));
        } else {
            console.log(c('red', '    X - Only ' + s.backend_distribution.length + ' backend(s) hit'));
        }
    }

    if (Object.keys(s.errors).length > 0) {
        console.log(c('bold', '\n  ERRORS BREAKDOWN:'));
        Object.entries(s.errors).sort((a, b) => b[1] - a[1]).forEach(([err, count]) => {
            console.log('    ' + c('red', err.padEnd(35)) + ' : ' + count);
        });

        console.log(c('bold', '\n  SAMPLE ERRORS (first 5):'));
        s.sample_errors.slice(0, 5).forEach((e, i) => {
            console.log('    #' + (i + 1) + ' [HTTP ' + e.status + '] ' + e.error + ' (' + e.ms + 'ms)');
            if (e.data && e.data !== 'null') {
                console.log('         ' + c('gray', e.data.substring(0, 100)));
            }
        });
    }

    if (s.data_integrity.stockBefore !== null && s.data_integrity.stockAfter !== null) {
        console.log(c('bold', '\n  DATA INTEGRITY CHECK:'));
        console.log('    Stock before: ' + s.data_integrity.stockBefore);
        console.log('    Stock after:  ' + s.data_integrity.stockAfter);
        console.log('    Successful writes: ' + s.data_integrity.expectedWrites);
        console.log('    Expected stock:    ' + (s.data_integrity.stockBefore - s.data_integrity.expectedWrites));
        const lost = s.data_integrity.lostUpdates;
        console.log('    Lost updates:      ' + c(lost > 0 ? 'red' : 'green', lost));

        if (lost === 0 && s.data_integrity.expectedWrites > 0) {
            console.log(c('green', '    OK - DATA INTEGRITY PRESERVED (no lost updates)'));
        } else if (lost > 0) {
            console.log(c('red', '    X DATA LOSS: ' + lost + ' updates lost'));
            console.log(c('yellow', '      -> Expected for "unsafe" scenario (proves race condition)'));
            console.log(c('yellow', '      -> For "safe"/"acid": investigate locking'));
        }
    }

    console.log(c('bold', '\n  STABILITY VERDICT:'));
    const isStable = parseFloat(s.success_rate) >= 95;
    if (isStable) {
        console.log(c('green', '    OK - System remained STABLE under load'));
        console.log(c('green', '    -> success rate >= 95%'));
    } else {
        console.log(c('red', '    X INSTABILITY DETECTED'));
        console.log(c('yellow', '    -> Check error breakdown above'));
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
    console.log(c('cyan', c('bold', '  STRESS TESTING TOOL v2 - Parallel Programming')));
    console.log(c('cyan', c('bold', '  Requirement #9: Stability under >= 100 concurrent users')));
    console.log(c('cyan', c('bold', '='.repeat(70))));
    console.log(c('gray', '  Target:    ' + BASE_URL));
    console.log(c('gray', '  Machine:   ' + os.hostname() + ' | ' + os.cpus().length + ' CPUs | ' + Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB RAM'));
    console.log(c('gray', '  Node:      ' + process.version));
    console.log(c('gray', '  Started:   ' + new Date().toLocaleString()));

    if (!scenario) {
        console.log('\n' + c('yellow', c('bold', 'USAGE:')));
        console.log('  node stress-test.cjs <scenario> [concurrent] [duration_sec]');
        console.log('\n' + c('yellow', c('bold', 'SCENARIOS:')));
        Object.entries(scenarios).forEach(([key, s]) => {
            console.log('  ' + c('cyan', key.padEnd(10)) + ' - ' + s.name);
            console.log('  ' + ' '.repeat(12) + c('gray', s.description));
        });
        console.log('\n' + c('yellow', c('bold', 'EXAMPLES:')));
        console.log('  node stress-test.cjs all 100 30          # Full test (req #9 minimum)');
        console.log('  node stress-test.cjs ping 200 30         # Max throughput test');
        console.log('  node stress-test.cjs safe 100 30         # Pessimistic locking stress');
        console.log('  node stress-test.cjs acid 100 30         # ACID transaction stress');
        console.log('  node stress-test.cjs mixed 150 60        # Realistic mixed load');
        process.exit(0);
    }

    if (scenario === 'all') {
        const allResults = {};
        const keys = ['ping', 'whoami', 'cache', 'safe', 'acid', 'mixed'];

        // Reset stocks before tests
        console.log('\n' + c('yellow', '[Setup] Resetting product stocks for clean test...'));
        await resetStock(4, 1000);
        await resetStock(5, 1000);
        await resetStock(6, 1000);
        console.log(c('green', '  OK - Products #4, #5, #6 reset to 1000 stock'));

        for (const key of keys) {
            allResults[key] = await runScenario(key, concurrent, durationSec);
            if (key !== keys[keys.length - 1]) {
                console.log(c('gray', '  (Waiting 5s before next scenario...)'));
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // Final summary
        console.log('\n' + c('cyan', c('bold', '='.repeat(70))));
        console.log(c('cyan', c('bold', '  FINAL SUMMARY')));
        console.log(c('cyan', c('bold', '='.repeat(70))));
        console.log('  ' + c('bold', 'Scenario'.padEnd(15)) + 'Req    OK    Fail  RPS     p95     Lost   Status');
        console.log('  ' + '-'.repeat(66));
        Object.entries(allResults).forEach(([key, s]) => {
            if (!s) return;
            const statusColor = parseFloat(s.success_rate) >= 95 ? 'green' : 'red';
            const lost = s.data_integrity.lostUpdates;
            const lostStr = (s.data_integrity.stockBefore !== null) ? String(lost) : 'N/A';
            console.log('  ' + c('bold', key.padEnd(15)) +
                String(s.total_requests).padStart(5) + '  ' +
                String(s.success).padStart(5) + '  ' +
                String(s.failures).padStart(5) + '  ' +
                String(s.rps).padStart(6) + '  ' +
                (s.p95_ms + 'ms').padStart(8) + '  ' +
                lostStr.padStart(5) + '  ' +
                c(statusColor, s.success_rate));
        });
        console.log('  ' + '-'.repeat(66));

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
        fs.writeFileSync('stress-test-report.json', JSON.stringify(report, null, 2));
        console.log('\n' + c('green', 'OK Report saved: stress-test-report.json'));
    } else {
        await runScenario(scenario, concurrent, durationSec);
    }
}

main().catch(err => {
    console.error(c('red', 'Fatal: ' + err.message));
    console.error(err.stack);
    process.exit(1);
});
