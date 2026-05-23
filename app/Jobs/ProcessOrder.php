<?php

namespace App\Jobs;

use App\Models\Order;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use App\Aspects\JobExecutionAspect;
use Illuminate\Support\Facades\App;

/**
 * ProcessOrder Job
 *
 * هذا الـ Job يقوم بمعالجة الطلبات بشكل غير متزامن
 * يمكن استخدامه لـ:
 * - تحديث حالة الطلب
 * - إرسال إشعارات
 * - تحديث المخزون
 * - إنشاء فاتورة
 */
class ProcessOrder implements ShouldQueue
{
    use Queueable;

    /**
     * إنشاء instance جديد من الـ Job
     *
     * @param int|null $orderId معرّف الطلب المراد معالجته
     */
    public function __construct(private ?int $orderId = null)
    {
        //
    }

    /**
     * تنفيذ الـ Job
     *
     * @return void
     */
    public function handle(): void
    {
        // تفعيل AOP Aspect
        $aspect = App::make(JobExecutionAspect::class);
        $aspect->before(self::class);

        try {
            // إذا تم تمرير order_id
            if ($this->orderId) {
                $order = Order::find($this->orderId);

                if (!$order) {
                    Log::warning("Order not found: {$this->orderId}");
                    return;
                }

                // معالجة الطلب
                Log::info("Processing Order: #{$order->id}", [
                    'user_id' => $order->user_id,
                    'total_price' => $order->total_price,
                ]);

                // محاكاة العمليات
                sleep(2);

                // تحديث حالة الطلب
                $order->update(['status' => 'processed']);

                Log::info("Order Processed Successfully: #{$order->id}");
            } else {
                // إذا لم يتم تمرير order_id
                Log::info("Job started: " . now());
                sleep(2);
                Log::info("Job finished: " . now());
            }
        } finally {
            // دائماً تنفيذ آخر العمليات حتى عند الأخطاء
            $aspect->after(self::class);
        }
    }
}
