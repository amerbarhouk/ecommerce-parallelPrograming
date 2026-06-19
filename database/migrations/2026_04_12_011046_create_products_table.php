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
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('ar_name', 100);
            $table->string('en_name', 100);
            $table->text('description');
            $table->double('price');
            $table->string('colors', 512)->nullable();      // الألوان
            $table->string('measurements', 100)->nullable(); // الأبعاد
            $table->integer('weight')->nullable();           // الوزن
            $table->string('model', 45)->nullable();         // رقم الطراز
            $table->date('manufacture_date')->nullable();    //  تاريخ التصنيع (تاريخ كامل)
            $table->enum('type', ['used', 'new']);            // نوع المنتج
            $table->foreignId('category_id')
                ->constrained('categories')
                ->onDelete('cascade');
            $table->foreignId('user_id')
                ->constrained('users')
                ->onDelete('cascade'); // صاحب المنتج (بائع/زبون)
            $table->string('contact_phone', 20)->nullable(); // رقم التواصل
            $table->boolean('is_active')->default(false);    // حالة التفعيل
            $table->integer('stock')->default(0);            // الكمية المتوفرة
            $table->timestamps();
            // add 
            $table->unsignedBigInteger('version')->default(0);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
