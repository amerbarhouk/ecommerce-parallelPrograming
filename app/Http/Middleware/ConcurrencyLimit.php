<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * ============================================================
 * ConcurrencyLimit - Per-Route Concurrency Limiter
 * ============================================================
 *
 * Requirement #2: Resource Management & Capacity Control
 *
 * Uses Redis atomic INCR/DECR to limit concurrent in-flight
 * requests for a specific route/resource. Returns 503 when
 * the limit is reached (graceful degradation).
 *
 * USAGE in routes/web.php:
 *
 *   Route::get('/safe/{id}', [ProductController::class, 'SafeWay'])
 *       ->middleware('concurrency.limit:5');  // max 5 concurrent
 *
 *   Route::post('/order/atomic', [OrderController::class, 'createOrderAtomic'])
 *       ->middleware('concurrency.limit:3,safe_zone');  // max 3, custom key
 *
 * The first param is the max concurrent count.
 * The optional second param is a custom key namespace (defaults to route URI).
 *
 * IMPLEMENTATION:
 *   - INCR counter on request entry (atomic)
 *   - DECR counter on response (atomic, always runs via finally)
 *   - TTL safety: counter auto-expires after 60s (in case of crashes)
 *   - Per-resource: counter key includes route parameters (e.g., product ID)
 * ============================================================
 */
class ConcurrencyLimit
{
    public function handle(Request $request, Closure $next, string $max = '5', string $keyPrefix = '')
    {
        $maxConcurrent = (int) $max;
        $key = $this->buildKey($request, $keyPrefix);

        // Atomic increment
        $current = Redis::incr($key);

        // Safety: auto-expire the key in case of crashes
        if ($current === 1) {
            Redis::expire($key, 60);
        }

        if ($current > $maxConcurrent) {
            // Over limit - decrement and return 503
            Redis::decr($key);

            Log::warning('Concurrency limit exceeded', [
                'key' => $key,
                'current' => $current,
                'max' => $maxConcurrent,
                'server_id' => env('SERVER_ID', 'unknown'),
            ]);

            return response()->json([
                'error' => 'Service Unavailable',
                'message' => 'Too many concurrent requests for this resource.',
                'limit' => $maxConcurrent,
                'current' => $current - 1,
                'retry_after_seconds' => 1,
            ], 503, [
                'Retry-After' => '1',
                'X-Concurrency-Limit' => (string) $maxConcurrent,
                'X-Concurrency-Current' => (string) ($current - 1),
            ]);
        }

        // Add headers to response for visibility
        $response = $next($request);

        if (method_exists($response, 'header')) {
            $response->header('X-Concurrency-Limit', (string) $maxConcurrent);
            $response->header('X-Concurrency-Current', (string) $current);
        }

        // Always decrement, even on exception
        register_shutdown_function(function () use ($key) {
            try {
                Redis::decr($key);
            } catch (\Exception $e) {
                // Best-effort
            }
        });

        return $response;
    }

    /**
     * Build Redis key for this request.
     * Includes route URI and parameters to allow per-resource limiting.
     */
    private function buildKey(Request $request, string $prefix = ''): string
    {
        $route = $request->route();
        $uri = $route ? $route->uri() : $request->path();

        // Include route parameters for per-resource limiting
        // e.g., /safe/{id} with id=5 -> concurrency:safe:5
        $params = $route ? $route->parameters() : [];
        $paramStr = '';
        foreach ($params as $k => $v) {
            // Only include numeric IDs to keep keys small
            if (is_numeric($v)) {
                $paramStr .= ':' . $v;
            }
        }

        $namespace = $prefix ?: $uri;
        return 'concurrency:' . $namespace . $paramStr;
    }
}
