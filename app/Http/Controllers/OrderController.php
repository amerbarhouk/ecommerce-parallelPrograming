<?php

namespace App\Http\Controllers;

use App\Models\Order;
use Illuminate\Http\Request;
use App\Jobs\UpdateStockJob;
use Illuminate\Support\Facades\Log;

class OrderController extends Controller
{
    /**
     * إتمام الطلب: تحديث الحالة فورًا، ثم إضافة Jobs للصف
     * هذا هو الـ Producer الحقيقي
     */
    public function completeOrder(Request $request, $orderId)
    {
        $order = Order::with('items')->findOrFail($orderId);
        if ($order->status === 'completed') {
            return response()->json(['message' => 'Order already completed.'], 400);
        }

        // تحديث حالة الطلب مباشرة (Synchronous)
        $order->status = 'completed';
        $order->save();

        // إضافة Job لتحديث المخزون (Asynchronous Queue)
        UpdateStockJob::dispatch($order->id);

        // (اختياري) إضافة Job لإرسال الفاتورة أو إشعار
        // SendInvoiceJob::dispatch($order->id);

        Log::info("Order #{$order->id} completed. Stock update job dispatched.");

        return response()->json([
            'message' => 'Order completed! Stock update will be processed in background.',
            'order_id' => $order->id
        ]);
    }
}
