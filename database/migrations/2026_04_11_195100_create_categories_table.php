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
        Schema::create('categories', function (Blueprint $table) {
            $table->id(); // سينشئ حقل 'id' كـ primary key (مكافئ لـ category_id في ERD)
            $table->foreignId('parent_id')->nullable()->constrained('categories')->onDelete('cascade');
            $table->string('name', 45); // حسب ERD: name VARCHAR(45)
            $table->string('image_source')->nullable();
            $table->string('description')->nullable();
            $table->timestamps(); // (اختياري - غير موجود في ERD لكن مفيد للتعقب)
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('categories');
    }
};
