<?php

namespace App\Jobs;

use App\Models\Order;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Job لمعالجة تحديث المخزون بشكل آمن في الخلفية
 *
 * هذا الـ Job يوضح مفهوم Asynchronous Queue + Synchronization
 */
class UpdateStockJob implements ShouldQueue
{
    use Queueable;

    public function __construct(public int $orderId) {}

    public function handle(): void
    {
        // جلب الطلب مع العناصر
        $order = Order::with('items')->find($this->orderId);
        if (!$order) {
            Log::warning("Order not found for stock update: {$this->orderId}");
            return;
        }

        // معالجة كل عنصر في الطلب
        foreach ($order->items as $item) {
            // نقطة تزامن: حجز الصف لمنع التضارب
            DB::transaction(function () use ($item) {
                $product = $item->product()->lockForUpdate()->first();
                if ($product && $product->stock >= $item->quantity) {
                    $product->stock -= $item->quantity;
                    $product->save();
                    Log::info("Stock updated for product #{$product->id}: -{$item->quantity}");
                } else {
                    Log::warning("Insufficient stock for product #{$item->product_id}");
                }
            });
        }
    }
}
