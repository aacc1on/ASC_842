import { createContext } from 'react';
import { type ActiveBreakdown } from '../types';

export const BreakdownContext = createContext<(b: ActiveBreakdown) => void>(() => undefined);
