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
        'is_active',
        'expires_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'is_active' => 'boolean',
        'percentage' => 'decimal:2',
        'fixed_amount' => 'decimal:2',
    ];

    /**
     * علاقة كود الخصم مع الطلبات
     */
    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
