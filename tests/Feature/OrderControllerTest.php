<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Product;
use App\Models\User;
use App\Models\Order;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Cache;
use Illuminate\Foundation\Testing\RefreshDatabase;

class OrderControllerTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Test placing an order successfully via the store endpoint (Performance AOP + Redis lock)
     */
    public function test_place_order_endpoint_creates_order_and_applies_aop_timing(): void
    {
        // 1. Mock Redis locking for reserveStock
        Redis::shouldReceive('set')
            ->once()
            ->andReturn(true);

        Redis::shouldReceive('eval')
            ->once()
            ->andReturn(true);

        // 2. Clear previous performance cache
        Cache::forget('perf:place_order:last');

        // 3. Create test models
        $user = User::factory()->create();
        $product1 = Product::factory()->create(['stock' => 10, 'price' => 100]);
        $product2 = Product::factory()->create(['stock' => 5, 'price' => 50]);

        $payload = [
            'user_id' => $user->id,
            'items' => [
                [
                    'product_id' => $product1->id,
                    'qty' => 2,
                    'price' => 100
                ],
                [
                    'product_id' => $product2->id,
                    'qty' => 1,
                    'price' => 50
                ]
            ]
        ];

        // 4. Send the request
        $response = $this->postJson('/api/orders', $payload);

        // 5. Assertions
        $response->assertStatus(201);
        $response->assertJsonStructure([
            'id',
            'user_id',
            'status',
            'total_price',
            'final_price',
            'items' => [
                '*' => [
                    'id',
                    'order_id',
                    'product_id',
                    'quantity',
                    'price'
                ]
            ]
        ]);

        $this->assertEquals('confirmed', $response->json('status'));
        $this->assertEquals(250, $response->json('total_price')); // (2 * 100) + (1 * 50)
        $this->assertEquals(250, $response->json('final_price'));

        // Verify stock has decreased
        $this->assertEquals(8, $product1->fresh()->stock);
        $this->assertEquals(4, $product2->fresh()->stock);

        // Verify order items exist in DB
        $this->assertDatabaseHas('orders', [
            'id' => $response->json('id'),
            'user_id' => $user->id,
            'total_price' => 250,
            'status' => 'confirmed'
        ]);

        $this->assertDatabaseHas('order_items', [
            'order_id' => $response->json('id'),
            'product_id' => $product1->id,
            'quantity' => 2,
            'price' => 100
        ]);

        // 6. Verify AOP Aspect logic executed (recorded timing in Cache)
        $this->assertTrue(Cache::has('perf:place_order:last'));
        $this->assertGreaterThan(0, Cache::get('perf:place_order:last'));
    }
}
