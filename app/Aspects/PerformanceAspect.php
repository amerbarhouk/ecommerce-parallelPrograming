<?php

namespace App\Aspects;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;


class PerformanceAspect
{
    // in PerformanceAspect
    public function around(string $label, callable $action)
    {
        $start = microtime(true);
        try {
            $result = $action();
            $duration = round((microtime(true) - $start) * 1000, 2);
            Cache::put("perf:{$label}:last", $duration, 3600);
            Log::info("AOP [{$label}] OK | {$duration} ms");
            return $result;
        } catch (\Throwable $e) {
            $duration = round((microtime(true) - $start) * 1000, 2);
            Cache::put("perf:{$label}:last_error", $duration, 3600);
            Log::error("AOP [{$label}] FAIL | {$duration} ms | {$e->getMessage()}");
            throw $e;
        }
    }
}
