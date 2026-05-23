<?php

namespace App\Aspects;

use Illuminate\Support\Facades\Log;

class JobExecutionAspect
{
    /**
     * وقت بداية تنفيذ الـ Job
     * @var float
     */
    private float $startTime;

    /**
     * تسجيل بداية التنفيذ
     */
    public function before(string $jobName): void
    {
        $this->startTime = microtime(true);
        Log::info("START JOB: {$jobName}");
    }

    /**
     * تسجيل نهاية التنفيذ
     */
    public function after(string $jobName): void
    {
        $duration = round((microtime(true) - $this->startTime) * 1000, 2);
        Log::info("END JOB: {$jobName} | Execution time: {$duration} ms");
    }

    /**
     * تسجيل الأخطاء (Aspect Exception Logging)
     */
    public function onException(string $jobName, \Throwable $e): void
    {
        Log::error("EXCEPTION in JOB: {$jobName} | Exception: " . $e->getMessage(), [
            'exception' => $e
        ]);
    }
}
