<?php

namespace App\Services;

use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Str;

class DistributedLockService
{
    public function lock(string $resource, int $ttl = 5, int $waitMs = 3000): ?string
    {
        $token = Str::uuid()->toString();
        $key = "lock:{$resource}";
        $start = microtime(true);

        while ((microtime(true) - $start) * 1000 < $waitMs) {
            if (Redis::set($key, $token, 'EX', $ttl, 'NX')) {
                return $token;
            }
            usleep(50_000); // 50ms
        }
        return null; // failed to acquire
    }

    public function release(string $resource, string $token): bool
    {
        $script = <<<LUA
        if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
        else
            return 0
        end
        LUA;

        return (bool) Redis::eval($script, 1, "lock:{$resource}", $token);
    }
}
