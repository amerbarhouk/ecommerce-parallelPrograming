<?php

namespace App\Http\Controllers;

use App\Services\ProductCacheService;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Redis;

class CachedProductController extends Controller
{
    public function __construct(
        private ProductCacheService $cacheService
    ) {}

    /**
     * Get product WITH Redis caching (Cache-Aside + Stampede Protection)
     *
     * First request: Cache MISS -> DB -> Store in Redis
     * Next requests: Cache HIT -> Return from Redis (much faster!)
     *
     * GET /cached-product/{id}
     */
    public function getCachedProduct(int $id)
    {
        $start = microtime(true);

        $data = $this->cacheService->getProduct($id);

        $totalTime = round((microtime(true) - $start) * 1000, 2);

        if (!$data) {
            return response()->json([
                'error' => 'Product not found'
            ], 404);
        }

        $data['total_time_ms'] = $totalTime;

        return response()->json($data);
    }

    /**
     * Get product WITHOUT caching (direct DB query every time)
     * Used for performance comparison
     *
     * NOTE: This is a HEAVY query (with relations + aggregation)
     * to demonstrate why caching is useful for complex queries.
     *
     * GET /uncached-product/{id}
     */
    /**
     * Get product WITHOUT caching (direct DB query every time)
     * Used for performance comparison
     *
     * NOTE: This is a HEAVY query (with aggregations)
     * to demonstrate why caching is useful for complex queries.
     *
     * GET /uncached-product/{id}
     */
    public function getUncachedProduct(int $id)
    {
        $start = microtime(true);

        // Heavy query: product + aggregations (safe - no relations needed)
        try {
            $product = Product::select('products.*')
                ->addSelect([
                    'total_sold' => function ($query) {
                        $query->selectRaw('COALESCE(SUM(order_items.quantity), 0)')
                            ->from('order_items')
                            ->whereColumn('product_id', 'products.id');
                    },
                    'orders_count' => function ($query) {
                        $query->selectRaw('COUNT(order_items.id)')
                            ->from('order_items')
                            ->whereColumn('product_id', 'products.id');
                    },
                ])
                ->find($id);

            $totalTime = round((microtime(true) - $start) * 1000, 2);

            if (!$product) {
                return response()->json([
                    'error' => 'Product not found',
                    'total_time_ms' => $totalTime,
                ], 404);
            }

            $data = $product->toArray();
            $data['cache_status'] = 'MISS (no cache)';
            $data['total_time_ms'] = $totalTime;

            return response()->json($data);
        } catch (\Exception $e) {
            $totalTime = round((microtime(true) - $start) * 1000, 2);

            // Fallback: simple query if aggregations fail
            $product = Product::find($id);

            if (!$product) {
                return response()->json([
                    'error' => 'Product not found',
                    'total_time_ms' => $totalTime,
                ], 404);
            }

            return response()->json([
                'id' => $product->id,
                'name' => $product->name,
                'price' => $product->price,
                'stock' => $product->stock,
                'cache_status' => 'MISS (no cache, fallback)',
                'total_time_ms' => $totalTime,
            ]);
        }
    }

    /**
     * Update stock using Redis (UNSAFE - has Race Condition)
     * Same problem as unsafeWay but in Redis cache
     *
     * GET /cached-unsafe/{id}
     */
    public function unsafeCachedWay(int $id)
    {
        $start = microtime(true);

        // Read stock from Redis (no lock - just like unsafeWay but from cache)
        $stockKey = "stock:{$id}";
        $cachedStock = Redis::get($stockKey);

        if ($cachedStock === null) {
            // Not in cache, load from DB
            $product = Product::find($id);
            if (!$product) {
                return response()->json(['error' => 'Product not found'], 404);
            }
            Redis::set($stockKey, $product->stock);
            $cachedStock = $product->stock;
        }

        if ((int) $cachedStock > 0) {
            sleep(5); // Simulate slow operation (same as unsafeWay)

            // Problem: Between get and set, another request might have changed the value
            // This is the same Race Condition but in Redis
            Redis::set($stockKey, (int) $cachedStock - 1);

            // Also update DB
            $product = Product::find($id);
            if ($product) {
                $product->stock = (int) $cachedStock - 1;
                $product->save();
            }
        }

        $duration = round((microtime(true) - $start) * 1000, 2);

        return response()->json([
            'id' => $id,
            'stock_before' => (int) $cachedStock,
            'stock_after' => (int) $cachedStock - 1,
            'cache_status' => 'HIT',
            'method' => 'UNSAFE cached (Race Condition in Redis)',
            'time_ms' => $duration,
        ]);
    }

    /**
     * Update stock using Redis ATOMIC operations (DECRBY)
     * No Race Condition possible - Redis is single-threaded
     *
     * GET /cached-safe/{id}
     */
    public function safeCachedWay(int $id)
    {
        $start = microtime(true);

        $newStock = $this->cacheService->atomicDecrementStock($id);

        if ($newStock === false) {
            return response()->json([
                'error' => 'Product not found or insufficient stock'
            ], 400);
        }

        // Sync to database (can be done async via queue in production)
        $this->cacheService->syncStockToDatabase($id);

        $duration = round((microtime(true) - $start) * 1000, 2);

        return response()->json([
            'id' => $id,
            'stock_after' => $newStock,
            'cache_status' => 'HIT',
            'method' => 'SAFE cached (Atomic DECRBY - no Race Condition)',
            'time_ms' => $duration,
        ]);
    }

    /**
     * Warm up cache for most popular products
     *
     * GET /cache-warm/{limit?}
     */
    public function warmCache(int $limit = 10)
    {
        $count = $this->cacheService->warmCache($limit);

        return response()->json([
            'message' => "Cache warmed for {$count} products",
            'count' => $count,
        ]);
    }

    /**
     * Clear all product cache
     *
     * GET /cache-clear
     */
    public function clearCache()
    {
        $count = $this->cacheService->clearAllCache();

        return response()->json([
            'message' => "Cleared {$count} cache keys",
            'count' => $count,
        ]);
    }

    /**
     * Get cache statistics
     *
     * GET /cache-stats
     */
    public function stats()
    {
        return response()->json($this->cacheService->getStats());
    }
}
