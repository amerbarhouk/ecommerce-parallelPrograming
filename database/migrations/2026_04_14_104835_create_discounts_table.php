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
        Schema::create('discounts', function (Blueprint $table) {
            $table->id();
            $table->string('code')->unique(); // كود الخصم (مثل: SAVE20)
            $table->text('description')->nullable(); // وصف الخصم
            $table->decimal('percentage', 5, 2)->nullable(); // نسبة الخصم المئوية (مثلاً 20.00)
            $table->decimal('fixed_amount', 10, 2)->nullable(); // مبلغ الخصم الثابت
            $table->integer('max_uses')->nullable(); // أقصى عدد مرات استخدام
            $table->integer('used_count')->default(0); // عدد مرات الاستخدام الفعلي
            $table->boolean('is_active')->default(true); // مفعّل أو لا
            $table->dateTime('expires_at')->nullable(); // تاريخ انتهاء الصلاحية
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('discounts');
    }
};
