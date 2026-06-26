<?php

namespace App\Services;

use App\Models\Product;
use Error;
use Exception;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        private DistributedLockService $lockService
    ) {}

    // New private method — no lock, no own transaction
    // Called only from within placeOrder's transaction
    private function deductStock(int $productId, int $qty): void
    {
        $product = Product::lockForUpdate()->find($productId);

        if (!$product) {
            throw new \Exception("Product {$productId} not found");
        }

        if ($product->stock < $qty) {
            throw new \App\Exceptions\InsufficientStockException();
        }

        $product->stock -= $qty;
        $product->save();
    }

    // Keep reserveStock for afterWay (standalone use with distributed lock)
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

    // Fix placeOrder to use deductStock instead of reserveStock
    public function placeOrder(int $userId, array $items): \App\Models\Order
    {
        return DB::transaction(function () use ($userId, $items) {
            $order = \App\Models\Order::create([
                'user_id'     => $userId,
                'status'      => 'pending',
                'total_price' => 0,
                'final_price' => 0,
            ]);

            $total = 0;
            foreach ($items as $item) {
                $this->deductStock($item['product_id'], $item['qty']);
                // simlate un error
                // throw new Exception("unchaght error");

                $order->items()->create([
                    'product_id' => $item['product_id'],
                    'quantity'   => $item['qty'],
                    'price'      => $item['price'],
                ]);

                $total += $item['price'] * $item['qty'];
            }

            $order->update([
                'total_price' => $total,
                'final_price' => $total,
                'status'      => 'completed',
            ]);

            return $order;
        }, 5);
    }
}
