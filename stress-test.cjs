#!/usr/bin/env node
/**
 * ============================================================
 * Stress Testing Tool - Parallel Programming E-commerce
 * ============================================================
 *
 * Requirement #9: Stress Testing under load (>= 100 concurrent users)
 * - Stability: no crashes
 * - Data Integrity: no data loss
 * - Concurrency: handles parallel requests safely
 *
 * USAGE:
 *   node stress-test.cjs <scenario> [concurrent] [duration_sec]
 *
 * SCENARIOS:
 *   whoami      - Lightest load (LB distribution check)
 *   cache       - Cache-Aside read stress (Redis)
 *   unsafe      - DB Race Condition stress (write-heavy)
 *   safe        - DB Pessimistic Locking stress (write-heavy)
 *   acid        - ACID Transaction stress (atomic writes)
 *   mixed       - Realistic mix of read/write (most realistic)
 *   all         - Run all scenarios sequentially
 *
 * EXAMPLES:
 *   node stress-test.cjs whoami 100 30
 *   node stress-test.cjs cache 200 60
 *   node stress-test.cjs acid 100 30
 *   node stress-test.cjs mixed 150 60
 *   node stress-test.cjs all 100 30
 * ============================================================
 */

const http = require('http');
const os = require('os');

// ============================================================
// CONFIG
// ============================================================
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8080';
const DEFAULT_CONCURRENT = 100;
const DEFAULT_DURATION_SEC = 30;

// Color codes (Windows-compatible: cmd + PowerShell + Windows Terminal)
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
function httpGet(path) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req = http.get(BASE_URL + path, (res) => {
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
        // Timeout safety: 30s
        req.setTimeout(30000, () => {
            req.destroy(new Error('REQUEST_TIMEOUT'));
        });
    });
}

function httpPost(path, body) {
    return new Promise((resolve) => {
        const start = Date.now();
        const postData = JSON.stringify(body || {});
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
        req.setTimeout(30000, () => {
            req.destroy(new Error('REQUEST_TIMEOUT'));
        });
        req.write(postData);
        req.end();
    });
}

// ============================================================
// SCENARIO DEFINITIONS
// ============================================================
const scenarios = {
    whoami: {
        name: 'WHOAMI - LB Distribution (Read-Only)',
        description: 'Lightest test. Verifies Load Balancer distributes across backends.',
        method: 'GET',
        path: '/whoami',
        productId: null,
        body: null,
    },
    cache: {
        name: 'CACHE - Cache-Aside Read Stress',
        description: 'Read-heavy stress on Redis Cache-Aside pattern.',
        method: 'GET',
        path: '/cached-product/1',
        productId: 1,
        body: null,
    },
    unsafe: {
        name: 'UNSAFE - DB Race Condition Stress',
        description: 'Write-heavy. Expected: data loss under high concurrency (proves race exists).',
        method: 'GET',
        path: '/unsafe/4',
        productId: 4,
        body: null,
    },
    safe: {
        name: 'SAFE - DB Pessimistic Locking Stress',
        description: 'Write-heavy with lockForUpdate. Expected: 0 data loss.',
        method: 'GET',
        path: '/safe/5',
        productId: 5,
        body: null,
    },
    acid: {
        name: 'ACID - Atomic Transaction Stress',
        description: 'POST /order/atomic with concurrency. Expected: 0 data loss, 0 inconsistency.',
        method: 'POST',
        path: '/order/atomic',
        productId: 6,
        body: { product_id: 6, quantity: 1, fail_after: false },
    },
    mixed: {
        name: 'MIXED - Realistic E-commerce Load',
        description: '80% reads (cache) + 20% writes (ACID). Most realistic scenario.',
        method: 'MIXED',
        path: null,
        productId: null,
        body: null,
    },
};

// ============================================================
// STATS COLLECTOR
// ============================================================
class Stats {
    constructor(name) {
        this.name = name;
        this.total = 0;
        this.success = 0;
        this.failures = 0;
        this.errors = {}; // by error type
        this.statusCodes = {}; // {200: 50, 500: 10, ...}
        this.responseTimes = []; // ms
        this.backendPorts = new Set();
        this.startTime = null;
        this.endTime = null;
        this.errorsList = []; // first 10 errors for diagnostics
        this.dataIntegrity = {
            stockBefore: null,
            stockAfter: null,
            ordersCreated: 0,
            lostUpdates: 0,
        };
    }

    start() {
        this.startTime = Date.now();
    }

    stop() {
        this.endTime = Date.now();
    }

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
            rps: rps,
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
// WORKER - sends requests continuously for duration
// ============================================================
async function worker(stats, scenario, endTime) {
    while (Date.now() < endTime) {
        let result;

        if (scenario.method === 'MIXED') {
            // 80% read, 20% write
            if (Math.random() < 0.8) {
                result = await httpGet('/cached-product/' + (Math.floor(Math.random() * 5) + 1));
            } else {
                result = await httpPost('/order/atomic', {
                    product_id: 6,
                    quantity: 1,
                    fail_after: false,
                });
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
// STOCK CHECKER (for data integrity verification)
// ============================================================
async function getStock(productId) {
    const res = await httpGet('/uncached-product/' + productId);
    if (res.status !== 200) return null;
    return res.data.stock || (res.data.data ? res.data.data.stock : null);
}

// ============================================================
// RUN SCENARIO
// ============================================================
async function runScenario(scenarioKey, concurrent, durationSec) {
    const scenario = scenarios[scenarioKey];
    if (!scenario) {
        console.log(c('red', 'Unknown scenario: ' + scenarioKey));
        console.log('Available: ' + Object.keys(scenarios).join(', '));
        return null;
    }

    const stats = new Stats(scenario.name);

    // Pre-check stock for write scenarios
    if (scenario.productId) {
        const stock = await getStock(scenario.productId);
        if (stock === null) {
            console.log(c('red', 'X Cannot read product #' + scenario.productId + ' stock before test'));
            return null;
        }
        stats.dataIntegrity.stockBefore = stock;
        console.log(c('blue', 'Stock before: ' + stock));
    }

    console.log('\n' + c('cyan', c('bold', '='.repeat(70))));
    console.log(c('cyan', c('bold', '  STRESS TEST: ' + scenario.name)));
    console.log(c('cyan', c('bold', '='.repeat(70))));
    console.log(c('gray', '  ' + scenario.description));
    console.log(c('gray', '  Concurrent users: ' + concurrent + ' | Duration: ' + durationSec + 's | Target: ' + BASE_URL));
    console.log(c('gray', '  Started at: ' + new Date().toLocaleTimeString()));
    console.log();

    stats.start();
    const endTime = Date.now() + (durationSec * 1000);

    // Launch concurrent workers
    const workers = [];
    for (let i = 0; i < concurrent; i++) {
        workers.push(worker(stats, scenario, endTime));
    }

    // Progress bar
    const progressInterval = setInterval(() => {
        const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
        const remaining = (durationSec - elapsed).toFixed(1);
        process.stdout.write('\r' + c('yellow', '  [' + elapsed + 's / ' + durationSec + 's] ') +
            c('green', 'OK=' + stats.success) + ' ' +
            c('red', 'FAIL=' + stats.failures) + ' ' +
            c('gray', '(' + remaining + 's remaining)  '));
    }, 1000);

    await Promise.all(workers);

    clearInterval(progressInterval);
    process.stdout.write('\r' + ' '.repeat(80) + '\r');

    stats.stop();

    // Post-check stock
    if (scenario.productId) {
        // Wait a bit for any in-flight transactions to commit
        await new Promise(resolve => setTimeout(resolve, 1000));
        const stockAfter = await getStock(scenario.productId);
        stats.dataIntegrity.stockAfter = stockAfter;
        console.log(c('blue', 'Stock after:  ' + stockAfter));
    }

    printStats(stats);

    return stats.summary();
}

// ============================================================
// PRINT STATS (formatted report)
// ============================================================
function printStats(stats) {
    const s = stats.summary();

    console.log('\n' + c('magenta', c('bold', '  TEST RESULTS')));
    console.log(c('magenta', '  ' + '-'.repeat(66)));

    // Performance
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

    // Success rate
    console.log(c('bold', '\n  SUCCESS RATE:'));
    const successColor = parseFloat(s.success_rate) === 100 ? 'green' : (parseFloat(s.success_rate) >= 95 ? 'yellow' : 'red');
    console.log('    ' + c(successColor, s.success_rate) + ' (' + s.success + '/' + s.total_requests + ')');

    // Status codes
    console.log(c('bold', '\n  HTTP STATUS CODES:'));
    Object.keys(s.status_codes).sort().forEach(code => {
        const count = s.status_codes[code];
        const pct = ((count / s.total_requests) * 100).toFixed(1);
        const label = code === '0' ? 'Connection Error' : 'HTTP ' + code;
        const color = (code === '200' || code === '201') ? 'green' : (code === '409' ? 'yellow' : 'red');
        console.log('    ' + c(color, label.padEnd(20)) + ' : ' + String(count).padStart(6) + ' (' + pct + '%)');
    });

    // Backend distribution (Load Balancer verification)
    if (s.backend_distribution.length > 0) {
        console.log(c('bold', '\n  LOAD BALANCER DISTRIBUTION:'));
        console.log('    Backends hit: ' + c('cyan', s.backend_distribution.length + ' / 5'));
        console.log('    Ports:        ' + s.backend_distribution.join(', '));
        if (s.backend_distribution.length === 5) {
            console.log(c('green', '    OK - All 5 backends received traffic (round-robin working)'));
        } else if (s.backend_distribution.length > 1) {
            console.log(c('yellow', '    WARNING - Not all backends received traffic'));
        }
    }

    // Errors breakdown
    if (Object.keys(s.errors).length > 0) {
        console.log(c('bold', '\n  ERRORS BREAKDOWN:'));
        Object.entries(s.errors).sort((a, b) => b[1] - a[1]).forEach(([err, count]) => {
            console.log('    ' + c('red', err.padEnd(40)) + ' : ' + count);
        });

        console.log(c('bold', '\n  SAMPLE ERRORS (first 5):'));
        s.sample_errors.slice(0, 5).forEach((e, i) => {
            console.log('    #' + (i + 1) + ' [HTTP ' + e.status + '] ' + e.error + ' (' + e.ms + 'ms)');
            if (e.data && e.data !== 'null') {
                console.log('         ' + c('gray', e.data.substring(0, 100)));
            }
        });
    }

    // Data integrity check
    if (s.data_integrity.stockBefore !== null && s.data_integrity.stockAfter !== null) {
        console.log(c('bold', '\n  DATA INTEGRITY CHECK:'));
        console.log('    Stock before: ' + s.data_integrity.stockBefore);
        console.log('    Stock after:  ' + s.data_integrity.stockAfter);

        const expectedWrites = s.status_codes['201'] || 0;  // successful POST writes
        const expectedStock = s.data_integrity.stockBefore - expectedWrites;
        const actualStock = s.data_integrity.stockAfter;
        const lost = expectedStock - actualStock;

        console.log('    Expected writes:    ' + expectedWrites);
        console.log('    Expected stock:     ' + expectedStock);
        console.log('    Lost updates:       ' + c(lost > 0 ? 'red' : 'green', lost));

        if (lost === 0 && expectedWrites > 0) {
            console.log(c('green', '    OK - DATA INTEGRITY PRESERVED (no lost updates)'));
        } else if (lost > 0) {
            console.log(c('red', '    X DATA LOSS DETECTED (' + lost + ' updates lost)'));
            console.log(c('yellow', '      -> This is EXPECTED for "unsafe" scenario (proves race condition exists)'));
            console.log(c('yellow', '      -> For "safe"/"acid" scenarios: investigate locking/transaction logic'));
        }
    }

    // Stability verdict
    console.log(c('bold', '\n  STABILITY VERDICT:'));
    const isStable = parseFloat(s.success_rate) >= 95 && s.failures < (s.total_requests * 0.05);
    if (isStable) {
        console.log(c('green', '    OK - System remained STABLE under load'));
        console.log(c('green', '    -> No crashes, no timeouts, success rate >= 95%'));
    } else {
        console.log(c('red', '    X System showed instability'));
        console.log(c('yellow', '    -> Check error breakdown above for root cause'));
    }

    console.log('\n' + c('gray', '  Test finished at: ' + new Date().toLocaleTimeString()));
    console.log();
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
    console.log(c('cyan', c('bold', '  STRESS TESTING TOOL - E-commerce Parallel Programming')));
    console.log(c('cyan', c('bold', '  Requirement #9: Stability under concurrent load (>= 100 users)')));
    console.log(c('cyan', c('bold', '='.repeat(70))));

    console.log(c('gray', '  Target:        ' + BASE_URL));
    console.log(c('gray', '  Machine:       ' + os.hostname() + ' | ' + os.cpus().length + ' CPU cores | ' + Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB RAM'));
    console.log(c('gray', '  Node version:  ' + process.version));
    console.log(c('gray', '  Start time:    ' + new Date().toLocaleString()));

    if (!scenario) {
        console.log('\n' + c('yellow', c('bold', 'USAGE:')));
        console.log('  node stress-test.cjs <scenario> [concurrent] [duration_sec]');
        console.log('\n' + c('yellow', c('bold', 'SCENARIOS:')));
        Object.entries(scenarios).forEach(([key, s]) => {
            console.log('  ' + c('cyan', key.padEnd(12)) + ' - ' + s.name);
            console.log('  ' + ' '.repeat(14) + c('gray', s.description));
        });
        console.log('\n' + c('yellow', c('bold', 'EXAMPLES:')));
        console.log('  ' + c('gray', 'Minimal (requirement minimum):'));
        console.log('    node stress-test.cjs whoami 100 30');
        console.log('  ' + c('gray', 'Cache stress:'));
        console.log('    node stress-test.cjs cache 200 60');
        console.log('  ' + c('gray', 'ACID transaction integrity:'));
        console.log('    node stress-test.cjs acid 100 30');
        console.log('  ' + c('gray', 'Realistic mixed load:'));
        console.log('    node stress-test.cjs mixed 150 60');
        console.log('  ' + c('gray', 'Run all scenarios sequentially:'));
        console.log('    node stress-test.cjs all 100 30');
        process.exit(0);
    }

    if (scenario === 'all') {
        const allResults = {};
        const keys = ['whoami', 'cache', 'safe', 'acid', 'mixed'];
        for (const key of keys) {
            allResults[key] = await runScenario(key, concurrent, durationSec);
            console.log(c('gray', '\n  (Waiting 5s before next scenario to let system recover...)'));
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Final summary
        console.log('\n' + c('cyan', c('bold', '='.repeat(70))));
        console.log(c('cyan', c('bold', '  FINAL SUMMARY - ALL SCENARIOS')));
        console.log(c('cyan', c('bold', '='.repeat(70))));
        console.log('  ' + c('bold', 'Scenario'.padEnd(28)) + 'Req    OK    Fail  RPS     p95    Status');
        console.log('  ' + '-'.repeat(66));
        Object.entries(allResults).forEach(([key, s]) => {
            if (!s) return;
            const statusColor = parseFloat(s.success_rate) >= 95 ? 'green' : 'red';
            console.log('  ' + c('bold', key.padEnd(28)) +
                String(s.total_requests).padStart(5) + '  ' +
                String(s.success).padStart(5) + '  ' +
                String(s.failures).padStart(5) + '  ' +
                String(s.rps).padStart(6) + '  ' +
                (s.p95_ms + 'ms').padStart(7) + '  ' +
                c(statusColor, s.success_rate));
        });
        console.log('  ' + '-'.repeat(66));

        // Save JSON report
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
        const fs = require('fs');
        const reportPath = 'stress-test-report.json';
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log('\n' + c('green', 'OK Full report saved to: ' + reportPath));
    } else {
        await runScenario(scenario, concurrent, durationSec);
    }
}

main().catch(err => {
    console.error(c('red', 'Fatal error: ' + err.message));
    console.error(err.stack);
    process.exit(1);
});
