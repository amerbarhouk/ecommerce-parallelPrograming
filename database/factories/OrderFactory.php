<?php

namespace Database\Factories;

use App\Models\Order;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Carbon;

/**
 * @extends Factory<Order>
 */
class OrderFactory extends Factory
{
    protected $model = Order::class;

    public function definition(): array
    {
        // استخدام user_id عشوائي من المستخدمين الموجودين
        $userIds = User::pluck('id')->toArray();
        $userId = !empty($userIds) ? fake()->randomElement($userIds) : 1;

        $totalPrice = fake()->numberBetween(100, 5000);

        // تجنب DST issue: استخدام Carbon مع إزاحة عشوائية بالأيام
        // بدل fake()->dateTimeBetween() الذي قد يولّد تواريخ في فترة DST
        $createdAt = Carbon::now()->subDays(rand(1, 365))->setTime(rand(8, 22), rand(0, 59), rand(0, 59));

        return [
            'user_id' => $userId,
            'cart_id' => null,
            'discount_id' => null,
            'total_price' => $totalPrice,
            'final_price' => $totalPrice,
            'status' => fake()->randomElement(['pending', 'completed', 'cancelled']),
            'created_at' => $createdAt,
            'updated_at' => $createdAt,
        ];
    }
}
