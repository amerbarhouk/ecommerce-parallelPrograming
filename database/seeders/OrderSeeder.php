<?php

namespace Database\Seeders;

use App\Models\Order;
use Illuminate\Database\Seeder;

class OrderSeeder extends Seeder
{
    public function run(): void
    {
        $total = 10000; // قللنا من 50000 لـ 10000 للأداء
        $chunkSize = 1000;

        $this->command->info("Creating {$total} orders...");

        for ($i = 0; $i < $total; $i += $chunkSize) {
            Order::factory()->count($chunkSize)->create();
            $this->command->info("  Orders: " . min($i + $chunkSize, $total) . "/{$total}");
        }

        $this->command->info("Created {$total} orders successfully.");
    }
}
