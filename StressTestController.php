<?php

/**
 * ============================================================
 * StressTestController - Fast Endpoints for Stress Testing
 * ============================================================
 *
 * Requirement #9: Stability under 100+ concurrent users
 *
 * Problem: The existing /unsafe/{id} and /safe/{id} endpoints
 * use sleep(5) for race condition demo. This makes them
 * unsuitable for stress testing at 100+ concurrency because:
 *   - php artisan serve is single-threaded per instance
 *   - 5 instances x 5s/request = 1 req/sec total throughput
 *   - 100 concurrent users -> 100s wait per request -> timeout
 *
 * Solution: Provide "fast" versions without the artificial delay.
 * The locking/transaction logic is IDENTICAL, only the demo sleep
 * is removed. This lets us stress test the REAL concurrency logic.
 * ============================================================
 */

namespace App\Http\Controllers;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class StressTestController extends Controller
{
    /**
     * Fast unsafe way - NO sleep(5).
     * Same race condition logic as unsafeWay(), but suitable for 100+ concurrent.
     */
    public function unsafeFast(int $id)
    {
        $product = Product::find($id);

        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }

        if ($product->stock > 0) {
            // NOTE: No sleep() here - this is the stress test version
            $product->stock -= 1;
            $product->save();
        }

        return response()->json([
            'product_id' => $id,
            'stock_after' => $product->stock,
        ]);
    }

    /**
     * Fast safe way - NO sleep(5), but WITH lockForUpdate.
     * Same Pessimistic Locking logic as SafeWay(), but suitable for 100+ concurrent.
     */
    public function safeFast(int $id)
    {
        $result = DB::transaction(function () use ($id) {
            $product = Product::where('id', $id)
                ->lockForUpdate()
                ->first();

            if (!$product) {
                return null;
            }

            if ($product->stock > 0) {
                $product->stock -= 1;
                $product->save();
            }

            return $product->stock;
        });

        if ($result === null) {
            return response()->json(['error' => 'Product not found'], 404);
        }

        return response()->json([
            'product_id' => $id,
            'stock_after' => $result,
        ]);
    }

    /**
     * Lightweight ping endpoint - no DB, no Redis, no I/O.
     * Pure LB + framework overhead test. Returns immediately.
     */
    public function ping()
    {
        return response()->json([
            'ok' => true,
            'server_id' => env('SERVER_ID', 'unknown'),
            'port' => $_SERVER['SERVER_PORT'] ?? 'unknown',
            'pid' => getmypid(),
            'time' => microtime(true),
        ]);
    }

    /**
     * Get current stock of a product (uncached).
     * Used by stress-test.cjs to verify data integrity before/after.
     */
    public function stock(int $id)
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }
        return response()->json([
            'product_id' => $id,
            'stock' => $product->stock,
            'version' => $product->version ?? 0,
        ]);
    }

    /**
     * Reset product stock to a specific value (for clean test setup).
     * POST /stress/reset-stock/{id}?stock=500
     */
    public function resetStock(Request $request, int $id)
    {
        $newStock = (int) $request->input('stock', 500);
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }

        $product->stock = $newStock;
        $product->save();

        Log::info("StressTest: Reset product #{$id} stock to {$newStock}");

        return response()->json([
            'product_id' => $id,
            'stock' => $newStock,
            'message' => "Stock reset to {$newStock}",
        ]);
    }
}
