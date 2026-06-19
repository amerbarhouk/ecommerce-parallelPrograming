<?php

namespace Database\Seeders;

use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class ProductSeeder extends Seeder
{
    public function run(): void
    {
        // 1. التأكد من وجود تصنيف افتراضي
        $category = DB::table('categories')->find(1);
        if (!$category) {
            DB::table('categories')->insert([
                'id' => 1,
                'name' => 'General Category',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->command->info('Created Default Category (ID: 1)');
        }

        // 2. التأكد من وجود مستخدمين
        if (User::count() === 0) {
            User::factory(20)->create();
            $this->command->info('Created 20 users');
        }

        $userIds = User::pluck('id')->toArray();
        $total = 10000;
        $chunkSize = 500;

        $this->command->info("Creating {$total} products in chunks of {$chunkSize}...");

        for ($i = 0; $i < $total; $i += $chunkSize) {
            $products = [];
            $currentChunk = min($chunkSize, $total - $i);

            for ($j = 0; $j < $currentChunk; $j++) {
                $products[] = [
                    'name' => fake()->words(3, true),
                    'ar_name' => fake('ar_SA')->words(3, true),
                    'en_name' => fake()->word,
                    'description' => fake()->paragraph(),
                    'price' => fake()->randomFloat(2, 10, 1000),
                    'type' => fake()->randomElement(['new', 'used']),
                    'is_active' => true,
                    'stock' => fake()->numberBetween(1, 200),
                    'colors' => json_encode(fake()->randomElements(['red', 'blue', 'black', 'white', 'green'], rand(1, 4))),
                    'measurements' => fake()->numberBetween(1, 100) . 'x' . fake()->numberBetween(1, 100) . 'x' . fake()->numberBetween(1, 50),
                    'weight' => fake()->numberBetween(1, 50),
                    'model' => 'Model-' . fake()->randomNumber(4),
                    'manufacture_date' => fake()->date(),
                    'user_id' => fake()->randomElement($userIds),
                    'category_id' => 1,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            }

            DB::table('products')->insert($products);
            $this->command->info("  Products: " . ($i + $currentChunk) . "/{$total}");
        }

        $this->command->info("Created {$total} products successfully.");
    }
}
