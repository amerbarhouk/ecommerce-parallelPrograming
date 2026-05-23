<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // جدول السلة يحتوي على المستخدم الذي يملكها
     Schema::create('carts', function (Blueprint $table) {
        $table->id();// معرف السلة
        $table->foreignId('user_id')->constrained('users')->onDelete('cascade');// ربط السلة بالمستخدم
        $table->timestamps();// تاريخ الإنشاء والتعديل
    });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('carts');
    }
};
