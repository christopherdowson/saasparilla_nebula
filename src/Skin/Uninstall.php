<?php
/**
 * Runs on `bin/magento module:uninstall MFRG_SaasparillaSkin`: hands the admin
 * back to Nebula's own theme and skin.
 */
declare(strict_types=1);

namespace MFRG\SaasparillaSkin;

use Magento\Framework\App\Config\ReinitableConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;
use Magento\Framework\Setup\ModuleContextInterface;
use Magento\Framework\Setup\SchemaSetupInterface;
use Magento\Framework\Setup\UninstallInterface;
use MFRG\SaasparillaSkin\Setup\Patch\Data\ActivateSaasparilla;

class Uninstall implements UninstallInterface
{
    public function __construct(
        private readonly WriterInterface $configWriter,
        private readonly ReinitableConfigInterface $reinitableConfig
    ) {
    }

    public function uninstall(SchemaSetupInterface $setup, ModuleContextInterface $context): void
    {
        foreach (ActivateSaasparilla::DEFAULTS as $path => $value) {
            $this->configWriter->save($path, $value);
        }
        $this->reinitableConfig->reinit();
    }
}
