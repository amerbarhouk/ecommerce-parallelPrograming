<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/**
 * ============================================================
 * CapacityMonitorController - Capacity Dashboard
 * ============================================================
 *
 * Requirement #2: Resource Management & Capacity Control
 *
 * Provides real-time visibility into system capacity:
 *   - Redis connection info
 *   - DB connection count
 *   - Queue size + workers
 *   - Active concurrency limiters
 *   - Per-backend stats (when called through proxy)
 *
 * Endpoints:
 *   GET /capacity/overview    - Full capacity snapshot
 *   GET /capacity/redis       - Redis stats
 *   GET /capacity/db          - DB connection stats
 *   GET /capacity/queue       - Queue stats
 *   GET /capacity/limits      - Active concurrency limiters
 * ============================================================
 */
class CapacityMonitorController extends Controller
{
    /**
     * Full capacity overview - all metrics in one call.
     */
    public function overview()
    {
        return response()->json([
            'timestamp' => now()->toDateTimeString(),
            'server_id' => env('SERVER_ID', 'unknown'),
            'pid' => getmypid(),
            'memory_mb' => round(memory_get_usage(true) / 1024 / 1024, 2),
            'memory_peak_mb' => round(memory_get_peak_usage(true) / 1024 / 1024, 2),
            'redis' => $this->getRedisStats(),
            'database' => $this->getDbStats(),
            'queue' => $this->getQueueStats(),
            'limits' => $this->getConcurrencyLimits(),
        ]);
    }

    public function redisStats()
    {
        return response()->json($this->getRedisStats());
    }

    public function dbStats()
    {
        return response()->json($this->getDbStats());
    }

    public function queueStats()
    {
        return response()->json($this->getQueueStats());
    }

    public function limits()
    {
        return response()->json($this->getConcurrencyLimits());
    }

    /**
     * Reset all concurrency limiters (emergency use only).
     */
    public function resetLimits()
    {
        $keys = Redis::keys('concurrency:*');
        $count = 0;
        foreach ($keys as $key) {
            Redis::del($key);
            $count++;
        }

        return response()->json([
            'message' => 'All concurrency limiters reset',
            'cleared_keys' => $count,
        ]);
    }

    private function getRedisStats(): array
    {
        try {
            $info = Redis::info();
            return [
                'status' => 'connected',
                'version' => $info['redis_version'] ?? 'unknown',
                'os' => $info['os'] ?? 'unknown',
                'uptime_seconds' => $info['uptime_in_seconds'] ?? 0,
                'connected_clients' => $info['connected_clients'] ?? 0,
                'used_memory_human' => $info['used_memory_human'] ?? 'unknown',
                'used_memory_peak_human' => $info['used_memory_peak_human'] ?? 'unknown',
                'total_connections_received' => $info['total_connections_received'] ?? 0,
                'total_commands_processed' => $info['total_commands_processed'] ?? 0,
                'ops_per_sec' => $info['instantaneous_ops_per_sec'] ?? 0,
                'db_keys' => $this->countRedisKeys(),
            ];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }

    private function countRedisKeys(): int
    {
        try {
            $count = 0;
            for ($i = 0; $i < 16; $i++) {
                $size = Redis::dbsize($i);
                $count += is_int($size) ? $size : 0;
            }
            return $count;
        } catch (\Exception $e) {
            return -1;
        }
    }

    private function getDbStats(): array
    {
        try {
            // MySQL connection count
            $connections = DB::select('SHOW STATUS WHERE Variable_name IN ("Threads_connected", "Max_used_connections", "Threads_cached")');
            $result = ['status' => 'connected', 'metrics' => []];
            foreach ($connections as $row) {
                $result['metrics'][$row->Variable_name] = $row->Value;
            }

            // Active processes
            $processes = DB::select('SHOW PROCESSLIST');
            $result['active_processes'] = count($processes);
            $result['process_list'] = array_slice(array_map(function ($p) {
                return [
                    'id' => $p->Id,
                    'user' => $p->User,
                    'db' => $p->db,
                    'state' => $p->State,
                    'time_sec' => $p->Time,
                    'query_preview' => substr($p->Info ?? '', 0, 100),
                ];
            }, $processes), 0, 10);

            return $result;
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }

    private function getQueueStats(): array
    {
        try {
            $size = Redis::llen('queues:default');
            return [
                'status' => 'connected',
                'default_queue_size' => $size,
                'pending_jobs' => $size,
                'config' => [
                    'connection' => config('queue.default'),
                    'queue' => config('queue.connections.' . config('queue.default') . '.queue', 'default'),
                    'retry_after' => config('queue.connections.' . config('queue.default') . '.retry_after', 90),
                ],
            ];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }

    private function getConcurrencyLimits(): array
    {
        try {
            $keys = Redis::keys('concurrency:*');
            $limits = [];
            foreach ($keys as $key) {
                // Strip the Laravel prefix
                $cleanKey = preg_replace('/^.*database-concurrency:/', 'concurrency:', $key);
                $value = Redis::get($key);
                $limits[$cleanKey] = (int) $value;
            }
            return [
                'status' => 'ok',
                'active_limiters' => count($limits),
                'limits' => $limits,
            ];
        } catch (\Exception $e) {
            return ['status' => 'error', 'message' => $e->getMessage()];
        }
    }
}
