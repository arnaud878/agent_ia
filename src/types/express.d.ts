import type { DataAccess } from '../common/types/data-access';

declare global {
  namespace Express {
    interface Request {
      dataAccess?: DataAccess;
    }
  }
}

export {};
