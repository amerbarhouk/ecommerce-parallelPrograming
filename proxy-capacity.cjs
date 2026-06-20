// ============================================================
// proxy-capacity.cjs - Load Balancer with Capacity Control
// ============================================================
//
// Requirement #2: Resource Management & Capacity Control
//
// Features:
//   1. Round-robin load balancing across 5 backends
//   2. Per-backend active connection tracking
//   3. Max concurrent per backend (default: 1 for php artisan serve)
//   4. Request queueing when all backends busy (with timeout)
//   5. 503 Service Unavailable when queue full (graceful degradation)
//   6. Health check (skip dead backends, retry after interval)
//   7. X-Backend-Port + X-Backend-Target response headers
//   8. /proxy-stats endpoint for monitoring
//   9. /proxy-health endpoint for health check
//
// USAGE:
//   node proxy-capacity.cjs
//   MAX_CONCURRENT_PER_BACKEND=2 node proxy-capacity.cjs
//   MAX_QUEUE_SIZE=200 QUEUE_TIMEOUT_MS=10000 node proxy-capacity.cjs
// ============================================================

const http = require('http');
const httpProxy = require('http-proxy');

// ============================================================
// CONFIG (configurable via env vars)
// ============================================================
const PORT = parseInt(process.env.PROXY_PORT || '8080', 10);
const MAX_CONCURRENT_PER_BACKEND = parseInt(process.env.MAX_CONCURRENT_PER_BACKEND || '1', 10);
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || '500', 10);
const QUEUE_TIMEOUT_MS = parseInt(process.env.QUEUE_TIMEOUT_MS || '15000', 10);
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '10000', 10);
const BACKEND_TIMEOUT_MS = parseInt(process.env.BACKEND_TIMEOUT_MS || '45000', 10);

const targets = [
    { url: 'http://127.0.0.1:8001', port: 8001, id: 1 },
    { url: 'http://127.0.0.1:8002', port: 8002, id: 2 },
    { url: 'http://127.0.0.1:8003', port: 8003, id: 3 },
    { url: 'http://127.0.0.1:8004', port: 8004, id: 4 },
    { url: 'http://127.0.0.1:8005', port: 8005, id: 5 },
];

// ============================================================
// STATE
// ============================================================
const backends = targets.map(t => ({
    ...t,
    activeConnections: 0,
    totalRequests: 0,
    failedRequests: 0,
    healthy: true,
    lastHealthCheck: Date.now(),
    lastError: null,
}));

let rrIndex = 0;  // round-robin counter
let totalRequests = 0;
let total503 = 0;
let total500 = 0;
let totalTimeouts = 0;
let queueLength = 0;
const startTime = Date.now();

const proxy = httpProxy.createProxyServer({});

// ============================================================
// BACKEND SELECTION (round-robin + capacity-aware)
// ============================================================
function selectBackend() {
    // Try to find a healthy backend with available capacity
    for (let i = 0; i < backends.length; i++) {
        const idx = (rrIndex + i) % backends.length;
        const b = backends[idx];
        if (b.healthy && b.activeConnections < MAX_CONCURRENT_PER_BACKEND) {
            rrIndex = (idx + 1) % backends.length;
            return b;
        }
    }
    return null;  // all busy
}

// ============================================================
// HEALTH CHECK
// ============================================================
async function checkBackendHealth(backend) {
    return new Promise((resolve) => {
        const req = http.get(backend.url + '/stress/ping', { timeout: 3000 }, (res) => {
            if (res.statusCode === 200) {
                if (!backend.healthy) {
                    console.log(`[${new Date().toISOString()}] Backend ${backend.port} recovered`);
                }
                backend.healthy = true;
                backend.lastHealthCheck = Date.now();
            } else {
                backend.healthy = false;
            }
            resolve();
        });
        req.on('error', () => {
            if (backend.healthy) {
                console.log(`[${new Date().toISOString()}] Backend ${backend.port} unhealthy`);
            }
            backend.healthy = false;
            backend.lastHealthCheck = Date.now();
            resolve();
        });
        req.on('timeout', () => {
            req.destroy();
            backend.healthy = false;
            backend.lastHealthCheck = Date.now();
            resolve();
        });
    });
}

async function runHealthChecks() {
    for (const b of backends) {
        await checkBackendHealth(b);
    }
}

// Health check loop
setInterval(runHealthChecks, HEALTH_CHECK_INTERVAL_MS);

// ============================================================
// QUEUE MANAGEMENT
// ============================================================
const requestQueue = [];

function enqueueRequest(req, res) {
    if (requestQueue.length >= MAX_QUEUE_SIZE) {
        // Queue full - return 503 immediately
        total503++;
        res.writeHead(503, {
            'Content-Type': 'application/json',
            'X-Capacity-Status': 'queue-full',
            'Retry-After': '2',
        });
        res.end(JSON.stringify({
            error: 'Service Unavailable',
            message: 'Request queue is full. System at maximum capacity.',
            queue_length: requestQueue.length,
            max_queue: MAX_QUEUE_SIZE,
            retry_after_seconds: 2,
        }));
        return false;
    }

    const queueEntry = {
        req,
        res,
        enqueuedAt: Date.now(),
        timeoutHandle: setTimeout(() => {
            // Timeout - remove from queue and return 503
            const idx = requestQueue.indexOf(queueEntry);
            if (idx !== -1) {
                requestQueue.splice(idx, 1);
                queueLength = requestQueue.length;
            }
            total503++;
            totalTimeouts++;
            try {
                res.writeHead(503, {
                    'Content-Type': 'application/json',
                    'X-Capacity-Status': 'queue-timeout',
                    'Retry-After': '2',
                });
                res.end(JSON.stringify({
                    error: 'Service Unavailable',
                    message: 'Request timed out waiting in queue.',
                    waited_ms: Date.now() - queueEntry.enqueuedAt,
                    retry_after_seconds: 2,
                }));
            } catch (e) {
                // response already sent
            }
        }, QUEUE_TIMEOUT_MS),
    };

    requestQueue.push(queueEntry);
    queueLength = requestQueue.length;
    return true;
}

function processQueue() {
    while (requestQueue.length > 0) {
        const backend = selectBackend();
        if (!backend) break;  // all backends still busy

        const entry = requestQueue.shift();
        queueLength = requestQueue.length;
        clearTimeout(entry.timeoutHandle);

        // Check if request was already timed out
        if (entry.res.writableEnded) continue;

        forwardRequest(entry.req, entry.res, backend, true);
    }
}

// ============================================================
// REQUEST FORWARDING
// ============================================================
function forwardRequest(req, res, backend, fromQueue = false) {
    backend.activeConnections++;
    backend.totalRequests++;
    totalRequests++;

    if (fromQueue) {
        // Already enqueued, just forward now
    }

    // Set backend timeout
    const timeoutHandle = setTimeout(() => {
        if (!res.writableEnded) {
            backend.failedRequests++;
            totalTimeouts++;
            try {
                res.writeHead(504, {
                    'Content-Type': 'application/json',
                    'X-Capacity-Status': 'backend-timeout',
                });
                res.end(JSON.stringify({
                    error: 'Gateway Timeout',
                    message: `Backend ${backend.port} did not respond within ${BACKEND_TIMEOUT_MS}ms`,
                }));
            } catch (e) {}
        }
        backend.activeConnections = Math.max(0, backend.activeConnections - 1);
        processQueue();
    }, BACKEND_TIMEOUT_MS);

    proxy.web(req, res, { target: backend.url }, (err) => {
        clearTimeout(timeoutHandle);
        backend.activeConnections = Math.max(0, backend.activeConnections - 1);
        backend.failedRequests++;
        total500++;

        if (!res.writableEnded) {
            res.writeHead(502, {
                'Content-Type': 'application/json',
                'X-Capacity-Status': 'backend-error',
            });
            res.end(JSON.stringify({
                error: 'Bad Gateway',
                message: err.message,
                backend: backend.port,
            }));
        }

        // Mark backend as unhealthy temporarily
        backend.healthy = false;
        backend.lastError = err.message;

        // Try next request from queue
        processQueue();
    });

    // Hook into response end to release the backend
    const originalEnd = res.end;
    res.end = function(...args) {
        clearTimeout(timeoutHandle);
        backend.activeConnections = Math.max(0, backend.activeConnections - 1);
        // Process next request from queue
        setImmediate(processQueue);
        return originalEnd.apply(res, args);
    };

    // Add backend info headers (must be set before response ends)
    const originalWriteHead = res.writeHead;
    res.writeHead = function(statusCode, ...rest) {
        if (!res.getHeader('X-Backend-Port')) {
            res.setHeader('X-Backend-Port', backend.port);
            res.setHeader('X-Backend-Target', backend.url);
            res.setHeader('X-Backend-Active', backend.activeConnections);
            res.setHeader('X-Queue-Length', queueLength);
        }
        return originalWriteHead.call(res, statusCode, ...rest);
    };
}

// ============================================================
// HTTP SERVER
// ============================================================
const server = http.createServer((req, res) => {
    // Special endpoints for monitoring
    if (req.url === '/proxy-stats') {
        return handleStats(req, res);
    }
    if (req.url === '/proxy-health') {
        return handleHealth(req, res);
    }

    // Try to get an available backend immediately
    const backend = selectBackend();
    if (backend) {
        forwardRequest(req, res, backend);
    } else {
        // All backends busy - enqueue
        const enqueued = enqueueRequest(req, res);
        if (!enqueued) {
            // Queue full, 503 already sent
        }
    }
});

// ============================================================
// MONITORING ENDPOINTS
// ============================================================
function handleStats(req, res) {
    const uptimeSec = (Date.now() - startTime) / 1000;
    const stats = {
        proxy: {
            port: PORT,
            uptime_seconds: uptimeSec.toFixed(1),
            total_requests: totalRequests,
            total_503: total503,
            total_500: total500,
            total_timeouts: totalTimeouts,
            current_queue_length: queueLength,
        },
        config: {
            max_concurrent_per_backend: MAX_CONCURRENT_PER_BACKEND,
            max_queue_size: MAX_QUEUE_SIZE,
            queue_timeout_ms: QUEUE_TIMEOUT_MS,
            backend_timeout_ms: BACKEND_TIMEOUT_MS,
            health_check_interval_ms: HEALTH_CHECK_INTERVAL_MS,
        },
        capacity: {
            total_backends: backends.length,
            healthy_backends: backends.filter(b => b.healthy).length,
            max_total_concurrent: backends.length * MAX_CONCURRENT_PER_BACKEND,
            current_active: backends.reduce((s, b) => s + b.activeConnections, 0),
            utilization_pct: ((backends.reduce((s, b) => s + b.activeConnections, 0) / (backends.length * MAX_CONCURRENT_PER_BACKEND)) * 100).toFixed(1) + '%',
        },
        backends: backends.map(b => ({
            port: b.port,
            id: b.id,
            url: b.url,
            healthy: b.healthy,
            active_connections: b.activeConnections,
            max_concurrent: MAX_CONCURRENT_PER_BACKEND,
            total_requests: b.totalRequests,
            failed_requests: b.failedRequests,
            last_error: b.lastError,
        })),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
}

function handleHealth(req, res) {
    const healthyCount = backends.filter(b => b.healthy).length;
    const isHealthy = healthyCount >= Math.ceil(backends.length / 2);
    res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
        status: isHealthy ? 'healthy' : 'degraded',
        healthy_backends: healthyCount,
        total_backends: backends.length,
        uptime_seconds: ((Date.now() - startTime) / 1000).toFixed(1),
    }, null, 2));
}

// ============================================================
// STARTUP
// ============================================================
server.listen(PORT, () => {
    console.log(`\n============================================================`);
    console.log(`  Load Balancer with Capacity Control`);
    console.log(`  Requirement #2: Resource Management & Capacity Control`);
    console.log(`============================================================`);
    console.log(`  Listening on:           http://127.0.0.1:${PORT}`);
    console.log(`  Backends:               ${backends.length} (ports ${backends.map(b => b.port).join(', ')})`);
    console.log(`  Max concurrent/backend: ${MAX_CONCURRENT_PER_BACKEND}`);
    console.log(`  Max total concurrent:   ${backends.length * MAX_CONCURRENT_PER_BACKEND}`);
    console.log(`  Queue size:             ${MAX_QUEUE_SIZE}`);
    console.log(`  Queue timeout:          ${QUEUE_TIMEOUT_MS}ms`);
    console.log(`  Backend timeout:        ${BACKEND_TIMEOUT_MS}ms`);
    console.log(`  Health check interval:  ${HEALTH_CHECK_INTERVAL_MS}ms`);
    console.log(`============================================================`);
    console.log(`  Endpoints:`);
    console.log(`    /proxy-stats   - Capacity utilization & backend status`);
    console.log(`    /proxy-health  - Health check endpoint`);
    console.log(`============================================================\n`);
});

// Periodic stats logging
setInterval(() => {
    const active = backends.reduce((s, b) => s + b.activeConnections, 0);
    const healthyCount = backends.filter(b => b.healthy).length;
    console.log(`[${new Date().toISOString()}] active=${active}/${backends.length * MAX_CONCURRENT_PER_BACKEND} queue=${queueLength} healthy=${healthyCount}/${backends.length} total=${totalRequests} 503=${total503}`);
}, 10000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down proxy...');
    server.close(() => {
        console.log('Proxy stopped.');
        process.exit(0);
    });
});
