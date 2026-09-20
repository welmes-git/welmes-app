import { createContext } from 'react';
import type { Product } from '../store/useStore';

export const SsrProductContext = createContext<Product | null>(null);
