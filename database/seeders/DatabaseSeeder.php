<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    public function run(): void
    {
        $this->command->info('=== Starting Database Seeding ===');

        // 1. Users أولاً
        $this->call(UserSeeder::class);

        // 2. منتجات (10,000 منتج)
        $this->call(ProductSeeder::class);

        // 3. طلبات (10,000 طلب)
        $this->call(OrderSeeder::class);

        // 4. عناصر الطلبات (50,000 عنصر) - مهم للاختبارات!
        $this->call(OrderItemSeeder::class);

        $this->command->info('=== Database Seeding Complete ===');
    }
}
