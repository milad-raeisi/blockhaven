'use client';

import { useEffect, useState } from 'react';

/** True on devices whose primary pointer is a finger (phones, tablets). */
export function useIsTouch(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setTouch(query.matches || new URLSearchParams(window.location.search).has('touch'));
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return touch;
}
