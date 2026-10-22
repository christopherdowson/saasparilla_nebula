<?php
/**
 * Saasparilla instruments for the Nebula dashboard: figures, trends and
 * meters drawn from Magento's own sales and customer data.
 */
declare(strict_types=1);

use Magento\Framework\Component\ComponentRegistrar;

ComponentRegistrar::register(ComponentRegistrar::MODULE, 'MFRG_SaasparillaDashboard', __DIR__);
