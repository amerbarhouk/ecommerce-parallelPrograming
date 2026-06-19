<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;
use App\Jobs\UpdateStockJob;
use Illuminate\Support\Facades\Log;
use App\Models\OrderItem;
use App\Models\Product;
use Illuminate\Support\Facades\DB;

class OrderController extends Controller
{
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
     * ============================================================
     * ACID Transaction Demo (Requirement #8)
     * ============================================================
     *
     * إنشاء طلب + تحديث المخزون في نفس المعاملة (Single Transaction)
     *
     * يضمن هذا الـ endpoint خصائص ACID الأربعة:
     * - Atomicity:  كل شيء ينجح أو يفشل معاً (لا يوجد حالة وسطى)
     * - Consistency: البيانات تبقى صحيحة قبل وبعد المعاملة
     * - Isolation:   المعاملات المتزامنة لا تؤثر على بعضها (lockForUpdate)
     * - Durability:  بعد commit، البيانات محفوظة بشكل دائم
     *
     * عكس الـ Saga Pattern (completeOrder + UpdateStockJob) الذي يستخدم
     * Eventual Consistency، هذا الـ endpoint يضمن Immediate Consistency.
     *
     * @param Request $request
     *   - product_id: معرف المنتج
     *   - quantity: الكمية المطلوبة (default: 1)
     *   - fail_after: (optional) إذا تم تمريره true، يحاك فشل بعد التحديث
     *                 لإظهار الـ rollback
     * @return \Illuminate\Http\JsonResponse
     */
    public function createOrderAtomic(Request $request)
    {
        $productId = (int) $request->input('product_id', 1);
        $quantity = (int) $request->input('quantity', 1);
        $failAfter = filter_var($request->input('fail_after', false), FILTER_VALIDATE_BOOLEAN);

        Log::info('ACID createOrderAtomic START', [
            'server' => env('SERVER_ID', 'unknown'),
            'product_id' => $productId,
            'quantity' => $quantity,
            'fail_after' => $failAfter,
        ]);

        DB::beginTransaction();

        try {
            // ========================================
            // STEP 1: قفل المنتج وتحقق من المخزون
            // ========================================
            // lockForUpdate = Pessimistic Locking داخل الـ transaction
            // يمنع أي معاملة ثانية من تعديل نفس الصف حتى تنتهي هذه
            $product = Product::where('id', $productId)
                ->lockForUpdate()
                ->first();

            if (!$product) {
                throw new \Exception("Product with ID {$productId} not found.");
            }

            $stockBefore = $product->stock;

            if ($product->stock < $quantity) {
                throw new \Exception(
                    "Insufficient stock for product #{$productId}. Available: {$product->stock}, Requested: {$quantity}"
                );
            }

            Log::info("ACID: Product locked", [
                'product_id' => $productId,
                'stock_before' => $stockBefore,
            ]);

            // ========================================
            // STEP 2: تحديث المخزون (في نفس الـ transaction)
            // ========================================
            $product->stock -= $quantity;
            $product->save();

            $stockAfter = $product->stock;

            Log::info("ACID: Stock updated (not committed yet)", [
                'product_id' => $productId,
                'stock_after' => $stockAfter,
            ]);

            // ========================================
            // STEP 3: إنشاء الطلب (في نفس الـ transaction)
            // ========================================
            $order = Order::create([
                'user_id' => 1,
                'cart_id' => null,
                'total_price' => $product->price * $quantity,
                'final_price' => $product->price * $quantity,
                'status' => 'completed',  // مكتمل فوراً لأن المخزون تحدّث
            ]);

            if (!$order) {
                throw new \Exception("Failed to create Order.");
            }

            // ========================================
            // STEP 4: إنشاء عناصر الطلب (في نفس الـ transaction)
            // ========================================
            $orderItem = OrderItem::create([
                'order_id' => $order->id,
                'product_id' => $productId,
                'quantity' => $quantity,
                'price' => $product->price,
            ]);

            if (!$orderItem) {
                throw new \Exception("Failed to create OrderItem.");
            }

            // ========================================
            // STEP 5 (optional): محاكاة فشل لإظهار الـ rollback
            // ========================================
            if ($failAfter) {
                throw new \Exception("SIMULATED FAILURE after stock update - testing ACID rollback!");
            }

            // ========================================
            // STEP 6: Commit - كل شيء نجح → تثبيت دائم
            // ========================================
            DB::commit();

            Log::info("ACID: Transaction COMMITTED", [
                'order_id' => $order->id,
                'product_id' => $productId,
                'stock_after' => $stockAfter,
            ]);

            return response()->json([
                'message' => 'ACID Transaction Success! Order created + stock updated atomically.',
                'order_id' => $order->id,
                'product_id' => $productId,
                'stock_before' => $stockBefore,
                'stock_after' => $stockAfter,
                'quantity' => $quantity,
                'total_price' => $product->price * $quantity,
                'acid_guarantee' => 'Both Order creation and Stock update succeeded together (or neither did).',
            ], 201);
        } catch (\Exception $e) {
            // ========================================
            // ROLLBACK: فشل أي خطوة → تراجع عن الكل
            // ========================================
            DB::rollBack();

            Log::error("ACID: Transaction ROLLED BACK", [
                'product_id' => $productId,
                'error' => $e->getMessage(),
                'stock_should_be' => $stockBefore ?? 'unknown (product not found)',
            ]);

            return response()->json([
                'message' => 'ACID Transaction Failed - rolled back. No changes were made to DB.',
                'error' => $e->getMessage(),
                'product_id' => $productId,
                'rollback_explanation' => 'Stock was NOT updated and Order was NOT created. ACID Atomicity preserved.',
            ], 500);
        }
    }
}
