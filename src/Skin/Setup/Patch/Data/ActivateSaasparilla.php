<?php
/**
 * Makes Saasparilla the admin theme on install: the child theme for both of
 * Nebula's theme settings, and the skin for its colour scheme. Reverting the
 * patch, or uninstalling the module, puts Nebula's own values back.
 */
declare(strict_types=1);

namespace MFRG\SaasparillaSkin\Setup\Patch\Data;

use Magento\Framework\App\Config\ReinitableConfigInterface;
use Magento\Framework\App\Config\Storage\WriterInterface;
use Magento\Framework\Setup\Patch\DataPatchInterface;
use Magento\Framework\Setup\Patch\PatchRevertableInterface;

class ActivateSaasparilla implements DataPatchInterface, PatchRevertableInterface
{
    public const THEME = 'MFRG/saasparilla';
    public const SKIN = 'saasparilla';

    /** Config paths and the values this package sets. */
    public const VALUES = [
        'nebula/theme/admin_theme' => self::THEME,
        'nebula_theme_switcher/general/active_theme' => self::THEME,
        'nebula/theme/skin' => self::SKIN,
    ];

    /** Nebula's own values, restored on revert or uninstall. */
    public const DEFAULTS = [
        'nebula/theme/admin_theme' => 'Nebula/backend',
        'nebula_theme_switcher/general/active_theme' => 'Nebula/backend',
        'nebula/theme/skin' => 'indigo',
    ];

    public function __construct(
        private readonly WriterInterface $configWriter,
        private readonly ReinitableConfigInterface $reinitableConfig
    ) {
    }

    public function apply(): self
    {
        foreach (self::VALUES as $path => $value) {
            $this->configWriter->save($path, $value);
        }
        $this->reinitableConfig->reinit();
        return $this;
    }

    public function revert(): void
    {
        foreach (self::DEFAULTS as $path => $value) {
            $this->configWriter->save($path, $value);
        }
        $this->reinitableConfig->reinit();
    }

    public static function getDependencies(): array
    {
        return [];
    }

    public function getAliases(): array
    {
        return [];
    }
}
