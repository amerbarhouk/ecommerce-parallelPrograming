<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class DistributedLockService
{
    public function lock(string $resource, int $ttl = 5, int $waitMs = 3000): ?string
    {
        $token = Str::uuid()->toString();
        $key = "lock:{$resource}";
        $start = microtime(true);

        while ((microtime(true) - $start) * 1000 < $waitMs) {
            // Cache::add only stores if key doesn't exist — atomic on DB cache
            if (Cache::add($key, $token, $ttl)) {
                return $token;
            }
            usleep(50_000); // 50ms retry
        }

        return null; // timeout
    }

    public function release(string $resource, string $token): bool
    {
        $key = "lock:{$resource}";

        // Only delete if we own the lock
        if (Cache::get($key) === $token) {
            Cache::forget($key);
            return true;
        }

        return false;
    }
}