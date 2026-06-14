<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;
use App\Aspects\JobExecutionAspect;
use App\Services\SalesReportService;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     *
     * يتم تسجيل Services و Bindings هنا
     */
    public function register(): void
    {
        // Bind اليقظة Aspect - transient (bind) وليس singleton
        // لأن الـ Aspect يخزن startTime كـ state، فلو كان singleton
        // واشتغل jobين بنفس الوقت رح يخرب الـ timing
        $this->app->bind(JobExecutionAspect::class, function () {
            return new JobExecutionAspect();
        });

        // Bind Sales Report Service
        $this->app->singleton(SalesReportService::class, function () {
            return new SalesReportService();
        });
    }

    /**
     * Bootstrap any application services.
     *
     * يتم التعديلات على الـ Services بعد تحميل المشروع هنا
     */
    public function boot(): void
    {
        // يمكن إضافة Global Middleware أو Model Observers هنا
    }
}
