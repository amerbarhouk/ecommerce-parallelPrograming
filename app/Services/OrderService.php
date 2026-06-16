<?php

namespace App\Services;

use App\Models\Product;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        private DistributedLockService $lockService
    ) {}

    public function reserveStock(int $productId, int $qty): bool
    {
        $token = $this->lockService->lock("product:stock:{$productId}");
        if (!$token) {
            throw new \Exception("Could not acquire lock for product {$productId}");
        }

        try {
            return DB::transaction(function () use ($productId, $qty) {
                $product = Product::lockForUpdate()->find($productId);

                if (!$product) {
                    throw new \Exception("Product {$productId} not found");
                }

                if ($product->stock < $qty) {
                    throw new \App\Exceptions\InsufficientStockException();
                }

                $product->stock -= $qty;
                $product->save();
                return true;
            });
        } finally {
            $this->lockService->release("product:stock:{$productId}", $token);
        }
    }

    // app/Services/OrderService.php
public function placeOrder(int $userId, array $items): Order
{
    return DB::transaction(function () use ($userId, $items) {
        $order = Order::create([
            'user_id' => $userId,
            'status' => 'pending',
            'total' => 0,
        ]);

        $total = 0;
        foreach ($items as $item) {
            $this->reserveStock($item['product_id'], $item['qty']); // requirement 7

            $order->items()->create([
                'product_id' => $item['product_id'],
                'quantity'   => $item['qty'],
                'price'      => $item['price'],
            ]);

            $total += $item['price'] * $item['qty'];
        }

        $order->update(['total' => $total, 'status' => 'confirmed']);

        return $order;
    }, 5);
    }
}
