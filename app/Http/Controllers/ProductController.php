<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessOrder;
use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class ProductController extends Controller
{
    //
    public function unsafeWay(int $id)
    {
        $product = Product::find($id);

        if ($product->stock > 0) {
            sleep(5);
            $product->stock -= 1;
            $product->save();
        }

        return response()->json($product);
    }
    public function SafeWay(int $id)
    {
        $result = DB::transaction(function () use ($id) {
            $product = Product::where('id', $id)
                ->lockForUpdate()
                ->first();

            Log::info("Before update stock: " . $product->stock);

            if ($product->stock > 0) {
                sleep(5);

                $product->stock -= 1;
                $product->save();

                Log::info("After update stock: " . $product->stock);
            }

            return $product->stock;
        });

        return response()->json([
            'stock_after' => $result
        ]);
    }

    public function testQueue()
    {
        for ($i = 1; $i <= 10; $i++) {
            ProcessOrder::dispatch();
        }

        return response()->json([
            'message' => '10 jobs dispatched'
        ]);
    }
}
