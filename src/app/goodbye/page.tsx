'use client';

import { useEffect } from 'react';
import { MenuShell } from '@/components/menu/MenuShell';
import { Panel, VoxelLink } from '@/components/ui/controls';
import { getNetworkClient } from '@/network/client/NetworkClient';

export default function GoodbyePage() {
  useEffect(() => {
    getNetworkClient().disconnect();
    // Browsers only allow closing windows that scripts opened; try anyway.
    window.close();
  }, []);

  return (
    <MenuShell back={null}>
      <Panel title="Thanks for playing!">
        <p className="mb-4 text-neutral-200">Your worlds are saved on the server. You can close this tab now.</p>
        <VoxelLink href="/" variant="primary">
          Back to Main Menu
        </VoxelLink>
      </Panel>
    </MenuShell>
  );
}
