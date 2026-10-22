<?php
/**
 * Adds the personality stylesheet to the page head when the Saasparilla skin
 * is the active one. The base layer loads through layout on every page.
 */
declare(strict_types=1);

namespace MFRG\SaasparillaSkin\Observer;

use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Framework\View\Page\Config as PageConfig;
use MFRG\SaasparillaSkin\ViewModel\Skin;

class AddSkinStylesheet implements ObserverInterface
{
    public function __construct(
        private readonly PageConfig $pageConfig,
        private readonly Skin $skin
    ) {
    }

    public function execute(Observer $observer): void
    {
        if ($this->skin->isActive()) {
            $this->pageConfig->addPageAsset('MFRG_SaasparillaSkin::css/saasparilla.css');
        }
    }
}
