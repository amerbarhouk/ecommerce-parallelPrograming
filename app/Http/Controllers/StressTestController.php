<?php

namespace App\Http\Controllers;

use App\Models\Product;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class StressTestController extends Controller
{
    public function unsafeFast(int $id)
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }
        if ($product->stock > 0) {
            $product->stock -= 1;
            $product->save();
        }
        return response()->json([
            'product_id' => $id,
            'stock_after' => $product->stock,
        ]);
    }

    public function safeFast(int $id)
    {
        $result = DB::transaction(function () use ($id) {
            $product = Product::where('id', $id)
                ->lockForUpdate()
                ->first();
            if (!$product) {
                return null;
            }
            if ($product->stock > 0) {
                $product->stock -= 1;
                $product->save();
            }
            return $product->stock;
        });
        if ($result === null) {
            return response()->json(['error' => 'Product not found'], 404);
        }
        return response()->json([
            'product_id' => $id,
            'stock_after' => $result,
        ]);
    }

    public function ping()
    {
        return response()->json([
            'ok' => true,
            'server_id' => env('SERVER_ID', 'unknown'),
            'port' => $_SERVER['SERVER_PORT'] ?? 'unknown',
            'pid' => getmypid(),
            'time' => microtime(true),
        ]);
    }

    public function stock(int $id)
    {
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }
        return response()->json([
            'product_id' => $id,
            'stock' => $product->stock,
            'version' => $product->version ?? 0,
        ]);
    }

    public function resetStock(Request $request, int $id)
    {
        $newStock = (int) $request->input('stock', 500);
        $product = Product::find($id);
        if (!$product) {
            return response()->json(['error' => 'Product not found'], 404);
        }
        $product->stock = $newStock;
        $product->save();
        Log::info("StressTest: Reset product #{$id} stock to {$newStock}");
        return response()->json([
            'product_id' => $id,
            'stock' => $newStock,
            'message' => "Stock reset to {$newStock}",
        ]);
    }
}
