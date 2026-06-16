<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

use Illuminate\Database\Eloquent\Factories\HasFactory;

class Category extends Model
{
    use HasFactory;



    protected $fillable = [
        'parent_id',
        'name',
        'image_source',
        'description'
    ];

    // الفئات الفرعية
    public function children()
    {
        return $this->hasMany(Category::class, 'parent_id');
    }

    // الفئة الأب
    public function parent()
    {
        return $this->belongsTo(Category::class, 'parent_id');
    }

    // المنتجات التابعة لهذه الفئة
    public function products(): HasMany
    {
        return $this->hasMany(Product::class, 'category_id');
    }



    // تحميل الأبناء بشكل متداخل (Recursive eager loading)
    public function childrenRecursive()
    {
        return $this->children()->with('childrenRecursive');
    }
}
