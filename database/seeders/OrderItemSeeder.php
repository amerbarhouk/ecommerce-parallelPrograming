<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class OrderItemSeeder extends Seeder
{
    public function run(): void
    {
        $orderIds = DB::table('orders')->pluck('id')->toArray();
        $productIds = DB::table('products')->pluck('id')->toArray();

        if (empty($orderIds) || empty($productIds)) {
            $this->command->error('No orders or products found. Run OrderSeeder and ProductSeeder first.');
            return;
        }

        $totalItems = 50000; // 50,000 order items
        $chunkSize = 1000;

        $this->command->info("Creating {$totalItems} order items...");

        for ($i = 0; $i < $totalItems; $i += $chunkSize) {
            $items = [];
            $currentChunk = min($chunkSize, $totalItems - $i);

            for ($j = 0; $j < $currentChunk; $j++) {
                $quantity = rand(1, 5);
                $price = fake()->randomFloat(2, 10, 1000);

                $items[] = [
                    'order_id' => fake()->randomElement($orderIds),
                    'product_id' => fake()->randomElement($productIds),
                    'quantity' => $quantity,
                    'price' => $price,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            DB::table('order_items')->insert($items);
            $this->command->info("  Order items: " . min($i + $chunkSize, $totalItems) . "/{$totalItems}");
        }

        $this->command->info("Created {$totalItems} order items successfully.");
    }
}
