<?php

namespace Tests\Feature;

use App\Services\SalesReportService;
use App\Models\Order;
use App\Models\OrderItem;
use Tests\TestCase;
use Illuminate\Foundation\Testing\RefreshDatabase;

class SalesReportServiceTest extends TestCase
{
    use RefreshDatabase;

    private SalesReportService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SalesReportService();
    }

    /**
     * Test calculateDailySalesWithoutChunk method
     *
     * يختبر حساب المبيعات بدون chunking
     */
    public function test_calculate_daily_sales_without_chunk(): void
    {
        // Setup: إنشاء بيانات اختبار
        $date = now()->toDateString();

        $order = Order::factory()->create(['created_at' => $date]);

        // إنشاء 5 items في نفس الطلب
        for ($i = 1; $i <= 5; $i++) {
            OrderItem::factory()->create([
                'order_id' => $order->id,
                'quantity' => 2,
                'price' => 100,
            ]);
        }

        // Act: استدعاء الـ method
        $result = $this->service->calculateDailySalesWithoutChunk($date);

        // Assert: التحقق من النتائج
        $this->assertEquals(1, $result['total_orders']);
        $this->assertEquals(10, $result['total_items']); // 5 items * 2 quantity
        $this->assertEquals(1000, $result['total_revenue']); // 10 * 100
    }

    /**
     * Test calculateDailySales method with chunking
     *
     * يختبر حساب المبيعات مع chunking (أداء أفضل)
     */
    public function test_calculate_daily_sales_with_chunk(): void
    {
        // Setup: إنشاء بيانات اختبار
        $date = now()->toDateString();

        $order = Order::factory()->create(['created_at' => $date]);

        // إنشاء 5 items
        for ($i = 1; $i <= 5; $i++) {
            OrderItem::factory()->create([
                'order_id' => $order->id,
                'quantity' => 2,
                'price' => 100,
            ]);
        }

        // Act: استدعاء الـ method
        $result = $this->service->calculateDailySales($date);

        // Assert: التحقق من النتائج
        $this->assertEquals(1, $result['total_orders']);
        $this->assertEquals(10, $result['total_items']);
        $this->assertEquals(1000, $result['total_revenue']);
    }

    /**
     * Test empty results when no orders exist
     *
     * يختبر النتائج عندما لا توجد طلبات
     */
    public function test_returns_zero_when_no_orders(): void
    {
        $date = now()->toDateString();

        $result = $this->service->calculateDailySalesWithoutChunk($date);

        $this->assertEquals(0, $result['total_orders']);
        $this->assertEquals(0, $result['total_items']);
        $this->assertEquals(0, $result['total_revenue']);
    }

    /**
     * Test with multiple orders
     *
     * يختبر مع عدة طلبات في نفس اليوم
     */
    public function test_calculate_sales_with_multiple_orders(): void
    {
        $date = now()->toDateString();

        // إنشاء 3 طلبات
        $orders = Order::factory(3)->create(['created_at' => $date]);

        foreach ($orders as $order) {
            OrderItem::factory(2)->create([
                'order_id' => $order->id,
                'quantity' => 1,
                'price' => 50,
            ]);
        }

        $result = $this->service->calculateDailySales($date);

        $this->assertEquals(3, $result['total_orders']);
        $this->assertEquals(6, $result['total_items']); // 3 orders * 2 items
        $this->assertEquals(300, $result['total_revenue']); // 6 items * 50
    }
}
