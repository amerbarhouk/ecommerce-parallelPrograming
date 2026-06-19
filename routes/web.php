<?php

use App\Http\Controllers\ProductController;
use Illuminate\Support\Facades\Route;
use App\Jobs\GenerateDailySalesReport;
use Illuminate\Http\Request;
use App\Http\Controllers\ReportComparisonController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\CachedProductController;

Route::get('/', function () {
    return view('welcome');
});

// Unsafe way to update stock without locking
Route::get('/unsafe/{id}', [ProductController::class, 'unsafeWay']);
// Safe way to update stock using database transactions and row locking
Route::get('/safe/{id}', [ProductController::class, 'SafeWay']);
// Test route to dispatch multiple jobs to the queue
Route::get('/queue-test', [ProductController::class, 'testQueue']);



// Generate report using a queued job with optional mode parameter
Route::get('/generate-report/{date}', function (Request $request, $date) {
    $mode = $request->query('mode', 'after');

    GenerateDailySalesReport::dispatch($date, $mode);

    return response()->json([
        'message' => 'Report job dispatched',
        'date' => $date,
        'mode' => $mode,
    ]);
});





//////toggle api for testing both sync and async report generation
Route::get('/report/sync/{date}', [ReportComparisonController::class, 'generateSyncReport']);

Route::get('/report/async/{date}', [ReportComparisonController::class, 'generateAsyncReport']);

// إتمام الطلب (Producer): يضيف Job إلى Queue لتحديث المخزون
Route::post('/orders/{order}/complete', [OrderController::class, 'completeOrder']);

Route::get('/process', function () {
    return response()->json([
        'server_id' => env('SERVER_ID', 'unknown'),
        'port' => request()->getPort(),
        'timestamp' => now()->toDateTimeString(),
    ]);
});

Route::get('/whoami', function () {
    return response()->json([
        'server_id' => env('SERVER_ID', 'unknown'),
        'port' => request()->getPort()
    ]);
});


Route::post('/test-complete/{id}', [OrderController::class, 'completeOrder']);
// هذا السطر يربط الرابط بالدالة
Route::post('/test-create-order', [OrderController::class, 'testCreateOrder']);



// ========================================
// Distributed Caching with Redis Routes
// ========================================

// Cache-Aside: Get product from cache (with stampede protection)
Route::get('/cached-product/{id}', [CachedProductController::class, 'getCachedProduct']);

// Get product directly from database (for performance comparison)
Route::get('/uncached-product/{id}', [CachedProductController::class, 'getUncachedProduct']);

// Unsafe: READ-MODIFY-WRITE in Redis (race condition demonstration)
Route::get('/cached-unsafe/{id}', [CachedProductController::class, 'unsafeCachedWay']);

// Safe: Atomic DECRBY operation (race-condition-safe)
Route::get('/cached-safe/{id}', [CachedProductController::class, 'safeCachedWay']);

// Cache management
Route::get('/cache-warm/{limit?}', [CachedProductController::class, 'warmCache']);
Route::get('/cache-clear', [CachedProductController::class, 'clearCache']);
Route::get('/cache-stats', [CachedProductController::class, 'stats']);
