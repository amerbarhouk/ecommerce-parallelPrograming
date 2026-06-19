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
     * إتمام الطلب: تحديث الحالة فورًا، ثم إضافة Jobs للصف
     * هذا هو الـ Producer الحقيقي
     */
    public function completeOrder(Request $request, int $orderId)
    {
        try {
            // نقوم بلف عملية التحديث في معاملة قاعدة البيانات (Transaction)
            // لضمان أنه لا يمكن لأحد آخر تعديل هذا الطلب أثناء قيامنا بذلك
            $order = DB::transaction(function () use ($orderId) {

                // 1. جلب الطلب مع قفله للتحديث (lockForUpdate)
                // هذا يمنع "تضارب العمليات" (Race Conditions) إذا جاء طلبان لنفس الـ ID في نفس الوقت
                $order = Order::with('items')->lockForUpdate()->findOrFail($orderId);

                // 2. التحقق مما إذا كان الطلب مكملاً مسبقاً
                if ($order->status === 'completed') {
                    // نرمي استثناء لإيقاف العملية وإرجاع رسالة خطأ محددة
                    throw new \Exception('Order already completed.');
                }

                Log::info('Processing order completion', [
                    'server' => env('SERVER_ID', 'unknown'),
                    'order_id' => $orderId
                ]);

                // 3. تحديث حالة الطلب (Synchronous)
                // يتم حفظ التغييرات هنا ضمن الـ Transaction
                $order->status = 'completed';
                $order->save();

                return $order;
            });

            // 4. إضافة Job لتحديث المخزون (Asynchronous Queue)
            // نضع هذا الـ Dispatch خارج الـ Transaction مباشرة لضمان أن البيانات قد "Commit"ت
            // وأن الـ Job سيرى الحالة الجديدة فوراً عند العمل.
            UpdateStockJob::dispatch($order->id);

            // (اختياري) إضافة Job لإرسال الفاتورة أو إشعار
            // SendInvoiceJob::dispatch($order->id);

            Log::info("Order #{$order->id} completed successfully. Stock update job dispatched.");

            return response()->json([
                'message' => 'تم إتمام الطلب بنجاح! سيتم تحديث المخزون في الخلفية.',
                'order_id' => $order->id
            ]);
        } catch (\Exception $e) {
            // معالجة الأخطاء
            $message = $e->getMessage();
            $statusCode = 500;

            // تحديد الكود المناسب إذا كان الخطأ متعلقاً بالطلب المكرر
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
     * دالة تجريبية لإنشاء طلب جديد
     */
    public function testCreateOrder(Request $request)
    {
        // dd('تم الوصول للدالة بنجاح! الكود يعمل.');
        // تسجيل بداية الطلب لنتأكد أن الدالة تستدعى أصلاً
        Log::info('testCreateOrder Hit', ['request_data' => $request->all()]);

        // نبدأ المعاملة يدوياً للتحكم الكامل
        DB::beginTransaction();

        try {
            $productId = $request->input('product_id', 1);
            $quantity = (int) $request->input('quantity', 1);

            // 1. التأكد من وجود المنتج (بدون findOrFail لتجنب الـ 404 المباشر ومعرفة السبب)
            $product = Product::find($productId);

            if (!$product) {
                Log::error("Product not found", ['product_id' => $productId]);
                throw new \Exception("Product with ID {$productId} does not exist.");
            }

            $price = $product->price;

            // 2. إنشاء الطلب
            // إذا لم يعمل هذا، تأكد من $fillable في ملف Order.php
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

            // 3. إنشاء عناصر الطلب
            $orderItem = OrderItem::create([
                'order_id' => $order->id,
                'product_id' => $productId,
                'quantity' => $quantity,
                'price' => $price
            ]);

            if (!$orderItem) {
                throw new \Exception("Failed to create OrderItem object.");
            }

            // وصولنا هنا يعني أن كل شيء نجاح، نقوم بتثبيت التغييرات
            DB::commit();

            Log::info('Order Created Successfully in DB', ['order_id' => $order->id]);

            return response()->json(['order_id' => $order->id, 'status' => 'created'], 201);
        } catch (\Exception $e) {
            // في حال حدث أي خطأ، نقوم بالتراجع عن كل شيء
            DB::rollBack();

            Log::error('testCreateOrder Failed', [
                'error_message' => $e->getMessage(),
                'trace' => $e->getTraceAsString() // يساعد في معرفة السطر بالضبط
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
                'aop_time_ms' => Cache::get("perf:place_order:last"), // ← أضف هاد السطر بس
            ], 201);
        } catch (\Exception $e) {
            return response()->json([
                'message' => 'Failed to place order',
                'error'   => $e->getMessage()
            ], 400);
        }
    }
}
