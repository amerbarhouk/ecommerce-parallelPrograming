<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // جدول وسيط بين السلة والمنتجات مع كمية كل منتج
        Schema::create('cart_product', function (Blueprint $table) {
            $table->id(); // معرف السطر
            $table->foreignId('cart_id')->constrained()->onDelete('cascade'); // السلة المرتبط بها المنتج
            $table->foreignId('product_id')->constrained()->onDelete('cascade'); // المنتج المرتبط بالسلة
            $table->integer('quantity')->default(1); // عدد القطع من المنتج
            $table->timestamps(); // تاريخ الإنشاء والتعديل
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('cart_product');
    }
};
