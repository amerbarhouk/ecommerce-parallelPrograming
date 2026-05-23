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
    $table->enum('type', ['percentage', 'fixed']); // نوع الخصم (نسبة مئوية أو مبلغ ثابت)
    $table->decimal('value', 8, 2); // قيمة الخصم
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
