<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class DailySalesReport extends Model
{
    protected $fillable = [
        'date',
        'total_orders',
        'total_items',
        'total_revenue',
    ];
}
