<?php
/**
 * Figures for the dashboard instruments, read from the sales and customer
 * tables. They follow the dashboard's scope switcher (store, website or
 * group), use the base currency, and group months and days by the store's
 * configured timezone. Revenue is Magento's own definition: subtotal less
 * discounts, refunds and cancellations, before tax and shipping. Results are
 * cached for five minutes per scope.
 */
declare(strict_types=1);

namespace MFRG\SaasparillaDashboard\ViewModel;

use DateTimeImmutable;
use DateTimeZone;
use Magento\Framework\App\CacheInterface;
use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\App\ResourceConnection;
use Magento\Framework\DB\Select;
use Magento\Framework\Pricing\PriceCurrencyInterface;
use Magento\Framework\Serialize\SerializerInterface;
use Magento\Framework\Stdlib\DateTime\TimezoneInterface;
use Magento\Framework\UrlInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use Magento\Payment\Helper\Data as PaymentHelper;
use Magento\Store\Model\StoreManagerInterface;
use Throwable;

class Instruments implements ArgumentInterface
{
    public const CACHE_TAG = 'MFRG_DASHBOARD';
    private const CACHE_LIFETIME = 300;
    private const EXCLUDED_STATES = ['canceled'];
    private const OPEN_STATES = ['new', 'processing'];

    /** Magento's own revenue: subtotal less discounts, refunds and cancellations, before tax and shipping. */
    private const REVENUE = '(%1$s.base_subtotal - COALESCE(%1$s.base_subtotal_refunded, 0) - COALESCE(%1$s.base_subtotal_canceled, 0)'
        . ' - ABS(COALESCE(%1$s.base_discount_amount, 0)) + COALESCE(%1$s.base_discount_refunded, 0) - COALESCE(%1$s.base_discount_canceled, 0))';

    private ?array $data = null;
    private ?array $storeIds = null;
    private bool $scopeResolved = false;

    public function __construct(
        private readonly ResourceConnection $resource,
        private readonly TimezoneInterface $timezone,
        private readonly PriceCurrencyInterface $priceCurrency,
        private readonly PaymentHelper $paymentHelper,
        private readonly ScopeConfigInterface $scopeConfig,
        private readonly StoreManagerInterface $storeManager,
        private readonly UrlInterface $url,
        private readonly RequestInterface $request,
        private readonly CacheInterface $cache,
        private readonly SerializerInterface $serializer
    ) {
    }

    /**
     * Everything the template needs, computed once per request and cached per scope.
     */
    public function getData(): array
    {
        if ($this->data !== null) {
            return $this->data;
        }
        $key = 'mfrg_dashboard_' . md5($this->serializer->serialize([
            $this->storeIds(),
            $this->targets(),
            date('Y-m-d H:i', (int) (time() / 300) * 300),
        ]));
        $cached = $this->cache->load($key);
        if ($cached) {
            try {
                return $this->data = $this->serializer->unserialize($cached);
            } catch (Throwable) {
                // fall through and rebuild
            }
        }
        $this->data = $this->build();
        $this->cache->save($this->serializer->serialize($this->data), $key, [self::CACHE_TAG], self::CACHE_LIFETIME);
        return $this->data;
    }

    public function getOrdersUrl(): string
    {
        return $this->url->getUrl('sales/order/index');
    }

    public function getCurrencyCode(): string
    {
        try {
            $ids = $this->storeIds();
            $store = $ids ? $this->storeManager->getStore($ids[0]) : $this->storeManager->getStore();
            return (string) $store->getBaseCurrencyCode();
        } catch (Throwable) {
            return 'USD';
        }
    }

    public function getLocale(): string
    {
        $locale = (string) $this->scopeConfig->getValue('general/locale/code');
        return str_replace('_', '-', $locale ?: 'en_US');
    }

    /**
     * Whole units and decimals apart, so the template can dim the decimals.
     *
     * @return array{whole: string, decimals: string}
     */
    public function money(float $amount): array
    {
        $amount = round($amount, 2);
        $whole = $this->priceCurrency->format(floor($amount), false, 0);
        $cents = (int) round(($amount - floor($amount)) * 100);
        return ['whole' => $whole, 'decimals' => sprintf('.%02d', $cents)];
    }

    public function moneyText(float $amount): string
    {
        return $this->priceCurrency->format($amount, false, 2);
    }

    /**
     * Percent change, or null when there is nothing to compare against.
     */
    public function delta(float $now, float $before): ?float
    {
        if ($before <= 0) {
            return null;
        }
        return ($now - $before) / $before * 100;
    }

    /**
     * Store ids for the dashboard's scope switcher, or null for every store.
     *
     * @return int[]|null
     */
    private function storeIds(): ?array
    {
        if ($this->scopeResolved) {
            return $this->storeIds;
        }
        $this->scopeResolved = true;
        try {
            if ($store = $this->request->getParam('store')) {
                $this->storeIds = [(int) $this->storeManager->getStore($store)->getId()];
            } elseif ($website = $this->request->getParam('website')) {
                $this->storeIds = array_map('intval', $this->storeManager->getWebsite($website)->getStoreIds());
            } elseif ($group = $this->request->getParam('group')) {
                $this->storeIds = array_map('intval', $this->storeManager->getGroup($group)->getStoreIds());
            }
        } catch (Throwable) {
            $this->storeIds = null;
        }
        return $this->storeIds;
    }

    /**
     * @return array{orders_per_day: int, overdue_days: int}
     */
    private function targets(): array
    {
        return [
            'orders_per_day' => max(1, (int) $this->scopeConfig->getValue('mfrg_dashboard/targets/orders_per_day')),
            'overdue_days' => max(0, (int) $this->scopeConfig->getValue('mfrg_dashboard/targets/overdue_days')),
        ];
    }

    private function revenueExpr(string $alias): string
    {
        return 'SUM(' . sprintf(self::REVENUE, $alias) . ')';
    }

    private function scoped(Select $select, string $column): Select
    {
        $ids = $this->storeIds();
        if ($ids) {
            $select->where($column . ' IN (?)', $ids);
        }
        return $select;
    }

    private function build(): array
    {
        $tz = new DateTimeZone($this->timezone->getConfigTimezone());
        $now = new DateTimeImmutable('now', $tz);
        $monthStart = $now->modify('first day of this month midnight');
        $prevStart = $monthStart->modify('-1 month');
        $seriesStart = $monthStart->modify('-23 months');
        $offset = $now->format('P');
        $targets = $this->targets();

        $months = $this->monthlySeries($seriesStart, $offset);
        $keyNow = $monthStart->format('Y-m');
        $keyPrev = $prevStart->format('Y-m');

        $labels12 = [];
        $revenue12 = [];
        $aovNow = [];
        $aovBefore = [];
        for ($i = 11; $i >= 0; $i--) {
            $m = $monthStart->modify("-{$i} months");
            $key = $m->format('Y-m');
            $prevYear = $m->modify('-12 months')->format('Y-m');
            $labels12[] = $m->format('M');
            $revenue12[] = $months[$key]['revenue'] ?? 0.0;
            $aovNow[] = $this->aov($months[$key] ?? null);
            $aovBefore[] = $this->aov($months[$prevYear] ?? null);
        }

        $thisMonth = $months[$keyNow] ?? ['orders' => 0, 'revenue' => 0.0];
        $lastMonth = $months[$keyPrev] ?? ['orders' => 0, 'revenue' => 0.0];
        $customers = $this->newCustomers($prevStart, $monthStart, $offset);

        return [
            'month_name' => $monthStart->format('F'),
            'prev_month_name' => $prevStart->format('F'),
            'revenue' => (float) $thisMonth['revenue'],
            'revenue_prev' => (float) $lastMonth['revenue'],
            'revenue_lifetime' => $this->lifetimeRevenue(),
            'orders' => (int) $thisMonth['orders'],
            'orders_prev' => (int) $lastMonth['orders'],
            'customers' => $customers['now'],
            'customers_prev' => $customers['prev'],
            'aov' => $this->aov($thisMonth),
            'aov_prev' => $this->aov($lastMonth),
            'sticks' => ['labels' => $labels12, 'values' => $revenue12],
            'dumbbell' => [
                'labels' => $labels12,
                'now' => $aovNow,
                'before' => $aovBefore,
                'year' => $now->format('Y'),
                'last_year' => $now->modify('-1 year')->format('Y'),
            ],
            'share' => $this->paymentShare($monthStart),
            'overdue' => $this->overdue($now, $targets['overdue_days']),
            'calendar' => $this->calendar($now, $monthStart, $offset, $targets['orders_per_day']),
            'target' => $targets['orders_per_day'],
        ];
    }

    /**
     * @return array<string, array{orders: int, revenue: float}> keyed by Y-m
     */
    private function monthlySeries(DateTimeImmutable $from, string $offset): array
    {
        $conn = $this->resource->getConnection();
        $select = $conn->select()
            ->from(['o' => $this->resource->getTableName('sales_order')], [
                'm' => new \Zend_Db_Expr("DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', " . $conn->quote($offset) . "), '%Y-%m')"),
                'orders' => new \Zend_Db_Expr('COUNT(*)'),
                'revenue' => new \Zend_Db_Expr($this->revenueExpr('o')),
            ])
            ->where('o.state NOT IN (?)', self::EXCLUDED_STATES)
            ->where('o.created_at >= ?', $this->utc($from))
            ->group('m');
        $out = [];
        foreach ($conn->fetchAll($this->scoped($select, 'o.store_id')) as $row) {
            $out[$row['m']] = ['orders' => (int) $row['orders'], 'revenue' => (float) $row['revenue']];
        }
        return $out;
    }

    private function aov(?array $month): float
    {
        if (!$month || (int) $month['orders'] === 0) {
            return 0.0;
        }
        return (float) $month['revenue'] / (int) $month['orders'];
    }

    private function lifetimeRevenue(): float
    {
        $conn = $this->resource->getConnection();
        $select = $conn->select()
            ->from(['o' => $this->resource->getTableName('sales_order')], [new \Zend_Db_Expr($this->revenueExpr('o'))])
            ->where('o.state NOT IN (?)', self::EXCLUDED_STATES);
        return (float) $conn->fetchOne($this->scoped($select, 'o.store_id'));
    }

    /**
     * @return array{now: int, prev: int}
     */
    private function newCustomers(DateTimeImmutable $prevStart, DateTimeImmutable $monthStart, string $offset): array
    {
        $conn = $this->resource->getConnection();
        $select = $conn->select()
            ->from(['c' => $this->resource->getTableName('customer_entity')], [
                'm' => new \Zend_Db_Expr("DATE_FORMAT(CONVERT_TZ(c.created_at, '+00:00', " . $conn->quote($offset) . "), '%Y-%m')"),
                'n' => new \Zend_Db_Expr('COUNT(*)'),
            ])
            ->where('c.created_at >= ?', $this->utc($prevStart))
            ->group('m');
        $byMonth = $conn->fetchPairs($this->scoped($select, 'c.store_id'));
        return [
            'now' => (int) ($byMonth[$monthStart->format('Y-m')] ?? 0),
            'prev' => (int) ($byMonth[$prevStart->format('Y-m')] ?? 0),
        ];
    }

    /**
     * Revenue this month by payment method, largest first.
     *
     * @return array<int, array{label: string, amount: float, share: float}>
     */
    private function paymentShare(DateTimeImmutable $monthStart): array
    {
        $conn = $this->resource->getConnection();
        $select = $conn->select()
            ->from(['o' => $this->resource->getTableName('sales_order')], [])
            ->join(['p' => $this->resource->getTableName('sales_order_payment')], 'p.parent_id = o.entity_id', [
                'method' => 'p.method',
                'amount' => new \Zend_Db_Expr($this->revenueExpr('o')),
            ])
            ->where('o.state NOT IN (?)', self::EXCLUDED_STATES)
            ->where('o.created_at >= ?', $this->utc($monthStart))
            ->group('p.method')
            ->order('amount DESC');
        $rows = $conn->fetchAll($this->scoped($select, 'o.store_id'));
        $total = array_sum(array_map(static fn($r) => (float) $r['amount'], $rows));
        $out = [];
        foreach (array_slice($rows, 0, 5) as $row) {
            $amount = (float) $row['amount'];
            $out[] = [
                'label' => $this->methodTitle((string) $row['method']),
                'amount' => $amount,
                'share' => $total > 0 ? $amount / $total : 0.0,
            ];
        }
        return $out;
    }

    private function methodTitle(string $code): string
    {
        try {
            $title = (string) $this->paymentHelper->getMethodInstance($code)->getTitle();
            return $title !== '' ? $title : $code;
        } catch (Throwable) {
            return $code;
        }
    }

    /**
     * Open orders with no shipment, older than the configured number of days.
     *
     * @return array{count: int, oldest_days: ?int}
     */
    private function overdue(DateTimeImmutable $now, int $days): array
    {
        $conn = $this->resource->getConnection();
        $cutoff = $now->modify("-{$days} days");
        $select = $conn->select()
            ->from(['o' => $this->resource->getTableName('sales_order')], [
                'n' => new \Zend_Db_Expr('COUNT(*)'),
                'oldest' => new \Zend_Db_Expr('MIN(o.created_at)'),
            ])
            ->joinLeft(['s' => $this->resource->getTableName('sales_shipment')], 's.order_id = o.entity_id', [])
            ->where('o.state IN (?)', self::OPEN_STATES)
            ->where('s.entity_id IS NULL')
            ->where('o.created_at <= ?', $this->utc($cutoff));
        $row = $conn->fetchRow($this->scoped($select, 'o.store_id')) ?: ['n' => 0, 'oldest' => null];
        $oldestDays = null;
        if (!empty($row['oldest'])) {
            $oldest = new DateTimeImmutable($row['oldest'], new DateTimeZone('UTC'));
            $oldestDays = (int) floor(($now->getTimestamp() - $oldest->getTimestamp()) / 86400);
        }
        return ['count' => (int) $row['n'], 'oldest_days' => $oldestDays];
    }

    /**
     * Orders a day for the current month, with a state for the dot calendar.
     *
     * @return array{days: array<int, array{label: string, value: ?int, state: string}>, offset: int, hits: int, elapsed: int}
     */
    private function calendar(DateTimeImmutable $now, DateTimeImmutable $monthStart, string $offset, int $target): array
    {
        $conn = $this->resource->getConnection();
        $select = $conn->select()
            ->from(['o' => $this->resource->getTableName('sales_order')], [
                'd' => new \Zend_Db_Expr("DATE(CONVERT_TZ(o.created_at, '+00:00', " . $conn->quote($offset) . "))"),
                'n' => new \Zend_Db_Expr('COUNT(*)'),
            ])
            ->where('o.state NOT IN (?)', self::EXCLUDED_STATES)
            ->where('o.created_at >= ?', $this->utc($monthStart))
            ->group('d');
        $perDay = $conn->fetchPairs($this->scoped($select, 'o.store_id'));

        $daysInMonth = (int) $monthStart->format('t');
        $today = (int) $now->format('j');
        $days = [];
        $hits = 0;
        for ($d = 1; $d <= $daysInMonth; $d++) {
            $date = $monthStart->setDate((int) $monthStart->format('Y'), (int) $monthStart->format('n'), $d);
            $count = (int) ($perDay[$date->format('Y-m-d')] ?? 0);
            if ($d > $today) {
                $state = 'future';
                $value = null;
            } elseif ($d === $today) {
                $state = 'today';
                $value = $count;
            } else {
                $state = $count >= $target ? 'hit' : 'miss';
                $value = $count;
                if ($state === 'hit') {
                    $hits++;
                }
            }
            $days[] = ['label' => $date->format('D j M'), 'value' => $value, 'state' => $state];
        }
        return [
            'days' => $days,
            'offset' => ((int) $monthStart->format('N')) - 1,
            'hits' => $hits,
            'elapsed' => max(0, $today - 1),
        ];
    }

    private function utc(DateTimeImmutable $local): string
    {
        return $local->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }
}
