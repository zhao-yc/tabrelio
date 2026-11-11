import { z } from 'zod';

export const objectInformationWidthLimits = { min: 300, max: 1000, initial: 340 } as const;
export const objectInformationWidthSchema = z.number().int().min(objectInformationWidthLimits.min).max(objectInformationWidthLimits.max);
