<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Product>
 */
class ProductFactory extends Factory
{
    public function definition(): array
    {
        $types = ['new', 'used', 'refurbished'];
        $colors = ['red', 'blue', 'black', 'white', 'green', 'yellow', 'purple'];

        return [
            'name' => fake()->words(3, true),
            'ar_name' => fake('ar_SA')->words(3, true),
            'en_name' => fake()->words(2, true),
            'description' => fake()->paragraph(),
            'price' => fake()->randomFloat(2, 10, 5000),
            'colors' => json_encode(fake()->randomElements($colors, rand(1, 4))),
            'measurements' => fake()->numberBetween(1, 100) . 'x' . fake()->numberBetween(1, 100) . 'x' . fake()->numberBetween(1, 50),
            'weight' => fake()->numberBetween(1, 500),
            'model' => 'Model-' . fake()->numberBetween(1000, 99999),
            'manufacture_date' => fake()->dateTimeBetween('-10 years', 'now')->format('Y-m-d'),
            'type' => fake()->randomElement($types),
            'category_id' => fake()->numberBetween(1, 5),
            'user_id' => fake()->numberBetween(1, 20),
            'contact_phone' => fake()->optional(0.7)->phoneNumber(),
            'is_active' => fake()->boolean(80),
            'stock' => fake()->numberBetween(0, 500),
            'created_at' => fake()->dateTimeBetween('-2 years', 'now'),
            'updated_at' => now(),
        ];
    }
}
