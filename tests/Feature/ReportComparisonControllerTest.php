<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\DailySalesReport;
use Illuminate\Foundation\Testing\RefreshDatabase;

class ReportComparisonControllerTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Test sync report generation
     *
     * يختبر توليد التقرير بشكل متزامن
     */
    public function test_sync_report_generation(): void
    {
        $date = now()->toDateString();

        // إنشاء بيانات اختبار
        $order = Order::factory()->create(['created_at' => $date]);
        OrderItem::factory(3)->create([
            'order_id' => $order->id,
            'quantity' => 2,
            'price' => 100,
        ]);

        // Call sync endpoint
        $response = $this->get("/report/sync/{$date}");

        $response->assertStatus(200);
        $response->assertJson([
            'mode' => 'sync',
        ]);

        // Check response has execution_time_ms
        $response->assertJsonStructure(['mode', 'execution_time_ms']);

        // Verify report was saved in database
        $this->assertDatabaseHas('daily_sales_reports', [
            'date' => $date,
            'total_orders' => 1,
            'total_items' => 6,
        ]);
    }

    /**
     * Test async report generation (job dispatch)
     *
     * يختبر توليد التقرير بشكل غير متزامن
     */
    public function test_async_report_generation(): void
    {
        $date = now()->toDateString();

        // Call async endpoint
        $response = $this->get("/report/async/{$date}");

        $response->assertStatus(200);
        $response->assertJson([
            'mode' => 'async',
            'message' => 'Job dispatched to queue',
        ]);

        // Check response has dispatch_time_ms
        $response->assertJsonStructure(['mode', 'message', 'dispatch_time_ms']);
    }

    /**
     * Test sync report with no orders
     *
     * يختبر التقرير عندما لا توجد طلبات
     */
    public function test_sync_report_with_no_orders(): void
    {
        $date = now()->toDateString();

        $response = $this->get("/report/sync/{$date}");

        $response->assertStatus(200);

        // Check that report was created with zero values
        $this->assertDatabaseHas('daily_sales_reports', [
            'date' => $date,
            'total_orders' => 0,
            'total_items' => 0,
            'total_revenue' => 0,
        ]);
    }

    /**
     * Test sync report updates existing report
     *
     * يختبر تحديث التقرير الموجود
     */
    public function test_sync_report_updates_existing(): void
    {
        $date = now()->toDateString();

        // Create initial report
        DailySalesReport::create([
            'date' => $date,
            'total_orders' => 5,
            'total_items' => 10,
            'total_revenue' => 500,
        ]);

        // Create new order data
        $order = Order::factory()->create(['created_at' => $date]);
        OrderItem::factory(2)->create([
            'order_id' => $order->id,
            'quantity' => 1,
            'price' => 100,
        ]);

        // Call sync endpoint
        $response = $this->get("/report/sync/{$date}");

        $response->assertStatus(200);

        // Verify report was updated (not created again)
        $this->assertDatabaseCount('daily_sales_reports', 1);
        $this->assertDatabaseHas('daily_sales_reports', [
            'date' => $date,
            'total_orders' => 1,
            'total_items' => 2,
        ]);
    }

    /**
     * Test generate report route with mode parameter
     */
    public function test_generate_report_route_with_mode(): void
    {
        $date = now()->toDateString();

        // Test with 'before' mode
        $response = $this->get("/generate-report/{$date}?mode=before");
        $response->assertStatus(200);
        $response->assertJson([
            'date' => $date,
            'mode' => 'before',
        ]);

        // Test with 'after' mode (default)
        $response = $this->get("/generate-report/{$date}?mode=after");
        $response->assertStatus(200);
        $response->assertJson([
            'date' => $date,
            'mode' => 'after',
        ]);
    }
}
