<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;
use App\Jobs\UpdateStockJob;
use Illuminate\Support\Facades\Log;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Support\Facades\DB;
use App\Services\OrderService;
use App\Aspects\PerformanceAspect;
use Illuminate\Support\Facades\Cache;

class OrderController extends Controller
{
    public function __construct(
        private OrderService $orderService,
        private PerformanceAspect $perf
    ) {}
    /**
     * Completing the order: update the status immediately, then add Jobs to the queue
     * This is the real Producer
     */
    public function completeOrder(Request $request, int $orderId)
    {
        try {
            // We wrap the update process in a database transaction
            // to make sure no one else can modify this request while we're doing it
            $order = DB::transaction(function () use ($orderId) {

                // 1. Fetch the request with a lock for update (lockForUpdate)
                // This prevents race conditions if two requests come for the same ID at the same time
                $order = Order::with('items')->lockForUpdate()->findOrFail($orderId);

                // 2. Check if the order is already completed
                if ($order->status === 'completed') {
                    // Throw an exception to stop the process and return a specific error message
                    throw new \Exception('Order already completed.');
                }

                Log::info('Processing order completion', [
                    'server' => env('SERVER_ID', 'unknown'),
                    'order_id' => $orderId
                ]);

                // 3. Update the order status (Synchronous)
                // The changes are saved here within the Transaction
                $order->status = 'completed';
                $order->save();

                return $order;
            });

            // 4. Adding a Job to update inventory (Asynchronous Queue)
            // We put this Dispatch right outside the Transaction to make sure the data has "Committed"
            // and the Job will see the new state immediately when it runs.

            // UpdateStockJob::dispatch($order->id);
            $dispatchedCount = 0;
            foreach ($order->items as $item) {
                UpdateStockJob::dispatch($item->product_id, $item->quantity);
                $dispatchedCount++;
            }

            Log::info("Order #{$order->id} completed successfully. Stock update jobs dispatched.", [
                'items_count' => $dispatchedCount,
            ]);

            return response()->json([
                'message' => 'The order has been completed successfully! The inventory will be updated in the background.',
                'order_id' => $order->id,
                'dispatched_jobs' => $dispatchedCount
            ]);

            // (Optional) Add a Job to send the invoice or notification
            // SendInvoiceJob::dispatch($order->id);


        } catch (\Exception $e) {
            // Handling errors
            $message = $e->getMessage();
            $statusCode = 500;

            // Determine the appropriate code if the error is related to a duplicate request
            if (strpos($message, 'already completed') !== false || $e instanceof \Illuminate\Database\Eloquent\ModelNotFoundException) {
                $statusCode = 400;
            }

            Log::error('Error completing order', [
                'order_id' => $orderId,
                'error' => $message
            ]);

            return response()->json([
                'message' => ($statusCode === 400) ? 'الطلب مكتمل بالفعل أو غير موجود' : 'حدث خطأ في الخادم',
                'error' => $message
            ], $statusCode);
        }
    }

    /**
     * Test function to create a new request
     */
    public function testCreateOrder(Request $request)
    {
        // dd('Function reached successfully! The code works.');
        // Logging the start of the request to make sure the function is actually being called
        Log::info('testCreateOrder Hit', ['request_data' => $request->all()]);

        // We start the transaction manually for full control
        DB::beginTransaction();

        try {
            $productId = $request->input('product_id', 1);
            $quantity = (int) $request->input('quantity', 1);

            // 1. Make sure the product exists (without findOrFail to avoid a direct 404 and understand the reason)
            $product = Product::find($productId);

            if (!$product) {
                Log::error("Product not found", ['product_id' => $productId]);
                throw new \Exception("Product with ID {$productId} does not exist.");
            }

            $price = $product->price;

            // 2. Create the order
            // If this doesn't work, make sure $fillable is set in the Order.php file
            $order = Order::create([
                'user_id' => 1,
                'cart_id' => null,
                'total_price' => $price * $quantity,
                'final_price' => $price * $quantity,
                'status' => 'pending'
            ]);

            if (!$order) {
                throw new \Exception("Failed to create Order object.");
            }

            // 3. Create the order items
            $orderItem = OrderItem::create([
                'order_id' => $order->id,
                'product_id' => $productId,
                'quantity' => $quantity,
                'price' => $price
            ]);

            if (!$orderItem) {
                throw new \Exception("Failed to create OrderItem object.");
            }

            // Reaching here means everything is a success, we are applying the changes
            DB::commit();

            Log::info('Order Created Successfully in DB', ['order_id' => $order->id]);

            return response()->json(['order_id' => $order->id, 'status' => 'created'], 201);
        } catch (\Exception $e) {
            // If any error occurs, we roll back everything
            DB::rollBack();

            Log::error('testCreateOrder Failed', [
                'error_message' => $e->getMessage(),
                'trace' => $e->getTraceAsString() // Helps to know the exact line
            ]);

            return response()->json([
                'message' => 'Failed to create order',
                'error' => $e->getMessage()
            ], 500);
        }
    }

    /**
     * إنشاء طلب جديد باستخدام OrderService وتطبيق منطق AOP لقفل المخزون والتحقق من الأداء
     */

    public function store(Request $request)
    {
        $userId = $request->user()?->id ?? $request->input('user_id', 1);
        $items = $request->input('items', []);

        try {
            $order = $this->perf->around('place_order', function () use ($userId, $items) {
                return $this->orderService->placeOrder($userId, $items);
            });

            return response()->json([
                'order'       => $order->load('items'),
                'aop_time_ms' => Cache::get("perf:place_order:last"),
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to place order',
                'error'   => $e->getMessage()
            ], 400);
        }
    }
}
