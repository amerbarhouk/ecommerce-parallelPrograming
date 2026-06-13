<?php

namespace Database\Factories;

use App\Models\Product;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

class ProductFactory extends Factory
{
    /**
     * The name of the factory's corresponding model.
     *
     * @var string
     */
    protected $model = Product::class;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            // أسماء وهمية
            'name' => $this->faker->word, // مثال: "Laptop"
            'ar_name' => $this->faker->sentence(3), // مثال: "هاتف ذكي جديد"
            'en_name' => $this->faker->word,       // مثال: "Smartphone"

            // وصف وهمي
            'description' => $this->faker->paragraph,

            // سعر عشوائي بين 10 و 1000
            'price' => $this->faker->randomFloat(2, 10, 1000),

            // نوع المنتج (جديد أو مستعمل)
            'type' => $this->faker->randomElement(['new', 'used']),

            // تفعيل المنتج وتخزين كمية عشوائية
            'is_active' => true,
            'stock' => $this->faker->numberBetween(1, 100),

            // بيانات تقنية اختيارية
            'colors' => json_encode(['red', 'blue', 'black']), // تخزين مصفوفة كـ JSON
            'measurements' => '10x20x5',
            'weight' => $this->faker->numberBetween(1, 50),
            'model' => 'Model-' . $this->faker->randomNumber(4),
            'manufacture_date' => $this->faker->date(),

            // --- الروابط (Foreign Keys) ---

            // إنشاء مستخدم وهمي جديد وربطه بالمنتج
            // هذا يحل مشكلة عدم وجود User ID
            'user_id' => User::factory(),

            // ملاحظة: سنقوم بإنشاء Category افتراضي في الـ Seeder لضمان وجوده
            'category_id' => 1,
        ];
    }
}
