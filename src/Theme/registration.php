<?php
/**
 * MFRG Saasparilla: a child of Nebula/backend that overrides theme-level files,
 * starting with the dashboard chart. Colours and the stylesheet live in the
 * MFRG_SaasparillaSkin module.
 */
declare(strict_types=1);

use Magento\Framework\Component\ComponentRegistrar;

ComponentRegistrar::register(ComponentRegistrar::THEME, 'adminhtml/MFRG/saasparilla', __DIR__);
