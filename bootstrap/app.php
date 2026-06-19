<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Console\Scheduling\Schedule;
use App\Jobs\GenerateDailySalesReport;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        commands: __DIR__ . '/../routes/console.php',
        api: __DIR__ . '/../routes/api.php',
        health: '/up',
    )

    ->withSchedule(function (Schedule $schedule) {

        $schedule->job(
            new GenerateDailySalesReport(
                now()->subDay()->toDateString()
            )
        )->everyTwoMinutes();
        //->everyMinute();
        //everyTwoMinutes();
        //dailyAt('01:00');
    })

    ->withMiddleware(function (Middleware $middleware): void {
        //

        // هذا السطر يستثني الروابط المحددة من فحص التوكن الأمني
        $middleware->validateCsrfTokens(except: [
            'test-create-order',
            'test-complete/*',
            'api/test-create-order',
            'api/test-complete/*',
            'order/atomic',
            'order/*',
            // أو استخدم هذا السطر بدلاً من السطور فوق:
            // 'test-*',
            // 'api/test-*'
        ]);
    })

    ->withExceptions(function (Exceptions $exceptions): void {
        //
    })->create();
