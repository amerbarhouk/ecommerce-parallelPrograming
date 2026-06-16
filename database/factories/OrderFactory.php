<?php

namespace Database\Factories;

use App\Models\Order;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Order>
 */
class OrderFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */

    protected $model = Order::class; //
    public function definition(): array
    {
        return [

            'user_id' => User::factory(),

            'cart_id' => null,

            'discount_id' => null,

            'total_price' => fake()->numberBetween(100, 5000),

            'final_price' => fake()->numberBetween(100, 5000),

            'status' => 'completed',

            'created_at' => now(),

            'updated_at' => now(),
        ];
    }
}
