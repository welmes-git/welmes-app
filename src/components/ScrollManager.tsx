import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const positions = new Map<string, number>();

function scrollToHash(hash: string) {
  const id = decodeURIComponent(hash.slice(1));
  if (!id) return;
  let tries = 0;
  const run = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      return;
    }
    if (tries++ < 20) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function restorePosition(y: number) {
  let tries = 0;
  const run = () => {
    window.scrollTo(0, y);
    const reached = Math.abs(window.scrollY - y) <= 1;
    const atBottom =
      window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1;
    if (!reached && !atBottom && tries++ < 20) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

export default function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const keyRef = useRef(location.key);
  const first = useRef(true);

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const onScroll = () => positions.set(keyRef.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    positions.set(keyRef.current, window.scrollY);
    keyRef.current = location.key;

    if (first.current) {
      first.current = false;
      if (location.hash) scrollToHash(location.hash);
      return;
    }

    if (location.hash) {
      scrollToHash(location.hash);
      return;
    }

    if (navigationType === 'POP') {
      restorePosition(positions.get(location.key) ?? 0);
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.key, location.pathname, location.hash, navigationType]);

  return null;
}
