<?php
/**
 * Whether the Saasparilla skin is the one Nebula is showing. The personality
 * stylesheet loads only then, so an admin who picks another Nebula skin gets
 * that skin unaltered.
 */
declare(strict_types=1);

namespace MFRG\SaasparillaSkin\ViewModel;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Framework\View\Element\Block\ArgumentInterface;
use MFRG\SaasparillaSkin\Setup\Patch\Data\ActivateSaasparilla;

class Skin implements ArgumentInterface
{
    public function __construct(private readonly ScopeConfigInterface $scopeConfig)
    {
    }

    public function isActive(): bool
    {
        return trim((string) $this->scopeConfig->getValue('nebula/theme/skin')) === ActivateSaasparilla::SKIN;
    }
}
