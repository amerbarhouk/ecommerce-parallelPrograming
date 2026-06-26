<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessOrder;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Services\OrderService;
use App\Aspects\PerformanceAspect;
use Illuminate\Support\Facades\Cache;

class ProductController extends Controller
{
    public function __construct(
        private OrderService $orderService,
        private PerformanceAspect $perf

    ) {}
    /**
     * طريقة غير آمنة لتحديث المخزون (توضح Race Condition)
     *
     * ⚠️ ملاحظة: عند استخدام SQLite، لا يدعم قفل الصفوف (row-level locking)
     * بشكل حقيقي مثل MySQL/Postgre SQL. لذلك قد لا يمنع SafeWay() أدناه
     * Race Conditions فعلياً مع SQLite. يُنصح باستخدام MySQL أو PostgreSQL
     * لاختبار القفل الحقيقي.
     */
    public function unsafeWay(int $id)
    {
        $product = Product::find($id);

        if (!$product) {
            return response()->json([
                'error' => 'Product not found'
            ], 404);
        }

        if ($product->stock > 0) {
            sleep(5);
            $product->stock -= 1;
            $product->save();
        }

        return response()->json($product);
    }
    public function SafeWay(int $id)
    {
        $result = DB::transaction(function () use ($id) {
            $product = Product::where('id', $id)
                ->lockForUpdate()
                ->first();

            if (!$product) {
                return null;
            }

            Log::info("Before update stock: " . $product->stock);

            if ($product->stock > 0) {
                sleep(5);

                $product->stock -= 1;
                $product->save();

                Log::info("After update stock: " . $product->stock);
            }

            return $product->stock;
        });

        if ($result === null) {
            return response()->json([
                'error' => 'Product not found'
            ], 404);
        }

        return response()->json([
            'stock_after' => $result
        ]);
    }

    public function testQueue()
    {
        $dispatchedCount = 0;
        $skippedCount = 0;

        // جلب أوامر حقيقية من قاعدة البيانات لمعالجتها
        $orders = Order::where('status', 'pending')->limit(10)->get();

        foreach ($orders as $order) {
            ProcessOrder::dispatch($order->id);
            $dispatchedCount++;
        }

        // إذا لم نجد أوامر كافية، نرسل jobs تجريبية بدون orderId
        $remaining = 10 - $dispatchedCount;
        for ($i = 1; $i <= $remaining; $i++) {
            ProcessOrder::dispatch(null);
            $skippedCount++;
        }

        return response()->json([
            'message' => "{$dispatchedCount} jobs dispatched with order IDs, {$skippedCount} jobs dispatched without order IDs",
            'total_dispatched' => 10
        ]);
    }

    /**
     * "After" endpoint — Redis distributed lock + DB pessimistic lock + optimistic version check
     */

    public function afterWay(Request $request, int $id)
    {
        $qty = (int) $request->input('qty', 1);

        try {
            $this->perf->around("reserveStock:{$id}", fn() => $this->orderService->reserveStock($id, $qty));

            $product = Product::find($id);
            return response()->json([
                'message'     => 'Stock reserved successfully',
                'stock_after' => $product->stock,
                'aop_time_ms' => Cache::get("perf:reserveStock:{$id}:last"), // ← أضف هاد السطر بس
            ]);
        } catch (\App\Exceptions\InsufficientStockException $e) {
            return response()->json(['error' => 'Insufficient stock'], 409);
        } catch (\App\Exceptions\OptimisticLockException $e) {
            return response()->json(['error' => $e->getMessage()], 409);
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 500);
        }
    }
}
