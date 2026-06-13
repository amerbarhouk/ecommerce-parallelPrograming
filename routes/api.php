<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\OrderController;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider and all of them will
| be assigned to the "api" middleware group. Make something great!
|
*/

// روابط الاختبار الخاصة بنا
Route::post('/test-create-order', [OrderController::class, 'testCreateOrder']);

Route::post('/test-complete/{id}', [OrderController::class, 'completeOrder']);
