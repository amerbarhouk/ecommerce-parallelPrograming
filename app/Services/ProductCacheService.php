<?php

namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

/**
 * Service for Distributed Caching with Redis
 *
 * All operations use the Redis facade directly (single connection)
 * to avoid the cache-store vs redis-connection mismatch.
 *
 * Implements:
 * 1. Cache-Aside: Read from Redis -> If miss -> DB -> Store in Redis
 * 2. Cache Stampede Protection: SET NX EX lock
 * 3. Cache Invalidation: DEL on stock changes
 * 4. Atomic DECRBY for race-condition-safe stock operations
 */
class ProductCacheService
{
    const CACHE_TTL = 300;       // 5 minutes
    const LOCK_TIMEOUT = 10;     // 10 seconds

    /**
     * Get product with Cache-Aside strategy
     */
    public function getProduct(int $productId): ?array
    {
        $cacheKey = $this->getCacheKey($productId);
        $start = microtime(true);

        // Step 1: Try Redis cache
        $cached = Redis::get($cacheKey);

        if ($cached !== null) {
            $data = json_decode($cached, true);
            if (!is_array($data)) {
                $data = [];
            }
            $data['cache_status'] = 'HIT';
            $data['total_time_ms'] = round((microtime(true) - $start) * 1000, 3);
            return $data;
        }

        // Step 2: Cache miss - use stampede protection
        return $this->getWithStampedeProtection($productId, $start);
    }

    /**
     * Cache Stampede Protection using SET NX EX
     *
     * Only ONE request acquires the lock and rebuilds the cache.
     * Other requests wait briefly, then re-read from cache.
     */
    private function getWithStampedeProtection(int $productId, float $start): ?array
    {
        $lockKey = "lock:product:{$productId}";
        $cacheKey = $this->getCacheKey($productId);

        // Try to acquire lock atomically: SET lockKey 1 NX EX 10
        $lockAcquired = Redis::set($lockKey, '1', 'EX', self::LOCK_TIMEOUT, 'NX');

        if ($lockAcquired) {
            // We got the lock - rebuild cache
            try {
                $queryStart = microtime(true);
                $product = Product::find($productId);
                $queryTime = round((microtime(true) - $queryStart) * 1000, 2);

                if (!$product) {
                    return null;
                }

                $data = $product->toArray();
                $data['cache_status'] = 'MISS (rebuilt)';
                $data['total_time_ms'] = round((microtime(true) - $start) * 1000, 2);
                $data['query_time_ms'] = $queryTime;

                // Store in Redis with TTL
                Redis::setex($cacheKey, self::CACHE_TTL, json_encode($data));

                return $data;
            } finally {
                Redis::del($lockKey);
            }
        }

        // We didn't get the lock - wait and retry
        usleep(100000); // 100ms
        $cached = Redis::get($cacheKey);

        if ($cached !== null) {
            $data = json_decode($cached, true);
            if (!is_array($data)) {
                $data = [];
            }
            $data['cache_status'] = 'HIT (after wait)';
            $data['total_time_ms'] = round((microtime(true) - $start) * 1000, 2);
            return $data;
        }

        // Fallback: query DB directly
        $product = Product::find($productId);
        if (!$product) {
            return null;
        }

        $data = $product->toArray();
        $data['cache_status'] = 'MISS (fallback)';
        $data['total_time_ms'] = round((microtime(true) - $start) * 1000, 2);
        return $data;
    }

    /**
     * Invalidate cache for a specific product
     */
    public function invalidateProduct(int $productId): bool
    {
        $cacheKey = $this->getCacheKey($productId);
        $deleted = Redis::del($cacheKey);

        if ($deleted > 0) {
            Log::info("Cache INVALIDATED for product #{$productId}");
            return true;
        }
        return false;
    }

    /**
     * Atomic stock decrement using Redis DECRBY (race-condition-safe)
     */
    public function atomicDecrementStock(int $productId, int $quantity = 1): int|false
    {
        $stockKey = $this->getStockKey($productId);

        $currentStock = Redis::get($stockKey);

        if ($currentStock === null) {
            $product = Product::find($productId);
            if (!$product) {
                return false;
            }
            Redis::set($stockKey, $product->stock);
            $currentStock = $product->stock;
        }

        if ((int) $currentStock < $quantity) {
            Log::warning("Insufficient stock for #{$productId}: current={$currentStock}, requested={$quantity}");
            return false;
        }

        // Atomic decrement - no race condition possible
        $newStock = Redis::decrby($stockKey, $quantity);

        if ($newStock < 0) {
            Redis::incrby($stockKey, $quantity);
            Log::warning("Stock went below 0 for #{$productId}, rolled back");
            return false;
        }

        // Sync to DB so DB stays consistent
        Product::where('id', $productId)->update(['stock' => $newStock]);

        // Invalidate the full product cache
        $this->invalidateProduct($productId);

        Log::info("Atomic stock decrement for #{$productId}: {$currentStock} -> {$newStock}");
        return $newStock;
    }

    /**
     * Sync Redis stock back to database
     */
    public function syncStockToDatabase(int $productId): bool
    {
        $stockKey = $this->getStockKey($productId);
        $redisStock = Redis::get($stockKey);

        if ($redisStock === null) {
            return false;
        }

        $product = Product::find($productId);
        if (!$product) {
            return false;
        }

        $product->stock = (int) $redisStock;
        $product->save();

        Log::info("Synced Redis stock to DB for product #{$productId}: {$redisStock}");
        return true;
    }

    /**
     * Warm up the cache for popular products
     */
    public function warmCache(int $limit = 10): int
    {
        $popularProducts = Product::select('products.*')
            ->leftJoin('order_items', 'products.id', '=', 'order_items.product_id')
            ->selectRaw('COUNT(order_items.id) as order_count')
            ->groupBy('products.id')
            ->orderByDesc('order_count')
            ->limit($limit)
            ->get();

        $count = 0;
        foreach ($popularProducts as $product) {
            $cacheKey = $this->getCacheKey($product->id);
            $data = $product->toArray();
            $data['cache_status'] = 'WARMED';

            Redis::setex($cacheKey, self::CACHE_TTL, json_encode($data));

            $stockKey = $this->getStockKey($product->id);
            Redis::set($stockKey, $product->stock);

            $count++;
        }

        Log::info("Cache warmed for {$count} products");
        return $count;
    }

    /**
     * Get cache statistics
     */
    public function getStats(): array
    {
        $allKeys = Redis::keys('*');

        if (!is_array($allKeys)) {
            $allKeys = [];
        }

        $productKeys = array_filter($allKeys, fn($k) => is_string($k) && str_contains($k, 'product'));
        $stockKeys = array_filter($allKeys, fn($k) => is_string($k) && str_contains($k, 'stock'));
        $lockKeys = array_filter($allKeys, fn($k) => is_string($k) && str_contains($k, 'lock'));

        try {
            $info = Redis::info();
            if (!is_array($info)) {
                $info = [];
            }
            $memoryUsed = $info['used_memory_human'] ?? 'N/A';
            $clients = $info['connected_clients'] ?? 'N/A';
        } catch (\Exception $e) {
            $memoryUsed = 'N/A';
            $clients = 'N/A';
        }

        return [
            'product_cache_count' => count($productKeys),
            'stock_cache_count' => count($stockKeys),
            'lock_count' => count($lockKeys),
            'total_keys_in_redis' => count($allKeys),
            'redis_memory_used' => $memoryUsed,
            'redis_connected_clients' => $clients,
            'cache_ttl_seconds' => self::CACHE_TTL,
            'stampede_lock_timeout' => self::LOCK_TIMEOUT,
        ];
    }

    /**
     * Clear all product-related cache
     */
    public function clearAllCache(): int
    {
        $allKeys = Redis::keys('*');

        if (!is_array($allKeys)) {
            $allKeys = [];
        }

        $count = 0;
        foreach ($allKeys as $key) {
            if (is_string($key) && (str_contains($key, 'product') || str_contains($key, 'stock') || str_contains($key, 'lock'))) {
                Redis::del($key);
                $count++;
            }
        }

        Log::info("Cleared {$count} cache keys");
        return $count;
    }

    /**
     * Update cached stock directly (used for UNSAFE demo).
     * Uses READ-MODIFY-WRITE pattern - race-condition-prone!
     */
    public function updateCachedStock(int $productId, int $newStock): void
    {
        $cacheKey = $this->getCacheKey($productId);
        $cached = Redis::get($cacheKey);
        if ($cached !== null) {
            $data = json_decode($cached, true);
            if (!is_array($data)) {
                $data = [];
            }
            $data['stock'] = $newStock;
            Redis::setex($cacheKey, self::CACHE_TTL, json_encode($data));
        }

        $stockKey = $this->getStockKey($productId);
        Redis::set($stockKey, $newStock);
    }

    private function getCacheKey(int $productId): string
    {
        return "product:{$productId}";
    }

    private function getStockKey(int $productId): string
    {
        return "stock:{$productId}";
    }
}
