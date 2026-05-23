<?php

namespace App\Http\Controllers;

use App\Models\DailySalesReport;

use App\Services\SalesReportService;

use App\Jobs\GenerateDailySalesReport;

class ReportComparisonController extends Controller
{



    public function generateSyncReport(string $date)
    {


        $start = microtime(true);

        $service = new SalesReportService();

        $data = $service->calculateDailySales($date);


        DailySalesReport::updateOrCreate(


            ['date' => $date],


            $data
        );


        $time = (microtime(true) - $start) * 1000;


        return [


            'mode' => 'sync',


            'execution_time_ms' => round($time, 2),
        ];
    }





    public function generateAsyncReport(string $date)
    {


        $start = microtime(true);


        GenerateDailySalesReport::dispatch($date);


        $dispatchTime = (microtime(true) - $start) * 1000;


        return [


            'mode' => 'async',


            'message' => 'Job dispatched to queue',


            'dispatch_time_ms' => round($dispatchTime, 2),
        ];
    }
}
