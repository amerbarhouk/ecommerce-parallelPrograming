<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Cart extends Model
{
    // الحقول التي يمكن تعبئتها
    protected $fillable = ['user_id'];

    // علاقة السلة بمستخدم واحد (صاحب السلة)
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    // علاقة السلة بالعديد من المنتجات عبر جدول وسيط مع الكمية
    public function products(): BelongsToMany
    {
        return $this->belongsToMany(Product::class, 'cart_product')
            ->withPivot('quantity') // جلب حقل الكمية
            ->withTimestamps();     // جلب تواريخ الإنشاء والتعديل
    }
    // علاقة السلة مع الطلب (واحد إلى واحد)
    public function order(): HasOne
    {
        return $this->hasOne(Order::class);
    }
}
