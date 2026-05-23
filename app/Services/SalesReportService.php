<?php

namespace App\Services;

use App\Models\Order;

class SalesReportService
{

    //before
    public function calculateDailySalesWithoutChunk(string  $date)
    {

        $result = [
            'total_orders' => 0,
            'total_items' => 0,
            'total_revenue' => 0,
        ];

        $orders = Order::whereDate('created_at', $date)->get();

        foreach ($orders as $order) {
            $result['total_orders']++;

            foreach ($order->items as $item) {
                $result['total_items'] += $item->quantity;
                $result['total_revenue'] += $item->quantity * $item->price;
            }
        }

        return $result;
    }




    //after
    public function calculateDailySales(string  $date)
    {
        $result = [
            'total_orders' => 0,
            'total_items' => 0,
            'total_revenue' => 0,
        ];

        Order::whereDate('created_at', $date)
            ->chunkById(100, function ($orders) use (&$result) {

                foreach ($orders as $order) {
                    $result['total_orders']++;

                    foreach ($order->items as $item) {
                        $result['total_items'] += $item->quantity;
                        $result['total_revenue'] += $item->quantity * $item->price;
                    }
                }
            });

        return $result;
    }
}
