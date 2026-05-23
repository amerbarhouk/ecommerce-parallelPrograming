<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;

class Order extends Model
{
    //
    use HasFactory;// 
    // الحقول المسموح تعبئتها
    protected $fillable = [
        'user_id',
        'cart_id',
        'total_price',
        'final_price',
        'discount_id',
        'status'
    ];

    /**
     * علاقة الطلب مع السلة المرتبطة فيه
     */
    public function cart(): BelongsTo
    {
        return $this->belongsTo(Cart::class);
    }

    /**
     * علاقة الطلب مع المستخدم (الزبون)
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }


    // علاقة الطلب مع كود الخصم

    public function discount(): BelongsTo
    {
        return $this->belongsTo(Discount::class);
    }

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }
}
