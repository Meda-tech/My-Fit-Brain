'use client';

import { useTransition } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '../../components/brand';
import { setActiveAction } from './actions';

/** On / Off for buying. Turning off asks first; paid purchases and running assessments go on. */
export function ActiveSwitch({ code, name, active }: { code: string; name: string; active: boolean }) {
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    if (
      active &&
      !window.confirm(
        `Turn off ${name}? Nobody can buy it until you turn it on again. Clients who already paid can still start and finish it.`
      )
    ) {
      return;
    }
    const form = new FormData();
    form.set('code', code);
    form.set('active', active ? 'off' : 'on');
    startTransition(() => setActiveAction(form));
  };

  return (
    <Button type="button" variant="secondary" size="sm" onClick={toggle} loading={pending} loadingText="Saving...">
      {active ? <Pause size={16} strokeWidth={2} aria-hidden /> : <Play size={16} strokeWidth={2} aria-hidden />}
      <span>{active ? 'Turn off' : 'Turn on'}</span>
    </Button>
  );
}
