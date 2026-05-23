<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Discount extends Model
{
    use HasFactory;

    protected $fillable = [
        'code',
        'description',
        'percentage',
        'fixed_amount',
        'max_uses',
        'used_count',
        'expires_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
    ];

    /**
     * علاقة كود الخصم مع الطلبات
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
