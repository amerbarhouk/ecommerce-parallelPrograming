<?php

namespace App\Concerns;

use Illuminate\Database\Eloquent\Model;

/**
 * @method static \Illuminate\Database\Eloquent\Builder updating(\Closure $callback)
 */
trait HasOptimisticLocking
{
    protected static function bootHasOptimisticLocking()
    {
        static::updating(function (Model $model) {
            $affected = $model->newQuery()
                ->where('id', $model->id)
                ->where('version', $model->getOriginal('version'))
                ->update(array_merge(
                    $model->getDirty(),
                    ['version' => $model->version + 1]
                ));

            if ($affected === 0) {
                throw new \App\Exceptions\OptimisticLockException(
                    "Stale data for {$model->getTable()}#{$model->id}"
                );
            }

            $model->version = $model->version + 1;
            return false;
        });
    }
}
