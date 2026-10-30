'use client';

import { MenuShell } from '@/components/menu/MenuShell';
import { SettingsForm } from '@/components/menu/SettingsForm';
import { Panel } from '@/components/ui/controls';

export default function SettingsPage() {
  return (
    <MenuShell title="Settings" wide>
      <Panel>
        <SettingsForm />
        <p className="mt-4 text-xs text-neutral-400">Settings are saved in this browser only. World data always stays on the server.</p>
      </Panel>
    </MenuShell>
  );
}
