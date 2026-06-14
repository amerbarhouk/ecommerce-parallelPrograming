<?php

namespace App\Jobs;

use App\Models\DailySalesReport;
use App\Models\Order;
use App\Services\SalesReportService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use App\Aspects\JobExecutionAspect;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Log;

class GenerateDailySalesReport implements ShouldQueue
{
    use Queueable;

    public function __construct(public string $date, public string $mode = 'after') {}

    /**
     * Batch Processing: يعالج الطلبات على دفعات (chunks) لزيادة الأداء
     * ويوثق كل دفعة في الـ log
     */
    public function handle(SalesReportService $service): void
    {
        //  AOP Aspect
        $aspect = App::make(JobExecutionAspect::class);
        $aspect->before(self::class . " [{$this->mode}]");

        try {
            $result = [
                'total_orders' => 0,
                'total_items' => 0,
                'total_revenue' => 0,
            ];

            // Batch Processing حقيقي مع eager loading لتجنب N+1 queries
            $chunkSize = 500;
            $chunkIndex = 0;
            Order::whereDate('created_at', $this->date)
                ->with('items')
                ->chunkById($chunkSize, function ($orders) use (&$result, &$chunkIndex) {
                    $chunkIndex++;
                    $ordersCount = count($orders);
                    Log::info("Processing chunk #{$chunkIndex} with {$ordersCount} orders");
                    foreach ($orders as $order) {
                        $result['total_orders']++;
                        foreach ($order->items as $item) {
                            $result['total_items'] += $item->quantity;
                            $result['total_revenue'] += $item->quantity * $item->price;
                        }
                    }
                });

            Log::info("Batch processing complete. Chunks: {$chunkIndex}");

            DailySalesReport::updateOrCreate(
                ['date' => $this->date],
                array_merge($result, ['status' => 'completed'])
            );
        } finally {
            //  Always execute even if error happens
            $aspect->after(self::class . " [{$this->mode}]");
        }
    }
}
