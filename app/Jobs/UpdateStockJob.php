<?php

namespace App\Jobs;

use App\Models\Product;
use App\Services\ProductCacheService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class UpdateStockJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $productId;
    public int $quantity;

    /**
     * Create a new job instance.
     */
    public function __construct(int $productId, int $quantity)
    {
        $this->productId = $productId;
        $this->quantity = $quantity;
    }

    /**
     * Execute the job.
     */
    public function handle(ProductCacheService $cacheService): void
    {
        Log::info("UpdateStockJob started", [
            'product_id' => $this->productId,
            'quantity' => $this->quantity,
        ]);

        try {
            // Use pessimistic locking to safely update stock in DB
            DB::transaction(function () use ($cacheService) {
                $product = Product::where('id', $this->productId)
                    ->lockForUpdate()
                    ->first();

                if (!$product) {
                    Log::warning("Product not found in UpdateStockJob", [
                        'product_id' => $this->productId,
                    ]);
                    return;
                }

                if ($product->stock < $this->quantity) {
                    Log::warning("Insufficient stock in UpdateStockJob", [
                        'product_id' => $this->productId,
                        'current_stock' => $product->stock,
                        'requested' => $this->quantity,
                    ]);
                    return;
                }

                $product->stock -= $this->quantity;
                $product->save();

                Log::info("Stock updated in DB", [
                    'product_id' => $this->productId,
                    'new_stock' => $product->stock,
                ]);

                // Invalidate cache so next read fetches fresh data
                $cacheService->invalidateProduct($this->productId);

                Log::info("Cache invalidated for product", [
                    'product_id' => $this->productId,
                ]);
            });
        } catch (\Exception $e) {
            Log::error("UpdateStockJob failed", [
                'product_id' => $this->productId,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }
}
