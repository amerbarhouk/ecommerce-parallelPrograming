<?php

namespace Tests\Feature;

use Tests\TestCase;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;

class ProductControllerTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Test unsafe way of updating stock (demonstrates race condition)
     */
    public function test_unsafe_way_endpoint_returns_product(): void
    {
        // Create a product with stock
        $product = Product::factory()->create(['stock' => 10]);

        // Call the unsafe endpoint
        $response = $this->get("/unsafe/{$product->id}");

        // Check response
        $response->assertStatus(200);
        $response->assertJsonStructure(['id', 'stock', 'ar_name']);
    }

    /**
     * Test safe way of updating stock (with transaction and locking)
     */
    public function test_safe_way_endpoint_returns_updated_stock(): void
    {
        // Create a product with stock
        $product = Product::factory()->create(['stock' => 10]);

        // Call the safe endpoint
        $response = $this->get("/safe/{$product->id}");

        // Check response
        $response->assertStatus(200);
        $response->assertJsonStructure(['stock_after']);

        // Verify stock was decreased
        $this->assertLessThan(10, $response->json('stock_after'));
    }

    /**
     * Test queue test endpoint dispatches jobs
     */
    public function test_queue_test_endpoint(): void
    {
        $response = $this->get('/queue-test');

        $response->assertStatus(200);
        $response->assertJson([
            'message' => '10 jobs dispatched'
        ]);
    }

    /**
     * Test unsafe endpoint with non-existent product
     */
    public function test_unsafe_endpoint_with_nonexistent_product(): void
    {
        $response = $this->get('/unsafe/99999');

        // Should handle null gracefully
        $response->assertStatus(200);
    }

    /**
     * Test safe endpoint with non-existent product
     */
    public function test_safe_endpoint_with_nonexistent_product(): void
    {
        $response = $this->get('/safe/99999');

        // Should handle error gracefully
        $response->assertStatus(500);
    }
}
