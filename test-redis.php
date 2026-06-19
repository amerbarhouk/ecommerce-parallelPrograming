<?php
try {
    $r = new Redis();
    $r->connect('127.0.0.1', 6379);
    echo 'PING: ' . $r->ping() . PHP_EOL;
    echo 'Redis version: ' . $r->info()['redis_version'] . PHP_EOL;
} catch(Exception $e) {
    echo 'Error: ' . $e->getMessage() . PHP_EOL;
}
