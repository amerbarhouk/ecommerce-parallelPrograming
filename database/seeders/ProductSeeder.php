<?php

namespace Database\Seeders;

use App\Models\Product;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class ProductSeeder extends Seeder
{
    /**
     * Run the database seeds.
     */
    public function run(): void
    {
        // 1. التأكد من وجود تصنيف (Category) برقم 1
        // نستخدم DB::table مباشرة لتجاوز أي مشاكل في Validation أو Fillable
        $category = DB::table('categories')->find(1);

        if (!$category) {
            // إذا لم يوجد تصنيف، نقوم بإنشاء واحد وهمي
            DB::table('categories')->insert([
                'id' => 1,
                'name' => 'General Category', // قد تحتاج لتعديل اسم الحقل حسب جدولك
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $this->command->info('Created Default Category (ID: 1)');
        }

        // 2. إنشاء 10 منتجات تجريبية
        // الـ Factory سيقوم بإنشاء المستخدمين (Users) تلقائياً أيضاً
        Product::factory()->count(10)->create();

        $this->command->info('Created 10 Test Products successfully.');
    }
}
