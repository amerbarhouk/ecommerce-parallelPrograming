<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Product extends Model
{
    use HasFactory; // <--- أضف هذا السطر
    protected $fillable = [
        'ar_name',
        'name',
        'en_name',
        'description',
        'price',
        'colors',
        'measurements',
        'weight',
        'model',
        'manufacture_date',   // تاريخ كامل
        'type',
        'category_id',
        'user_id',
        'contact_phone',
        'is_active',
        'stock',
    ];

    //  التصنيف
    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class, 'category_id');
    }

    //  صاحب المنتج (بائع أو زبون)
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    //  الصور
    public function images(): HasMany
    {
        return $this->hasMany(ProductImage::class, 'product_id');
    }

    // //  التقييمات
    // public function ratings(): HasMany
    // {
    //     return $this->hasMany(Rating::class);
    // }

    //  السلات
    public function carts()
    {
        return $this->belongsToMany(Cart::class, 'cart_product')
            ->withPivot('quantity') // جلب الكمية
            ->withTimestamps();     // جلب التواريخ
    }

    //  المفضلة
    // public function favoritedBy()
    // {
    //     return $this->hasMany(Favorite::class);
    // }
}
